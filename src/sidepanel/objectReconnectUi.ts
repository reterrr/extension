import "./selectorHighlightStyles";
import { initSelectorHighlightsUi } from "./selectorHighlightsUi";

let initialized = false;
let reconnectTimer: number | undefined;

function isConnected(): boolean {
  return document.getElementById("connection")?.textContent?.includes("· connected") ?? false;
}

function reconnectWorkspace(): void {
  if (isConnected()) return;
  const connect = document.getElementById("connect");
  if (!(connect instanceof HTMLButtonElement) || connect.disabled) return;
  connect.click();
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    reconnectWorkspace();
  }, 0);
}

export async function initObjectReconnectUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  void initSelectorHighlightsUi().catch(() => undefined);

  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;

  // Objects focused from the commit panel are broadcast by the background.
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "BURBOT_FOCUS" &&
      (message as { windowId?: unknown }).windowId === windowId &&
      !(message as { error?: unknown }).error
    ) {
      scheduleReconnect();
    }
    return undefined;
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // `Change object` is handled entirely inside workspace.js and therefore
      // does not emit BURBOT_FOCUS.
      const objectOption = target.closest("#object-options button");
      if (objectOption instanceof HTMLButtonElement && !objectOption.disabled) {
        scheduleReconnect();
        return;
      }

      // If an existing object was restored/focused while the workspace was
      // disconnected, selecting any field should make capture usable instead
      // of leaving all capture controls disabled.
      const field = target.closest(".field-row");
      if (field instanceof HTMLButtonElement && !field.disabled && !isConnected()) {
        scheduleReconnect();
      }
    },
    true,
  );
}
