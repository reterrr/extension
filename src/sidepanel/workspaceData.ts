import type { LegacyStorageState } from "../shared/types/legacy-storage";

let snapshot: LegacyStorageState | undefined;
let pending: Promise<LegacyStorageState> | undefined;
let refreshPending: Promise<LegacyStorageState> | undefined;
let generation = 0;

window.addEventListener("burbot:workspace-state-changed", (event) => {
  const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail
    ?.state;
  if (!next) return;
  generation++;
  snapshot = next;
});

/** One initial IPC read per panel; lazy features adopt the latest live snapshot. */
export function readWorkspaceState(
  refresh = false,
): Promise<LegacyStorageState> {
  if (refreshPending) return refreshPending;
  if (refresh && pending) {
    // Object creation may update View while the initial GET is in flight.
    // A forced read must run after it, rather than reuse that older response.
    refreshPending = pending
      .catch(() => undefined)
      .then(() => fetchState())
      .finally(() => {
        refreshPending = undefined;
      });
    return refreshPending;
  }
  if (pending) return pending;
  if (snapshot && !refresh) return Promise.resolve(snapshot);
  return fetchState();
}

function fetchState(): Promise<LegacyStorageState> {
  if (pending) return pending;
  const requestedAt = generation;
  pending = browser.runtime
    .sendMessage({ type: "BURBOT_DATA", op: "GET" })
    .then(
      (response: {
        ok?: boolean;
        value?: LegacyStorageState;
        error?: string;
      }) => {
        if (!response?.ok || !response.value)
          throw new Error(response?.error ?? "Storage is unavailable.");
        // A live edit can arrive while an older GET is still in flight.
        if (generation === requestedAt || !snapshot) snapshot = response.value;
        return snapshot;
      },
    )
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function peekWorkspaceState(): LegacyStorageState | undefined {
  return snapshot;
}
