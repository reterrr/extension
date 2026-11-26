import {
  maxSnapshotBytes,
  maxVisualArchiveBytes,
  settingsKey,
  sha256,
  validateSettings,
  visualArchiveVersion,
  type Settings,
} from "../shared/monitoring/contracts";
import {
  archiveTabKey,
  snapshotDeliveries,
  uuid,
  type SnapshotDelivery,
  type SnapshotOutcome,
  type SnapshotTabContext,
} from "../shared/monitoring/snapshot-delivery";
import { archiveDocument } from "../shared/monitoring/archive-document";
import { closeArchiveLauncher, loadArchiveTab } from "./archive-tab";
import { agentFetch } from "./monitoring-request";

const queue = "agents/snapshot-commands/";
const wakeAlarm = "burbot-snapshot-bridge";
const pollInterval = 2_000;
const timeout = 12_000;

interface ClaimedCommand {
  commandId: string;
  sourceId: number;
  snapshotId: number;
  targetAgentId: string;
  expiresAt: string;
  sourceUrl: string | null;
  capturedAt: string;
  selectorContext?: SnapshotTabContext["selectorContext"];
}

const artifactErrors = new Set([
  "SNAPSHOT_ARTIFACT_NOT_FOUND",
  "SNAPSHOT_INTEGRITY_MISMATCH",
  "SNAPSHOT_TOO_LARGE",
  "SNAPSHOT_NOT_HTML",
  "SNAPSHOT_DIGEST_UNAVAILABLE",
  "SNAPSHOT_SOURCE_FORBIDDEN",
]);

class SnapshotError extends Error {}

function claimed(value: unknown): ClaimedCommand | null {
  if (!value || typeof value !== "object") return null;
  const data = value as ClaimedCommand & { action: string; state: string };
  return data.action === "open_snapshot" &&
    data.state === "claimed" &&
    typeof data.commandId === "string" &&
    uuid.test(data.commandId) &&
    typeof data.targetAgentId === "string" &&
    uuid.test(data.targetAgentId) &&
    Number.isSafeInteger(data.sourceId) &&
    data.sourceId > 0 &&
    Number.isSafeInteger(data.snapshotId) &&
    data.snapshotId > 0 &&
    typeof data.expiresAt === "string" &&
    Date.parse(data.expiresAt) > Date.now() &&
    typeof data.capturedAt === "string" &&
    Number.isFinite(Date.parse(data.capturedAt)) &&
    (data.sourceUrl === null || typeof data.sourceUrl === "string")
    ? data
    : null;
}

export async function readSnapshotArtifact(
  response: Response,
): Promise<{ html: string; format: SnapshotTabContext["format"] }> {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const code = data?.detail?.code;
    throw new SnapshotError(
      artifactErrors.has(code) ? code : "SNAPSHOT_UNAVAILABLE",
    );
  }
  const sizeHeader = response.headers.get("X-Burbot-Snapshot-Size") ?? "";
  const size = Number(sizeHeader);
  const digest = response.headers.get("X-Burbot-Snapshot-SHA256") ?? "";
  const format = response.headers.get("X-Burbot-Snapshot-Format") ?? "evidence";
  if (
    response.headers.get("Content-Type")?.split(";")[0] !==
      "application/octet-stream" ||
    response.headers.get("X-Burbot-Snapshot-Mime") !== "text/html" ||
    (format !== "evidence" && format !== visualArchiveVersion) ||
    !/^\d+$/.test(sizeHeader) ||
    size <= 0 ||
    size >
      (format === visualArchiveVersion
        ? maxVisualArchiveBytes
        : maxSnapshotBytes) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !response.body
  ) {
    throw new SnapshotError("INVALID_ARTIFACT");
  }
  const bytes = new Uint8Array(size);
  const reader = response.body.getReader();
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (seen + value.length > size)
        throw new SnapshotError("INVALID_ARTIFACT");
      bytes.set(value, seen);
      seen += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (seen !== size || (await sha256(bytes)) !== digest)
    throw new SnapshotError("SNAPSHOT_INTEGRITY_MISMATCH");
  try {
    return {
      html: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      format,
    };
  } catch {
    throw new SnapshotError("INVALID_ARTIFACT");
  }
}

function failure(error: unknown): SnapshotOutcome {
  return {
    state: "failed",
    errorCode:
      error instanceof SnapshotError
        ? error.message
        : error instanceof DOMException && error.name === "TimeoutError"
          ? "BACKEND_TIMEOUT"
          : "SNAPSHOT_UNAVAILABLE",
  };
}

