import type { CommitSummary } from "../shared/commits/summary";

let pending: Promise<CommitSummary> | undefined;
let generation = 0;
window.addEventListener("burbot:commit-changed", () => generation++);
window.addEventListener("burbot:workspace-state-changed", () => generation++);

async function load(): Promise<CommitSummary> {
  // If an edit lands during the IPC round trip, retry the small projection.
  // Never let navigation display the response from before that edit.
  for (;;) {
    const requestedAt = generation;
    const response = await browser.runtime.sendMessage({
      type: "BURBOT_COMMIT",
      op: "SUMMARY",
    });
    if (requestedAt !== generation) continue;
    if (!response?.ok || !response.value)
      throw new Error(response?.error ?? "Storage is unavailable.");
    return response.value;
  }
}

export function readCommitSummary(): Promise<CommitSummary> {
  return (pending ??= load().finally(() => {
    pending = undefined;
  }));
}
