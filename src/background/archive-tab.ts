import {
  archiveLaunchPage,
  archiveTabKey,
  isolatedArchiveURL,
  type SnapshotTabContext,
} from "../shared/monitoring/snapshot-delivery";

export function archiveLaunchURL(commandId: string) {
  return browser.runtime.getURL(archiveLaunchPage) + "#" + commandId;
}

export async function closeArchiveLauncher(
  tabId: number,
  commandId: string,
  live = false,
) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (
    (live && tab?.url === "about:blank") ||
    tab?.url === archiveLaunchURL(commandId)
  )
    await browser.tabs.remove(tabId).catch(() => undefined);
}

export async function loadArchiveTab(
  tabId: number,
  html: string,
  context: SnapshotTabContext,
  signal: AbortSignal,
) {
  const launcher = archiveLaunchURL(context.commandId);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  deadline.throwIfAborted();
  let destination: string | undefined;
  let navigating = false;
  const onMessage: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender) => {
    if (
      sender.tab?.id !== tabId ||
      sender.frameId !== 0 ||
      sender.url !== launcher ||
      message?.id !== context.commandId
    )
      return undefined;
    if (message.type === "archive-markup") return Promise.resolve(html);
    if (
      message.type === "archive-published" &&
      !destination &&
      typeof message.url === "string" &&
      isolatedArchiveURL.test(message.url)
    ) {
      destination = message.url;
      return Promise.resolve(true);
    }
    return undefined;
  };
  let done: () => void;
  let fail: (reason: unknown) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });
  const onUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (
    id,
    change,
    tab,
  ) => {
    if (id !== tabId || !destination || (tab.url && tab.url !== destination))
      return;
    // Firefox may hide the opaque URL from tabs.onUpdated. Observe a new load
    // after the trusted launcher has acknowledged the destination in that case.
    if (change.url === destination || change.status === "loading")
      navigating = true;
    if (navigating && change.status === "complete") done();
  };
  const onRemoved = (id: number) => {
    if (id === tabId) fail(new Error("Archive tab closed"));
  };
  const abort = () => fail(deadline.reason);
  browser.runtime.onMessage.addListener(onMessage);
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(onRemoved);
  deadline.addEventListener("abort", abort, { once: true });
  try {
    await Promise.all([
      browser.tabs.update(tabId, { url: launcher, loadReplace: true }),
      loaded,
    ]);
    await browser.sessions.setTabValue(tabId, archiveTabKey, context);
    await browser.tabs.update(tabId, { active: true, autoDiscardable: false });
  } finally {
    deadline.removeEventListener("abort", abort);
    browser.tabs.onRemoved.removeListener(onRemoved);
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.runtime.onMessage.removeListener(onMessage);
  }
}
