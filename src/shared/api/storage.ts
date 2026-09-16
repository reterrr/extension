import { resetDatabase, sqliteDatabaseInfo } from "../sqlite/database";
import { loadStateFromSqlite, saveStateToSqlite } from "../sqlite/stateRepository";
import {
  LEGACY_STORAGE_KEY,
  SQLITE_REVISION_SIGNAL_KEY,
} from "../storage/constants";
import type { LegacyStorageState } from "../types/legacy-storage";

/** Backward-compatible export used by migration/tests. */
export const STORAGE_KEY = LEGACY_STORAGE_KEY;
export { SQLITE_REVISION_SIGNAL_KEY };

function assertLegacyState(value: unknown): asserts value is LegacyStorageState {
  const state = value as LegacyStorageState | undefined;
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.objects) ||
    !Array.isArray(state.rules)
  ) {
    throw new Error("Unsupported stored data format.");
  }
}

async function signalRevision(revision: number): Promise<void> {
  await browser.storage.local.set({ [SQLITE_REVISION_SIGNAL_KEY]: revision });
}

export async function loadState(): Promise<LegacyStorageState> {
  const sqlite = await loadStateFromSqlite();
  if (sqlite) return sqlite;

  const legacy = (await browser.storage.local.get(LEGACY_STORAGE_KEY))[
    LEGACY_STORAGE_KEY
  ] as LegacyStorageState | undefined;

  if (legacy) {
    assertLegacyState(legacy);
    await saveStateToSqlite(legacy);
    await browser.storage.local.remove(LEGACY_STORAGE_KEY);
    await signalRevision(legacy.revision);
    return legacy;
  }

  const empty = BurbotCore.empty() as LegacyStorageState;
  await saveStateToSqlite(empty);
  await signalRevision(empty.revision);
  return empty;
}

export async function saveState(state: LegacyStorageState): Promise<void> {
  await saveStateToSqlite(state);
  await signalRevision(state.revision);
}

export async function resetWorkspaceStorage(): Promise<void> {
  await resetDatabase();
  await browser.storage.local.remove([
    LEGACY_STORAGE_KEY,
    SQLITE_REVISION_SIGNAL_KEY,
  ]);
}

export async function workspaceStorageInfo(): Promise<{
  engine: "sqlite-wasm";
  schemaVersion: number;
  bytes: number;
}> {
  const info = await sqliteDatabaseInfo();
  return {
    engine: "sqlite-wasm",
    ...info,
  };
}
