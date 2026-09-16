import { clearActiveDraft } from "../commits/draftStore";
import { LEGACY_STORAGE_KEY } from "../storage/constants";
import type { LegacyStorageState } from "../types/legacy-storage";

/**
 * Temporary UI mirror for existing storage.onChanged listeners.
 * SQLite on disk is the source of truth for committed data.
 */
export const STORAGE_KEY = LEGACY_STORAGE_KEY;

const DB_SERVICE_URL = "http://127.0.0.1:8765";

export interface WorkspaceStorageInfo {
  engine: "sqlite-file";
  schemaVersion: number;
  bytes: number;
  path: string;
  revision: number;
  objects: number;
  rules: number;
}

function assertLegacyState(value: unknown): asserts value is LegacyStorageState {
  const state = value as LegacyStorageState | undefined;
  if (
    !state ||
    state.version !== 1 ||
    !Number.isInteger(state.revision) ||
    !Array.isArray(state.objects) ||
    !Array.isArray(state.rules)
  ) {
    throw new Error("Unsupported stored data format.");
  }
}

function emptyState(): LegacyStorageState {
  return {
    version: 1,
    revision: 0,
    objects: [],
    rules: [],
    geographies: [],
    fileSources: [],
    importSources: [],
    financingRules: [],
    documentRequirements: [],
  };
}

function serviceUnavailable(cause?: unknown): Error {
  const suffix = cause instanceof Error ? ` (${cause.message})` : "";
  return new Error(
    `Burbot local DB service is not running. Start it with \"npm run db\".${suffix}`,
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${DB_SERVICE_URL}${path}`, init);
  } catch (cause) {
    throw serviceUnavailable(cause);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `HTTP ${response.status}`;
}

export async function publishUiState(state: LegacyStorageState): Promise<void> {
  await browser.storage.local.set({ [LEGACY_STORAGE_KEY]: state });
}

async function loadRemoteState(): Promise<LegacyStorageState | null> {
  const response = await request("/state");
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await readError(response));

  const value: unknown = await response.json();
  assertLegacyState(value);
  return value;
}

async function saveRemoteState(state: LegacyStorageState): Promise<void> {
  assertLegacyState(state);
  const response = await request("/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function loadState(): Promise<LegacyStorageState> {
  const remote = await loadRemoteState();
  if (remote) {
    await publishUiState(remote);
    return remote;
  }

  // One-time migration from the pre-file-SQLite extension state.
  const legacy = (await browser.storage.local.get(LEGACY_STORAGE_KEY))[
    LEGACY_STORAGE_KEY
  ] as LegacyStorageState | undefined;

  if (legacy) {
    assertLegacyState(legacy);
    await saveRemoteState(legacy);
    await publishUiState(legacy);
    return legacy;
  }

  const empty = emptyState();
  await saveRemoteState(empty);
  await publishUiState(empty);
  return empty;
}

/**
 * Immediate write kept for initialization/migration utilities.
 * Interactive workspace edits should go through a draft commit instead.
 */
export async function saveState(state: LegacyStorageState): Promise<void> {
  await saveRemoteState(state);
  await publishUiState(state);
}

/**
 * Finalizes one staged commit. The database service already persists PUT /state
 * as one SQLite transaction. We additionally verify that the committed state did
 * not move since the draft was created.
 */
export async function commitState(
  baseRevision: number,
  workingState: LegacyStorageState,
): Promise<LegacyStorageState> {
  assertLegacyState(workingState);
  const current = await loadRemoteState();
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== baseRevision) {
    throw new Error(
      `Commit conflict: SQLite is at revision ${currentRevision}, while this commit started from revision ${baseRevision}.`,
    );
  }

  const committed = JSON.parse(JSON.stringify(workingState)) as LegacyStorageState;
  committed.revision = baseRevision + 1;
  await saveRemoteState(committed);
  await publishUiState(committed);
  return committed;
}

export async function resetWorkspaceStorage(): Promise<void> {
  const response = await request("/state", { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    throw new Error(await readError(response));
  }
  await clearActiveDraft();
  await browser.storage.local.remove(LEGACY_STORAGE_KEY);
}

export async function workspaceStorageInfo(): Promise<WorkspaceStorageInfo> {
  const response = await request("/info");
  if (!response.ok) throw new Error(await readError(response));

  const value = (await response.json()) as Partial<WorkspaceStorageInfo>;
  if (
    value.engine !== "sqlite-file" ||
    typeof value.schemaVersion !== "number" ||
    typeof value.bytes !== "number" ||
    typeof value.path !== "string" ||
    typeof value.revision !== "number" ||
    typeof value.objects !== "number" ||
    typeof value.rules !== "number"
  ) {
    throw new Error("Invalid response from Burbot local DB service.");
  }

  return value as WorkspaceStorageInfo;
}
