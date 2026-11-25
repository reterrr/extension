import { uuid } from "../shared/monitoring/snapshot-viewer-store";

const contextKey = "burbotMonitoringContext";
const contextPrefix = "Burbot monitoring ";
const tabOwnerKey = "burbotMonitoringOwner";

interface MonitoringContext {
  name: string;
  id?: string;
  jobId?: string;
  tabId?: number;
}

function initialURL(owner: MonitoringContext) {
  return (
    browser.runtime.getURL("monitoring-tab.html") +
    "#" +
    owner.name.slice(contextPrefix.length)
  );
}

async function contexts(): Promise<MonitoringContext[]> {
  const stored = (await browser.storage.local.get(contextKey))[contextKey];
  return (Array.isArray(stored) ? stored : [stored]).filter(
    (item: MonitoringContext | undefined) =>
      typeof item?.name === "string" &&
      item.name.startsWith(contextPrefix) &&
      uuid.test(item.name.slice(contextPrefix.length)),
  );
}

async function remember(owner: MonitoringContext, remove = false) {
  const remaining = (await contexts()).filter(
    (item) => item.name !== owner.name,
  );
  if (!remove) remaining.push(owner);
  if (remaining.length)
    await browser.storage.local.set({ [contextKey]: remaining });
  else await browser.storage.local.remove(contextKey);
}

export function monitoringTabEvent(
  event: string,
  owner: MonitoringContext,
  reason?: string,
) {
  const context = {
    jobId: owner.jobId,
    tabId: owner.tabId,
    contextId: owner.id,
    ...(reason ? { reason } : {}),
  };
  if (reason) console.warn(event, context);
  else console.info(event, context);
}

export async function createMonitoringContext(jobId: string) {
  const owner: MonitoringContext = {
    jobId,
    name: contextPrefix + crypto.randomUUID(),
  };
  await remember(owner);
  try {
    const context = await browser.contextualIdentities.create({
      name: owner.name,
      color: "blue",
      icon: "circle",
    });
    owner.id = context.cookieStoreId;
    await remember(owner);
    return { owner, context };
  } catch (error) {
    await cleanupMonitoringContext(owner);
    throw error;
  }
}

export async function createMonitoringTab(owner: MonitoringContext) {
  const tab = await browser.tabs.create({
    active: false,
    url: initialURL(owner),
    cookieStoreId: owner.id,
  });
  if (tab.id === undefined) throw new Error("MONITORING_TAB_UNAVAILABLE");
  owner.tabId = tab.id;
  monitoringTabEvent("Monitoring tab created", owner);
  if (tab.cookieStoreId !== owner.id)
    throw new Error("MONITORING_CONTEXT_MISMATCH");
  await browser.sessions.setTabValue(tab.id, tabOwnerKey, owner.name);
  await remember(owner);
  return tab.id;
}

async function ownedTab(tab: browser.tabs.Tab, owner: MonitoringContext) {
  return (
    tab.id !== undefined &&
    (tab.url === initialURL(owner) ||
      (await browser.sessions
        .getTabValue(tab.id, tabOwnerKey)
        .catch(() => null)) === owner.name)
  );
}

export async function cleanupMonitoringContext(
  owner: MonitoringContext,
  live = false,
) {
  let context: browser.contextualIdentities.ContextualIdentity | undefined;
  let uncertain = false;
  const fail = (reason: string) => {
    uncertain = true;
    monitoringTabEvent("Monitoring cleanup failed", owner, reason);
  };

  try {
    context = (
      await browser.contextualIdentities.query({ name: owner.name })
    ).find((item) => !owner.id || item.cookieStoreId === owner.id);
  } catch {
    fail("CONTEXT_LOOKUP_FAILED");
  }

  const tabs = new Set<number>();
  if (live && owner.tabId !== undefined) tabs.add(owner.tabId);
  try {
    const candidates = context
      ? await browser.tabs.query({ cookieStoreId: context.cookieStoreId })
      : await browser.tabs.query({});
    for (const tab of candidates)
      if (tab && (await ownedTab(tab, owner))) tabs.add(tab.id!);
  } catch {
    fail("TAB_LOOKUP_FAILED");
  }

  for (const tabId of tabs) {
    try {
      await browser.tabs.remove(tabId);
      monitoringTabEvent("Monitoring tab removed", { ...owner, tabId });
    } catch {
      // Closing the tab in Firefox may race with the explicit removal.
      if (await browser.tabs.get(tabId).catch(() => null))
        fail("TAB_REMOVE_FAILED");
    }
  }

  if (context) {
    try {
      const remaining = await browser.tabs.query({
        cookieStoreId: context.cookieStoreId,
      });
      for (const tab of remaining) {
        if (!(await ownedTab(tab, owner))) {
          fail("UNOWNED_TABS_PRESENT");
          return;
        }
      }
      await browser.contextualIdentities.remove(context.cookieStoreId);
      monitoringTabEvent("Monitoring context removed", {
        ...owner,
        id: context.cookieStoreId,
      });
    } catch {
      fail("CONTEXT_REMOVE_FAILED");
    }
  }
  // A partial cleanup leaves the ownership record for the next recovery attempt.
  if (!uncertain)
    await remember(owner, true).catch(() =>
      fail("CONTEXT_RECORD_REMOVE_FAILED"),
    );
}

export async function recoverContext() {
  for (const owner of await contexts()) await cleanupMonitoringContext(owner);
}
