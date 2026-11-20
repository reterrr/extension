import { selectorTreeDTO } from "../selectors/dto";
import type { LegacyStorageState } from "../types/legacy-storage";
import {
  fetchRegistry,
  listBulkJobs,
  previewSelectors,
  previewSources,
  readSyncState,
  SyncError,
} from "./client";
import { localRecords, resolveSelectorTarget } from "./resolve";
import type { SyncSettings, SyncState } from "./types";
import type {
  BulkJob,
  BulkPlan,
  BulkRow,
  Discovery,
  LocalSourceCandidate,
  SelectorRequest,
  SelectorResult,
  SelectorTask,
  SourceBinding,
  SourceRequest,
  SourceResult,
  SourceTask,
  SourceType,
} from "./bulkTypes";

export async function verifyBulkWorkspace(settings: SyncSettings) {
  const [state, registry] = await Promise.all([
    readSyncState(),
    fetchRegistry(settings),
  ]);
  if (
    state.backendOrigin !== settings.origin ||
    state.workspaceUuid !== registry.workspaceUuid ||
    state.registry?.businessModelId !== registry.businessModelId
  )
    throw new Error(
      "Connect this SQLite workspace to the current Burbot workspace first.",
    );
  return { ...state, registry };
}

export const sourceReasons: Partial<Record<SourceResult["status"], string>> = {
  SOURCE_MISSING:
    "The Source is missing and this workspace cannot register it.",
  SOURCE_GRANT_REQUIRED:
    "An administrator needs to grant access to this Source.",
  SOURCE_TYPE_MISMATCH: "The existing Source has a different type.",
  SOURCE_UNAVAILABLE: "The Source is archived or blocked by policy.",
  SOURCE_ORIGIN_DENIED:
    "This Source origin has not been approved for the workspace.",
  SOURCE_URL_INVALID: "The URL is invalid or disallowed by the Source policy.",
  SOURCE_CHANGED:
    "The Source identity changed. Preview the synchronization again.",
};

function sourceRow(
  candidate: LocalSourceCandidate,
  remote?: SourceResult,
): BulkRow {
  const { key, type, url, provenance, issue } = candidate;
  const row: BulkRow = {
    key,
    kind: "source",
    label: type,
    url: url ?? undefined,
    provenance,
    status: "UNSUPPORTED",
  };
  if (issue)
    return {
      ...row,
      status: issue,
      reason:
        issue === "SOURCE_URL_INVALID"
          ? sourceReasons.SOURCE_URL_INVALID
          : "No supported HTTP(S) Source was found in this record.",
    };
  if (!remote)
    return {
      ...row,
      status: "SYNC_ERROR",
      reason: "The Source preview did not return this candidate.",
    };
  if (remote.canonicalUrl && remote.canonicalUrl !== url)
    return {
      ...row,
      status: "SOURCE_URL_INVALID",
      reason:
        "Burbot normalized this URL differently. Correct the URL before synchronizing.",
    };
  if (remote.status === "EXISTING_SOURCE" && remote.sourceId)
    return {
      ...row,
      status: "ALREADY_SYNCED",
      sourceId: remote.sourceId,
      reason: "The existing Source is already granted.",
    };
  if (
    remote.status === "SOURCE_GRANT_REQUIRED" &&
    remote.canGrantExisting &&
    remote.sourceId
  )
    return {
      ...row,
      status: remote.status,
      sourceId: remote.sourceId,
      reason: "Grant this workspace access to the existing Source.",
    };
  if (remote.status === "SOURCE_MISSING" && remote.canCreate)
    return {
      ...row,
      status: remote.status,
      reason: "Register this URL and grant access to the workspace.",
    };
  if (remote.status === "SOURCE_TYPE_MISMATCH" && remote.actualType)
    return {
      ...row,
      status: remote.status,
      reason: `The existing Source is ${remote.actualType}.`,
    };
  return {
    ...row,
    status:
      remote.status === "EXISTING_SOURCE" || remote.status === "RESOLVED"
        ? "SYNC_ERROR"
        : remote.status,
    reason:
      sourceReasons[remote.status] ?? "Burbot did not confirm the Source.",
  };
}

