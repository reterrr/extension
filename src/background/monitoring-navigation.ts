import {
  captureMessage,
  monitoredURL,
  type Capture,
  type CaptureMessage,
  type Job,
  type Settings,
} from "../shared/monitoring/contracts";

const contextKey = "burbotMonitoringContext";
const contextPrefix = "Burbot monitoring ";
const navigationTimeout = 40_000;

export class AcquisitionError extends Error {
  constructor(
    readonly code:
      | "NAVIGATION_FAILED"
      | "PAGE_TIMEOUT"
      | "CAPTURE_FAILED"
      | "UPLOAD_FAILED"
      | "CANCELLED",
  ) {
    super(code);
  }
}

export function publicAddress(address: string): boolean {
  if (address.includes(":")) {
    if (!/^[a-f0-9:]+$/i.test(address) || !/^[23][a-f0-9]{3}:/i.test(address))
      return false;
    const [first, second] = address
      .split(":")
      .map((part) => parseInt(part || "0", 16));
    return !(
      (first === 0x2001 && (second < 0x0200 || second === 0x0db8)) ||
      first === 0x2002 ||
      first === 0x3fff
    );
  }
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const [a, b, c] = address.split(".").map(Number);
  return (
    address.split(".").every((part) => Number(part) <= 255) &&
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}

export function approvalGuard(origins: ReadonlySet<string>) {
  // Share only concurrent lookups. Every later request is checked by Firefox DNS.
  const lookups = new Map<string, Promise<boolean>>();
  return async (address: string) => {
    try {
      const url = monitoredURL(address);
      if (!origins.has(url.origin)) return false;
      let check = lookups.get(url.hostname);
      if (!check) {
        check = browser.dns
          .resolve(url.hostname)
          .then(
            ({ addresses }) =>
              addresses.length > 0 && addresses.every(publicAddress),
            () => false,
          )
          .finally(() => lookups.delete(url.hostname));
        lookups.set(url.hostname, check);
      }
      return await check;
    } catch {
      return false;
    }
  };
}

export async function recoverContext() {
  const saved = (await browser.storage.local.get(contextKey))[contextKey] as
    { id: string; name: string } | undefined;
  if (!saved) return;
  const identity = await browser.contextualIdentities
    .get(saved.id)
    .catch(() => null);
  if (identity?.name === saved.name && saved.name.startsWith(contextPrefix))
    await browser.contextualIdentities.remove(saved.id);
  await browser.storage.local.remove(contextKey);
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    operation
      .then(resolve, reject)
      .then(() => signal.removeEventListener("abort", cancel));
  });
}

async function loaded(tabId: number, url: string, signal: AbortSignal) {
  // Observe before navigation. Initial about:blank completion is ignored.
  let listener: Parameters<typeof browser.tabs.onUpdated.addListener>[0];
  let removed: Parameters<typeof browser.tabs.onRemoved.addListener>[0];
  const complete = new Promise<string>((resolve, reject) => {
    listener = (id, change, tab) => {
      if (id !== tabId) return;
      if (
        change.url &&
        change.url !== "about:blank" &&
        !change.url.startsWith("https:")
      )
        reject(new AcquisitionError("NAVIGATION_FAILED"));
      if (change.status === "complete" && tab.url && tab.url !== "about:blank")
        resolve(tab.url);
    };
    removed = (id) => {
      if (id === tabId) reject(new AcquisitionError("NAVIGATION_FAILED"));
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.onRemoved.addListener(removed);
  });
  try {
    void browser.tabs.update(tabId, { url }).catch(() => {
      // The request guard or Firefox will normally deliver an error-page update.
    });
    return await abortable(complete, signal);
  } finally {
    browser.tabs.onUpdated.removeListener(listener!);
    browser.tabs.onRemoved.removeListener(removed!);
  }
}

export async function acquire(
  job: Job,
  settings: Settings,
  signal: AbortSignal,
): Promise<Capture> {
  const deadline = AbortSignal.any([
    signal,
    AbortSignal.timeout(navigationTimeout),
  ]);
  const origins = new Set(
    job.allowedOrigins.filter((item) => settings.allowedOrigins.includes(item)),
  );
  // The backend and upload destinations are never monitored as pages.
  origins.delete(settings.apiOrigin);
  origins.delete(settings.storageOrigin);
  const allowed = approvalGuard(origins);
  if (!(await abortable(allowed(job.url), deadline)))
    throw new AcquisitionError("NAVIGATION_FAILED");

  const name = contextPrefix + crypto.randomUUID();
  const context = await browser.contextualIdentities.create({
    name,
    color: "blue",
    icon: "circle",
  });
  let tabId: number | undefined;
  let blockedNavigation = false;
  const guard = async (request: browser.webRequest._OnBeforeRequestDetails) => {
    if (
      request.tabId !== tabId &&
      request.cookieStoreId !== context.cookieStoreId
    )
      return {};
    const accepted =
      !deadline.aborted &&
      (request.method === "GET" || request.method === "HEAD") &&
      (await abortable(allowed(request.url), deadline).catch(() => false));
    if (!accepted && request.type === "main_frame") blockedNavigation = true;
    return { cancel: !accepted };
  };
  try {
    await browser.storage.local.set({
      [contextKey]: { id: context.cookieStoreId, name },
    });
    browser.webRequest.onBeforeRequest.addListener(
      guard,
      { urls: ["<all_urls>"] },
      ["blocking"],
    );
    const tab = await browser.tabs.create({
      active: false,
      url: "about:blank",
      cookieStoreId: context.cookieStoreId,
    });
    if (tab.id === undefined || tab.cookieStoreId !== context.cookieStoreId)
      throw new AcquisitionError("NAVIGATION_FAILED");
    tabId = tab.id;
    const page = await loaded(tabId, job.url, deadline);
    if (blockedNavigation || !(await abortable(allowed(page), deadline)))
      throw new AcquisitionError("NAVIGATION_FAILED");
    await abortable(
      browser.scripting.executeScript({
        target: { tabId },
        files: ["monitoring-capture.js"],
      }),
      deadline,
    );
    const message: CaptureMessage = {
      type: captureMessage,
      selectors: job.selectors,
      expectedOrigins: [...origins],
    };
    const result = (await abortable(
      browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
      deadline,
    )) as Capture | null;
    const finalTab = await abortable(browser.tabs.get(tabId), deadline);
    if (
      !result ||
      result.pageUrl !== finalTab.url ||
      blockedNavigation ||
      !(await abortable(allowed(result.pageUrl), deadline))
    )
      throw new AcquisitionError("CAPTURE_FAILED");
    return result;
  } catch (error) {
    if (signal.aborted) throw new AcquisitionError("CANCELLED");
    if (blockedNavigation) throw new AcquisitionError("NAVIGATION_FAILED");
    if (deadline.aborted) throw new AcquisitionError("PAGE_TIMEOUT");
    if (error instanceof AcquisitionError) throw error;
    throw new AcquisitionError("CAPTURE_FAILED");
  } finally {
    try {
      await browser.contextualIdentities.remove(context.cookieStoreId);
      await browser.storage.local.remove(contextKey);
    } finally {
      browser.webRequest.onBeforeRequest.removeListener(guard);
    }
  }
}
