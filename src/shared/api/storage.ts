import type { BurbotState } from "../types/domain";

export const STORAGE_KEY = "burbot:v1";

export async function loadState(): Promise<BurbotState> {
  const saved = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    | BurbotState
    | undefined;

  if (
    saved &&
    (saved.version !== 1 ||
      !Array.isArray(saved.objects) ||
      !Array.isArray(saved.rules))
  ) {
    throw new Error("Unsupported stored data format.");
  }

  return saved ?? (BurbotCore.empty() as BurbotState);
}

export async function saveState(state: BurbotState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}