async function reconcileSources(
  settings: SyncSettings,
  workspaceUuid: string,
  discovery: Discovery,
  cached: SourceBinding[],
) {
  const requests: SourceRequest[] = discovery.sources.flatMap(
    ({ key, url, type, issue }) =>
      url && type !== "UNSUPPORTED" && !issue
        ? [{ clientKey: key, url, type }]
        : [],
  );
  const remote = new Map<string, SourceResult>();
  for (let offset = 0; offset < requests.length; offset += 30) {
    const result = await previewSources(
      settings,
      workspaceUuid,
      requests.slice(offset, offset + 30),
    );
    for (const item of result.items) remote.set(item.clientKey, item);
  }
  const counts = new Map<string, number>();
  for (const request of requests)
    counts.set(request.url, (counts.get(request.url) ?? 0) + 1);
  const rows: BulkRow[] = [];
  const sources = new Map<string, SourceTask>();
  const previous = new Map(
    cached.map((binding) => [binding.localSourceKey, binding]),
  );
  for (const candidate of discovery.sources) {
    const result = remote.get(candidate.key);
    let row = sourceRow(candidate, result);
    if (
      candidate.url &&
      row.status === "SOURCE_MISSING" &&
      (counts.get(candidate.url) ?? 0) > 1
    )
      row = {
        ...row,
        status: "SOURCE_TYPE_MISMATCH",
        reason:
          "Local records assign different Source types to this unregistered URL.",
      };
    const binding = previous.get(row.key);
    if (
      binding &&
      (row.status === "SOURCE_MISSING" ||
        (row.sourceId && binding.backendSourceId !== row.sourceId))
    )
      row = {
        ...row,
        status: "SOURCE_CHANGED",
        reason:
          "This URL has a different saved Source binding. Ask an administrator to check the Source identity.",
      };
    rows.push(row);
    const allowCreate =
      row.status === "SOURCE_MISSING" && result?.canCreate === true;
    const allowGrantExisting =
      row.status === "SOURCE_GRANT_REQUIRED" &&
      result?.canGrantExisting === true;
    if (
      candidate.url &&
      (row.status === "ALREADY_SYNCED" || allowCreate || allowGrantExisting)
    ) {
      sources.set(row.key, {
        key: row.key,
        kind: "source",
        localKeys: [row.key, ...candidate.localKeys],
        request: {
          clientKey: row.key,
          url: candidate.url,
          type: candidate.type as SourceType,
          allowCreate,
          allowGrantExisting,
          ...(row.sourceId ? { expectedSourceId: row.sourceId } : {}),
        },
      });
    }
  }
  return { rows, sources };
}

interface SelectorCheck {
  row: BulkRow;
  request: SelectorRequest;
  task: Omit<
    SelectorTask,
    "expectedRevision" | "alreadySynced" | "publishReviewed"
  >;
}

