import { configuredOrigin } from "../monitoring/contracts";
import { selectorTreeDTO } from "../selectors/dto";
import type {
  LegacyStorageState,
  LegacyStoredRule,
} from "../types/legacy-storage";
import { makeCommitPreview, resolveBusinessField } from "./resolve";
import type {
  ApprovedSource,
  BulkJob,
  BulkJobSummary,
  BulkProgress,
  SelectorRequest,
  SelectorResult,
  SourceBinding,
  SourceRequest,
  SourceResult,
  StoredBulkJob,
} from "./bulkTypes";
import type {
  CommitOperation,
  CommitRequest,
  ContinuousSummary,
  Identity,
  OperationResult,
  Registry,
  ResolveAction,
  ResolvedBusinessObject,
  SelectorBinding,
  ServerId,
  SyncSettings,
  SyncState,
} from "./types";

export const syncSettingsKey = "burbotBackendSynchronization";
export const continuousSignalKey = "burbotContinuousSyncSignal";
export const syncActionMessage = "burbot:backend-sync-action";
const localOrigin = "http://127.0.0.1:8765";

export type SyncAction = "wake" | "configure" | "sync" | "retry" | "legacy";
export async function requestSyncAction(action: SyncAction) {
  const result = await browser.runtime.sendMessage({ type: syncActionMessage, action });
  if (result?.error) throw new Error(result.error);
}

export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly detail: OperationResult,
  ) {
    super(
      detail.message ||
        detail.code ||
        `Synchronization request failed (${status}).`,
    );
  }
}

async function json<T>(
  url: string,
  payload?: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch((error: unknown) => {
    if (!response.ok) return {};
    // A connection can drop after the backend has sent headers and committed.
    if (!(error instanceof SyntaxError)) throw error;
    throw new SyncError(422, { code: "BACKEND_RESPONSE_INVALID" });
  });
  if (!response.ok) {
    const detail =
      typeof result.detail === "object" && !Array.isArray(result.detail)
        ? result.detail
        : {
            message:
              typeof result.detail === "string" ? result.detail : result.error,
          };
    throw new SyncError(response.status, detail ?? {});
  }
  return result as T;
}

export function validateSyncSettings(input: SyncSettings): SyncSettings {
  const token = input.token.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Enter the issued workspace token.");
  return { ...input, origin: configuredOrigin(input.origin), token };
}

export async function readSyncSettings(): Promise<SyncSettings | null> {
  if (typeof browser === "undefined") return null;
  const stored = (await browser.storage.local.get(syncSettingsKey))[
    syncSettingsKey
  ];
  return stored ? validateSyncSettings(stored) : null;
}

function remote<T>(settings: SyncSettings, path: string, body?: unknown, signal?: AbortSignal) {
  return json<T>(
    settings.origin + "/api/v1/extension-sync" + path,
    body,
    settings.token,
    signal,
  );
}

export const readSyncState = () =>
  json<SyncState>(localOrigin + "/backend-sync");
const local = <T = unknown>(action: string, body: unknown) =>
  json<T>(localOrigin + "/backend-sync/" + action, body);

export const readContinuousSummary = () =>
  json<ContinuousSummary>(localOrigin + "/backend-sync/continuous");

export const continuousLocal = <T = unknown>(action: string, body: unknown) =>
  local<T>("continuous/" + action, body);

export const configureContinuous = (settings: SyncSettings, enabled: boolean) =>
  continuousLocal("configure", { origin: settings.origin, enabled });

function connected(settings: SyncSettings, state: SyncState): Registry {
  if (
    !state.registry ||
    state.backendOrigin !== settings.origin ||
    state.registry.workspaceUuid !== state.workspaceUuid
  )
    throw new Error(
      "Refresh the schema for this workspace before synchronization.",
    );
  return state.registry;
}

export async function refreshRegistry(settings: SyncSettings) {
  const registry = await fetchRegistry(settings);
  await local("registry", { origin: settings.origin, registry });
  return registry;
}

export const fetchRegistry = (settings: SyncSettings) =>
  remote<Registry>(settings, "/schema");

export const previewSources = (
  settings: SyncSettings,
  workspaceUuid: string,
  sources: SourceRequest[],
) =>
  remote<{ items: SourceResult[] }>(settings, "/sources/preview", {
    workspaceUuid,
    sources,
  });

export const resolveSources = (
  settings: SyncSettings,
  workspaceUuid: string,
  sources: ApprovedSource[],
) =>
  remote<{ items: SourceResult[] }>(settings, "/sources/resolve", {
    workspaceUuid,
    sources,
  });

export const previewSelectors = (
  settings: SyncSettings,
  workspaceUuid: string,
  selectors: SelectorRequest[],
) =>
  remote<{ items: SelectorResult[]; schemaRevisionId: ServerId }>(
    settings,
    "/selectors/preview",
    {
      workspaceUuid,
      selectors,
    },
  );

export const listBulkJobs = () =>
  json<{ jobs: BulkJobSummary[]; sources: SourceBinding[] }>(
    localOrigin + "/backend-sync/bulk",
  );

export const readBulkJob = (operationId: string) =>
  json<StoredBulkJob>(
    localOrigin +
      "/backend-sync/bulk?operationId=" +
      encodeURIComponent(operationId),
  );

export const startBulkJob = (job: BulkJob) => local("bulkStart", job);

export const finishBulkItem = (job: BulkJob, progress: BulkProgress) =>
  local<BulkProgress>("bulkFinish", {
    workspaceUuid: job.workspaceUuid,
    operationId: job.operationId,
    progress,
  });

