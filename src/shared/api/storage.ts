import type { LegacyStorageState } from "../types/legacy-storage";

export const STORAGE_KEY = "burbot:v1";

export async function loadState(): Promise<LegacyStorageState> {
  const saved = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    | LegacyStorageState
    | undefined;

  if (
    saved &&
    (saved.version !== 1 ||
      !Array.isArray(saved.objects) ||
      !Array.isArray(saved.rules))
  ) {
    throw new Error("Unsupported stored data format.");
  }

  return saved ?? (BurbotCore.empty() as LegacyStorageState);
}

export async function saveState(state: LegacyStorageState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}