function prepareSelectors(
  sync: SyncState,
  snapshot: LegacyStorageState,
  discovery: Discovery,
  sources: Map<string, SourceTask>,
  rows: BulkRow[],
) {
  const records = localRecords(snapshot);
  const sourceRows = new Map(rows.map((row) => [row.key, row]));
  const counts = new Map<string, number>();
  for (const { rule } of discovery.selectors) {
    const uuid = rule.selectorTree?.selector.uuid;
    if (uuid) counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
  }
  const checks: SelectorCheck[] = [];
  const encoder = new TextEncoder();
  for (const {
    key,
    rule,
    sourceKeys,
    pendingEvidence,
  } of discovery.selectors) {
    const selector = rule.selectorTree?.selector;
    const row: BulkRow = {
      key,
      kind: "selector",
      label: selector
        ? `${selector.target.field} · ${selector.uuid}`
        : `${rule.field} · ${rule.id}`,
      objectId: selector?.target.objectId ?? rule.objectId,
      status: "UNSUPPORTED",
      pendingEvidence,
    };
    rows.push(row);
    if (!rule.selectorTree || !selector) {
      row.reason = "This rule does not have a portable SelectorTree.";
      continue;
    }
    if ((counts.get(selector.uuid) ?? 0) > 1) {
      Object.assign(row, {
        status: "SELECTOR_CONFLICT",
        reason: "This selector UUID appears more than once in SQLite.",
      });
      continue;
    }
    if (sourceKeys.length !== 1) {
      Object.assign(
        row,
        sourceKeys.length
          ? {
              status: "SOURCE_AMBIGUOUS",
              reason: "Choose a Source URL for this selector.",
            }
          : {
              status: "SOURCE_MISSING",
              reason: "No Source URL was found for this selector.",
            },
      );
      continue;
    }
    const sourceKey = sourceKeys[0];
    const source = sources.get(sourceKey);
    const sourcePreview = sourceRows.get(sourceKey)!;
    Object.assign(row, {
      sourceKey,
      url: sourcePreview.url,
      sourceId: sourcePreview.sourceId,
    });
    if (!source) {
      Object.assign(row, {
        status: sourcePreview.status,
        reason: sourcePreview.reason,
      });
      continue;
    }
    if (source.request.type !== "HTML") {
      Object.assign(row, {
        status: "SOURCE_TYPE_MISMATCH",
        reason: "SelectorTrees require an HTML Source.",
      });
      continue;
    }
    const target = resolveSelectorTarget(sync, rule, records);
    if (target.status !== "READY") {
      Object.assign(row, { status: target.status, reason: target.reason });
      continue;
    }
    let request: SelectorRequest;
    try {
      request = {
        identity: target.identity,
        tree: selectorTreeDTO(rule.selectorTree),
        sourceUrl: source.request.url,
        ...(sourcePreview.sourceId ? { sourceId: sourcePreview.sourceId } : {}),
      };
    } catch (error) {
      row.reason =
        error instanceof Error ? error.message : "The SelectorTree is invalid.";
      continue;
    }
    if (encoder.encode(JSON.stringify(request)).length > maxSelectorBytes) {
      row.reason = "This SelectorTree exceeds the server request limit.";
      continue;
    }
    checks.push({
      row,
      request,
      task: {
        key,
        kind: "selector",
        request,
        sourceKey,
        expectedBusinessObjectFieldId: target.field.businessObjectFieldId,
      },
    });
  }
  return checks;
}

// Keep preview batches within the backend's 8 MiB request limit, including the envelope.
const maxSelectorBytes = 7 * 1024 * 1024;
const maxSelectorCount = 20;

function* selectorBatches(checks: SelectorCheck[]) {
  const encoder = new TextEncoder();
  let batch: SelectorCheck[] = [];
  let bytes = 0;
  for (const check of checks) {
    const size = encoder.encode(JSON.stringify(check.request)).length + 1;
    if (
      batch.length &&
      (batch.length === maxSelectorCount || bytes + size > maxSelectorBytes)
    ) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(check);
    bytes += size;
  }
  if (batch.length) yield batch;
}

async function checkSelectors(
  settings: SyncSettings,
  workspaceUuid: string,
  schemaRevisionId: string,
  checks: SelectorCheck[],
): Promise<SelectorResult[]> {
  try {
    const result = await previewSelectors(
      settings,
      workspaceUuid,
      checks.map(({ request }) => request),
    );
    if (result.schemaRevisionId !== schemaRevisionId)
      throw new Error(
        "The Burbot schema changed during preview. Preview again.",
      );
    return result.items;
  } catch (error) {
    if (!(error instanceof SyncError) || error.status !== 422) throw error;
    if (checks.length === 1)
      return [
        {
          selectorUuid: checks[0].request.tree.selector.uuid,
          status: "UNSUPPORTED",
          reason: "The backend rejected this portable SelectorTree.",
        },
      ];
    const middle = Math.ceil(checks.length / 2);
    return [
      ...(await checkSelectors(
        settings,
        workspaceUuid,
        schemaRevisionId,
        checks.slice(0, middle),
      )),
      ...(await checkSelectors(
        settings,
        workspaceUuid,
        schemaRevisionId,
        checks.slice(middle),
      )),
    ];
  }
}