export function resolveRemoteObject(
  settings: SyncSettings,
  workspaceUuid: string,
  identity: Identity,
  action: ResolveAction,
  existingBusinessObjectId?: ServerId,
  signal?: AbortSignal,
) {
  return remote<ResolvedBusinessObject>(
    settings,
    "/objects/resolve",
    {
      workspaceUuid,
      identity,
      action,
      ...(existingBusinessObjectId && { existingBusinessObjectId }),
    },
    signal,
  );
}

export async function reconcile(
  settings: SyncSettings,
  state: SyncState,
  identity: Identity,
  action: ResolveAction,
  existingBusinessObjectId?: ServerId,
) {
  connected(settings, state);
  const object = await resolveRemoteObject(settings, state.workspaceUuid, identity, action, existingBusinessObjectId);
  if (state.registry?.revisionId !== object.schemaRevisionId)
    await refreshRegistry(settings);
  await local("binding", { workspaceUuid: state.workspaceUuid, object });
  return object;
}

export async function syncSelector(
  settings: SyncSettings,
  state: SyncState,
  rule: LegacyStoredRule,
  identity: Identity,
  sourceId: ServerId,
  publishReviewed: boolean,
) {
  connected(settings, state);
  if (!rule.selectorTree)
    throw new Error("This rule has no portable SelectorTree.");
  const found = resolveBusinessField(
    state,
    identity,
    rule.selectorTree.selector.target.field,
  );
  if (found.status === "UNRESOLVED") throw new Error(found.reason);
  const selector = await submitSelector(settings, state.workspaceUuid, {
    identity,
    sourceId,
    tree: selectorTreeDTO(rule.selectorTree),
    publishReviewed,
  });
  await local("selector", { workspaceUuid: state.workspaceUuid, selector });
  return selector;
}

type SelectorSubmission = SelectorRequest & {
  sourceId: ServerId;
  publishReviewed: boolean;
  expectedRevision?: ServerId | null;
  expectedSchemaRevisionId?: ServerId;
  expectedBusinessObjectFieldId?: ServerId;
};

export const submitSelector = (
  settings: SyncSettings,
  workspaceUuid: string,
  request: SelectorSubmission,
) =>
  remote<SelectorBinding>(settings, "/selectors", {
    workspaceUuid,
    ...request,
  });

export async function reportCapture(
  settings: SyncSettings,
  state: SyncState,
  rule: LegacyStoredRule,
  identity: Identity,
  sourceSnapshotId: ServerId,
) {
  connected(settings, state);
  const tree = rule.selectorTree;
  const previous =
    tree &&
    state.selectors.find((entry) => entry.selectorUuid === tree.selector.uuid);
  const evaluation = rule.selectorEvaluations
    ?.filter(
      (entry) =>
        entry.result.status === "success" &&
        entry.result.selectorVersionUuid === tree?.selector.activeVersionUuid,
    )
    .at(-1);
  if (!previous || !evaluation)
    throw new Error(
      "Synchronize this selector and record a successful evaluation first.",
    );
  return remote<{ status: string; observationIds: ServerId[] }>(
    settings,
    "/captures",
    {
      workspaceUuid: state.workspaceUuid,
      identity,
      selectorUuid: previous.selectorUuid,
      operationId: evaluation.uuid,
      pageUrl: evaluation.pageUrl,
      result: evaluation.result,
      sourceSnapshotId,
    },
  );
}

export const enqueueOperation = (operation: CommitOperation) =>
  local("enqueue", operation);

let flushing: Promise<void> | undefined;
let ordered: Promise<unknown> = Promise.resolve();
export function inSyncOrder<T>(operation: () => Promise<T>): Promise<T> {
  const run = ordered.then(operation, operation);
  ordered = run;
  return run;
}

export function flushQueue(settings: SyncSettings): Promise<void> {
  if (flushing) return flushing;
  flushing = inSyncOrder(() => sendQueue(settings)).finally(() => {
    flushing = undefined;
  });
  return flushing;
}

async function sendQueue(settings: SyncSettings) {
  const state = await readSyncState();
  connected(settings, state);
  for (const op of [...state.operations].reverse()) {
    if (!op.request || !["PENDING", "SYNC_ERROR"].includes(op.status)) continue;
    let status = "SYNCED";
    let result: OperationResult;
    try {
      result = await submitCommit(settings, op.request);
    } catch (error) {
      if (error instanceof SyncError) {
        status = [409, 422].includes(error.status) ? "CONFLICT" : "SYNC_ERROR";
        result = { ...error.detail, message: error.message };
      } else {
        status = "SYNC_ERROR";
        result = { code: "BACKEND_UNAVAILABLE" };
      }
    }
    await local("finish", {
      workspaceUuid: state.workspaceUuid,
      operationId: op.operationId,
      status,
      result,
    });
    if (status === "SYNC_ERROR") return;
  }
}

export const submitCommit = (settings: SyncSettings, request: CommitRequest, signal?: AbortSignal) =>
  remote<OperationResult>(settings, "/commits", request, signal);

export async function persistReviewedCommit(
  before: LegacyStorageState | null,
  committed: LegacyStorageState,
  expectedRevision: number,
  reviewedObjectIds?: string[],
): Promise<void> {
  const settings = await readSyncSettings().catch(() => null);
  let operation: CommitOperation | null = null;
  if (settings?.syncApprovedCommits) {
    const state = await readSyncState();
    if (state.registry && state.backendOrigin === settings.origin)
      operation = makeCommitPreview(state, before, committed).operation;
  }
  const synced = await json<{ legacyQueued?: boolean }>(localOrigin + "/state/commit", {
    state: committed,
    expectedRevision,
    reviewedObjectIds,
    operation,
  });
  if (settings && operation?.request && synced.legacyQueued !== false)
    void flushQueue(settings).catch(() => undefined);
}
