import { resetDatabase, sqliteDatabaseInfo } from "../sqlite/database";
import { loadStateFromSqlite, saveStateToSqlite } from "../sqlite/stateRepository";
import type { LegacyStorageState } from "../types/legacy-storage";

/**
 * Pre-SQLite key. After migration this is only a UI/event mirror for existing
 * storage.onChanged listeners. SQLite is the source of truth.
 */
export const STORAGE_KEY = "burbot:v1";

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

async function updateUiMirror(state: LegacyStorageState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}

export async function loadState(): Promise<LegacyStorageState> {
  const sqlite = await loadStateFromSqlite();
  if (sqlite) return sqlite;

  const legacy = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    | LegacyStorageState
    | undefined;

  if (legacy) {
    assertLegacyState(legacy);
    await saveStateToSqlite(legacy);
    await updateUiMirror(legacy);
    return legacy;
  }

  const empty = BurbotCore.empty() as LegacyStorageState;
  await saveStateToSqlite(empty);
  await updateUiMirror(empty);
  return empty;
}

export async function saveState(state: LegacyStorageState): Promise<void> {
  await saveStateToSqlite(state);
  await updateUiMirror(state);
}

export async function resetWorkspaceStorage(): Promise<void> {
  await resetDatabase();
  await browser.storage.local.remove(STORAGE_KEY);
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