export async function makeBulkPreview(
  settings: SyncSettings,
  snapshot: LegacyStorageState,
  discovery: Discovery,
): Promise<BulkPlan> {
  const [sync, cached] = await Promise.all([
    verifyBulkWorkspace(settings),
    listBulkJobs(),
  ]);
  const { workspaceUuid, registry } = sync;
  const { rows, sources } = await reconcileSources(
    settings,
    workspaceUuid,
    discovery,
    cached.sources,
  );
  const selectors: SelectorTask[] = [];
  for (const batch of selectorBatches(
    prepareSelectors(sync, snapshot, discovery, sources, rows),
  )) {
    const items = await checkSelectors(
      settings,
      workspaceUuid,
      registry.revisionId,
      batch,
    );
    const results = new Map(items.map((item) => [item.selectorUuid, item]));
    for (const { row, request, task } of batch) {
      const result = results.get(request.tree.selector.uuid);
      if (!result) {
        Object.assign(row, {
          status: "SYNC_ERROR",
          reason: "The selector preview did not return this item.",
        });
        continue;
      }
      Object.assign(row, { status: result.status, reason: result.reason });
      if (
        !["READY", "ALREADY_SYNCED", "SELECTOR_REVIEW_REQUIRED"].includes(
          result.status,
        )
      )
        continue;
      if (
        result.businessObjectFieldId !== task.expectedBusinessObjectFieldId ||
        result.revision === undefined ||
        (result.status === "ALREADY_SYNCED" && !result.binding)
      ) {
        Object.assign(row, {
          status: "SELECTOR_CONFLICT",
          reason:
            "The server target differs from the saved local binding. Refresh the object binding and preview again.",
        });
        continue;
      }
      if (result.status === "SELECTOR_REVIEW_REQUIRED")
        row.reason =
          "Explicit approval is required to publish locally reviewed versions.";
      if (result.status === "READY")
        row.reason =
          "The selector can synchronize after its Source is confirmed.";
      row.businessObjectFieldId = result.businessObjectFieldId;
      selectors.push({
        ...task,
        expectedRevision: result.revision,
        alreadySynced: result.status === "ALREADY_SYNCED",
        publishReviewed: result.status === "SELECTOR_REVIEW_REQUIRED",
      });
    }
  }
  return {
    workspaceUuid,
    backendOrigin: settings.origin,
    localRevision: snapshot.revision,
    schemaRevisionId: registry.revisionId,
    pendingEvidence: discovery.pendingEvidence,
    rows,
    sources: [...sources.values()],
    selectors,
  };
}

export function approveBulkPreview(
  plan: BulkPlan,
  selection: ReadonlySet<string>,
  publishReviewed: boolean,
): BulkJob {
  const sources = plan.sources.filter(({ key }) => selection.has(key));
  const selectors = plan.selectors.filter(({ key }) => selection.has(key));
  if (
    selectors.some(({ publishReviewed: review }) => review && !publishReviewed)
  )
    throw new Error(
      "Approve publication of the selected reviewed versions first.",
    );
  const sourceKeys = new Set(sources.map(({ key }) => key));
  if (selectors.some(({ sourceKey }) => !sourceKeys.has(sourceKey)))
    throw new Error(
      "Select each selected selector's Source before synchronizing.",
    );
  if (!sources.length && !selectors.length)
    throw new Error("Select eligible items first.");
  return {
    operationId: crypto.randomUUID(),
    workspaceUuid: plan.workspaceUuid,
    backendOrigin: plan.backendOrigin,
    localRevision: plan.localRevision,
    schemaRevisionId: plan.schemaRevisionId,
    pendingEvidence: plan.pendingEvidence,
    report: plan.rows,
    tasks: [...sources, ...selectors],
  };
}