async function openCommand(
  settings: Settings,
  command: ClaimedCommand,
  scope: string,
  signal: AbortSignal,
) {
  const {
    commandId: id,
    sourceId,
    snapshotId,
    sourceUrl,
    selectorContext,
  } = command;
  const existing = await snapshotDeliveries.get(id);
  if (existing) {
    if (existing.scope !== scope)
      return { state: "failed", errorCode: "VIEWER_INTERRUPTED" } as const;
    if (existing.outcome) return existing.outcome;
    // A previous background may have stopped between creating the tab and recording its ID.
    // Never create another tab once the durable opening record exists.
    const tabContext =
      existing.tabId === undefined
        ? null
        : ((await browser.sessions
            .getTabValue(existing.tabId, archiveTabKey)
            .catch(() => null)) as SnapshotTabContext | null);
    const outcome: SnapshotOutcome =
      tabContext?.commandId === id
        ? { state: "opened" }
        : { state: "failed", errorCode: "VIEWER_INTERRUPTED" };
    if (outcome.state === "failed" && existing.tabId !== undefined)
      await closeArchiveLauncher(existing.tabId, id);
    await snapshotDeliveries.put({ ...existing, outcome });
    return outcome;
  }

  const record: SnapshotDelivery = {
    id,
    scope,
    expiresAt: Date.parse(command.expiresAt),
  };
  let html: string;
  let format: SnapshotTabContext["format"];
  try {
    const response = await agentFetch(settings, queue + id + "/artifact", {
      method: "GET",
      signal,
      timeout,
      headers: { "X-Burbot-Snapshot-Accept": visualArchiveVersion },
    });
    const artifact = await readSnapshotArtifact(response);
    signal.throwIfAborted();
    if (record.expiresAt <= Date.now()) return null;
    format = artifact.format;
    html = archiveDocument(artifact.html, sourceUrl ?? undefined);
  } catch (error) {
    if (signal.aborted) return null;
    const outcome = failure(error);
    await snapshotDeliveries.put({ ...record, outcome });
    return outcome;
  }
  await snapshotDeliveries.put(record);
  if (signal.aborted || record.expiresAt <= Date.now()) return null;
  try {
    const tab = await browser.tabs.create({
      url: "about:blank",
      active: false,
    });
    if (tab.id === undefined) throw new Error("Archive tab unavailable");
    record.tabId = tab.id;
    await snapshotDeliveries.put(record);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(Math.max(0, record.expiresAt - Date.now())),
    ]);
    await loadArchiveTab(
      tab.id,
      html,
      { commandId: id, sourceId, snapshotId, format, selectorContext },
      deadline,
    );
  } catch {
    const outcome = {
      state: "failed",
      errorCode: "VIEWER_OPEN_FAILED",
    } as const;
    if (record.tabId !== undefined)
      await closeArchiveLauncher(record.tabId, id, true);
    await snapshotDeliveries.put({ ...record, outcome });
    return outcome;
  }
  const outcome = { state: "opened" } as const;
  await snapshotDeliveries.put({ ...record, outcome });
  return outcome;
}

export async function pollSnapshotCommands(
  settings: Settings,
  signal: AbortSignal,
) {
  const response = await agentFetch(settings, queue + "claim", {
    signal,
    timeout,
  });
  if (!response.ok || response.status === 204) return;
  const command = claimed(await response.json());
  if (!command) return;
  await snapshotDeliveries.prune(Date.now());
  const scope = await sha256(
    new TextEncoder().encode(settings.apiOrigin + "\n" + settings.agentToken),
  );
  const result = await openCommand(settings, command, scope, signal);
  if (result && Date.parse(command.expiresAt) > Date.now())
    await agentFetch(settings, queue + command.commandId + "/ack", {
      body: result,
      signal,
      timeout,
    });
}

export function installSnapshotBridge() {
  if (!browser.alarms) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: AbortController | undefined;

  async function tick() {
    if (current) return;
    const run = new AbortController();
    current = run;
    let enabled = false;
    try {
      const stored = (await browser.storage.local.get(settingsKey))[
        settingsKey
      ] as Settings | undefined;
      enabled = stored?.enabled === true;
      if (enabled && stored)
        await pollSnapshotCommands(validateSettings(stored), run.signal);
    } catch {
      // Temporary transport failures keep the polling loop and the local delivery journal intact.
    } finally {
      current = undefined;
      if (enabled || run.signal.aborted)
        schedule(run.signal.aborted ? 0 : pollInterval);
      else await browser.alarms.clear(wakeAlarm);
    }
  }

  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), delay);
  }

  function start() {
    // The alarm also wakes Firefox's non-persistent background after suspension.
    browser.alarms.create(wakeAlarm, { periodInMinutes: 0.5 });
    if (current) current.abort();
    else schedule();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[settingsKey]) start();
  });
  browser.alarms.onAlarm.addListener(({ name }) => {
    if (name === wakeAlarm) schedule();
  });
  browser.runtime.onStartup.addListener(start);
  start();
}
