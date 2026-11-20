import {
  finishBulkItem,
  previewSelectors,
  readBulkJob,
  resolveSources,
  submitSelector,
  SyncError,
} from "./client";
import { sourceReasons, verifyBulkWorkspace } from "./bulkPlanner";
import type {
  BulkJob,
  BulkProgress,
  SelectorTask,
  SourceResult,
  StoredBulkJob,
} from "./bulkTypes";
import type { ServerId, SyncSettings } from "./types";

export interface BulkExecutionOptions {
  sourceBatchSize?: number;
  selectorConcurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  onProgress?: (progress: BulkProgress) => void;
}

function boundedOption(name: string, value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

function isTransient(error: unknown) {
  if (error instanceof SyncError)
    return error.status >= 500 || [408, 429].includes(error.status);
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      ["TimeoutError", "AbortError"].includes(error.name))
  );
}

function retry(retries: number, delay: number) {
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= retries || !isTransient(error)) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, delay * 2 ** attempt),
        );
      }
    }
  };
}

function failure(key: string, error: unknown): BulkProgress {
  const status = error instanceof SyncError ? error.status : null;
  return {
    key,
    status:
      status === 409
        ? "SELECTOR_CONFLICT"
        : status && !isTransient(error)
          ? "BLOCKED"
          : "SYNC_ERROR",
    reason:
      error instanceof SyncError
        ? error.message
        : "Burbot is unavailable. Retry this item.",
  };
}

function sourceProgress(key: string, result?: SourceResult): BulkProgress {
  if (result?.status === "RESOLVED" && result.sourceId)
    return { key, status: "SYNCED", source: result };
  return {
    key,
    status: result ? "BLOCKED" : "SYNC_ERROR",
    reason:
      (result && sourceReasons[result.status]) ??
      "Burbot did not confirm the Source.",
  };
}

async function synchronizeSelector(
  settings: SyncSettings,
  job: BulkJob,
  task: SelectorTask,
  sourceId: ServerId,
): Promise<BulkProgress> {
  const {
    key,
    expectedRevision,
    expectedBusinessObjectFieldId,
    publishReviewed,
  } = task;
  const conflict = (reason: string): BulkProgress => ({
    key,
    status: "SELECTOR_CONFLICT",
    reason,
  });
  const request = { ...task.request, sourceId };

  // A send may have succeeded before a timeout or SQLite restart.
  const result = await previewSelectors(settings, job.workspaceUuid, [request]);
  if (result.schemaRevisionId !== job.schemaRevisionId)
    return conflict("The Burbot schema changed. Preview again.");
  const found = result.items.find(
    ({ selectorUuid }) => selectorUuid === request.tree.selector.uuid,
  );
  if (!found)
    return {
      key,
      status: "SYNC_ERROR",
      reason: "Burbot did not confirm the selector.",
    };
  if (found.status === "SELECTOR_CONFLICT")
    return conflict(
      found.reason ??
        "The selector binding conflicts with the approved target.",
    );
  if (
    !["ALREADY_SYNCED", "READY", "SELECTOR_REVIEW_REQUIRED"].includes(
      found.status,
    )
  )
    return { key, status: "BLOCKED", reason: found.reason ?? found.status };
  if (found.businessObjectFieldId !== expectedBusinessObjectFieldId)
    return conflict("The server target field changed. Preview again.");
  if (found.status === "ALREADY_SYNCED" && found.binding)
    return { key, status: "SYNCED", selector: found.binding };
  if (task.alreadySynced || found.revision !== expectedRevision)
    return conflict("The server selector changed. Preview again.");
  if (found.status === "SELECTOR_REVIEW_REQUIRED" && !publishReviewed)
    return conflict(
      "Publishing these reviewed versions requires a new preview and approval.",
    );

  const selector = await submitSelector(settings, job.workspaceUuid, {
    ...request,
    publishReviewed,
    expectedRevision,
    expectedBusinessObjectFieldId,
    expectedSchemaRevisionId: job.schemaRevisionId,
  });
  return { key, status: "SYNCED", selector };
}

export async function executeBulkJob(
  settings: SyncSettings,
  operationId: string,
  options: BulkExecutionOptions = {},
): Promise<StoredBulkJob> {
  const batchSize = boundedOption(
    "Source batch size",
    options.sourceBatchSize ?? 30,
    1,
    100,
  );
  const concurrency = boundedOption(
    "Selector concurrency",
    options.selectorConcurrency ?? 5,
    1,
    20,
  );
  const run = retry(
    boundedOption("Network retries", options.retries ?? 2, 0, 5),
    boundedOption("Retry delay", options.retryDelayMs ?? 250, 0, 10_000),
  );
  const job = await readBulkJob(operationId);
  if (job.backendOrigin !== settings.origin)
    throw new Error(
      "This operation was approved for a different Burbot server.",
    );
  const progress = new Map(job.progress.map((item) => [item.key, item]));
  const remaining = job.tasks.filter(
    ({ key }) =>
      !["SYNCED", "SELECTOR_CONFLICT"].includes(progress.get(key)!.status),
  );
  if (!remaining.length) return job;

  const sync = await run(() => verifyBulkWorkspace(settings));
  if (sync.workspaceUuid !== job.workspaceUuid)
    throw new Error(
      "This operation was approved for a different Burbot workspace.",
    );
  async function save(result: BulkProgress) {
    const saved = await finishBulkItem(job, result);
    progress.set(saved.key, saved);
    options.onProgress?.(saved);
  }

  const sources = remaining.filter((task) => task.kind === "source");
  for (let offset = 0; offset < sources.length; offset += batchSize) {
    const batch = sources.slice(offset, offset + batchSize);
    let items: SourceResult[];
    try {
      const result = await run(() =>
        resolveSources(
          settings,
          job.workspaceUuid,
          batch.map(({ request }) => request),
        ),
      );
      items = result.items;
    } catch (error) {
      for (const { key } of batch)
        await save({
          ...failure(key, error),
          status: isTransient(error) ? "SYNC_ERROR" : "BLOCKED",
        });
      continue;
    }
    const results = new Map(items.map((item) => [item.clientKey, item]));
    for (const { key } of batch)
      await save(sourceProgress(key, results.get(key)));
  }

  const selectors = remaining.filter((task) => task.kind === "selector");
  for (let offset = 0; offset < selectors.length; offset += concurrency) {
    const batch = await Promise.allSettled(
      selectors.slice(offset, offset + concurrency).map(async (task) => {
        const source = progress.get(task.sourceKey);
        const sourceId =
          source?.status === "SYNCED" ? source.source?.sourceId : undefined;
        if (!sourceId) {
          await save({
            key: task.key,
            status: "BLOCKED",
            reason: source?.reason ?? "The Source has not been confirmed.",
          });
          return;
        }
        let result: BulkProgress;
        try {
          result =
            sync.registry.revisionId === job.schemaRevisionId
              ? await run(() =>
                  synchronizeSelector(settings, job, task, sourceId),
                )
              : {
                  key: task.key,
                  status: "SELECTOR_CONFLICT",
                  reason: "The Burbot schema changed. Preview again.",
                };
        } catch (error) {
          result = failure(task.key, error);
        }
        await save(result);
      }),
    );
    for (const result of batch)
      if (result.status === "rejected") throw result.reason;
  }
  return readBulkJob(operationId);
}
