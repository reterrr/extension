import type { LegacyStorageState } from "../types/legacy-storage";

export const WORKSPACE_STATE_MESSAGE = "BURBOT_WORKSPACE_STATE_CHANGED";
export const WORKSPACE_STATE_EVENT = "burbot:workspace-state-changed";
export type WorkspaceStateMessage = {
  type: typeof WORKSPACE_STATE_MESSAGE;
  updateId: string;
  state: LegacyStorageState;
};

export function isWorkspaceStateMessage(
  value: unknown,
): value is WorkspaceStateMessage {
  const message = value as WorkspaceStateMessage | undefined;
  return (
    message?.type === WORKSPACE_STATE_MESSAGE &&
    typeof message.updateId === "string" &&
    Array.isArray(message.state?.objects) &&
    Array.isArray(message.state?.rules)
  );
}

// Deduplicate by notification identity, never by revision: draft edits keep
// their base revision until the selected changes are committed to SQLite.
const seen = new Set<string>();
function deliver(message: WorkspaceStateMessage): void {
  if (seen.has(message.updateId)) return;
  seen.add(message.updateId);
  if (seen.size > 64) seen.delete(seen.values().next().value!);
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_STATE_EVENT, {
        detail: {
          state: message.state,
          updateId: message.updateId,
          revision: message.state.revision,
        },
      }),
    );
}

let initialized = false;
export function initWorkspaceEvents(): void {
  if (initialized) return;
  initialized = true;
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isWorkspaceStateMessage(message)) deliver(message);
    return undefined;
  });
}

/** Call only after the authoritative IndexedDB/SQLite write has completed. */
export async function publishWorkspaceState(
  state: LegacyStorageState,
): Promise<void> {
  const message: WorkspaceStateMessage = {
    type: WORKSPACE_STATE_MESSAGE,
    updateId: crypto.randomUUID(),
    state,
  };
  deliver(message);
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // No open extension pages is normal. The next panel loads durable state.
  }
}
