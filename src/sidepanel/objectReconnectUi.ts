let initialized = false;

function reconnectWorkspace(): void {
  const connect = document.getElementById("connect");
  if (!(connect instanceof HTMLButtonElement) || connect.disabled) return;
  connect.click();
}

export async function initObjectReconnectUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;

  // Objects focused from the commit panel are broadcast by the background.
  // Reconnect after the focus message so the existing object can immediately
  // capture values from the currently active tab.
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "BURBOT_FOCUS" &&
      (message as { windowId?: unknown }).windowId === windowId &&
      !(message as { error?: unknown }).error
    ) {
      window.setTimeout(reconnectWorkspace, 0);
    }
    return undefined;
  });

  // `Change object` is handled entirely inside workspace.js and therefore does
  // not emit BURBOT_FOCUS. Reconnect explicitly after choosing an object there.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const option = target.closest("#object-options button");
      if (!(option instanceof HTMLButtonElement) || option.disabled) return;
      window.setTimeout(reconnectWorkspace, 0);
    },
    true,
  );
}
