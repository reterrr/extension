import {
  captureMessage,
  monitoredURL,
  type Capture,
  type CaptureMessage,
  type Job,
  type Settings,
} from "../shared/monitoring/contracts";
import {
  cleanupMonitoringContext,
  createMonitoringContext,
  createMonitoringTab,
  monitoringTabEvent,
} from "./monitoring-tabs";

const navigationTimeout = 40_000;
const maxMainFrameRequests = 10;
const redirects = new Set([301, 302, 303, 307, 308]);

export class AcquisitionError extends Error {
  constructor(
    readonly code:
      | "NAVIGATION_FAILED"
      | "PAGE_TIMEOUT"
      | "HTTP_ERROR"
      | "UNSUPPORTED_CONTENT_TYPE"
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

export function approvalGuard(
  origins: ReadonlySet<string> | null,
  {
    allowHttp = false,
    excludedOrigins = [],
  }: { allowHttp?: boolean; excludedOrigins?: readonly string[] } = {},
) {
  // Share only concurrent lookups. Every later request is checked by Firefox DNS.
  const lookups = new Map<string, Promise<boolean>>();
  return async (address: string) => {
    try {
      const url = monitoredURL(address, { allowHttp });
      if (
        excludedOrigins.includes(url.origin) ||
        (origins && !origins.has(url.origin))
      )
        return false;
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

async function loaded(
  tabId: number,
  url: string,
  allowHttp: boolean,
  signal: AbortSignal,
) {
  // Observe before navigation. The initial extension-owned placeholder is ignored.
  let listener: Parameters<typeof browser.tabs.onUpdated.addListener>[0];
  let removed: Parameters<typeof browser.tabs.onRemoved.addListener>[0];
  const complete = new Promise<string>((resolve, reject) => {
    listener = (id, change, tab) => {
      if (id !== tabId) return;
      if (
        change.url &&
        change.url !== "about:blank" &&
        !change.url.startsWith("https:") &&
        !(allowHttp && change.url.startsWith("http:"))
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
    const navigation = browser.tabs.update(tabId, { url }).catch(() => {
      throw new AcquisitionError("NAVIGATION_FAILED");
    });
    const [, page] = await abortable(
      Promise.all([navigation, complete]),
      signal,
    );
    return page;
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
  const trusted = settings.mode === "trusted";
  if (
    trusted
      ? job.navigation?.mode !== "trusted" ||
        typeof job.navigation.allowHttp !== "boolean"
      : job.navigation !== undefined
  )
    throw new AcquisitionError("NAVIGATION_FAILED");
  const allowHttp = job.navigation?.allowHttp === true;
  if (trusted) {
    const entry = monitoredURL(job.url, { allowHttp });
    if (
      job.allowedOrigins.length !== 1 ||
      job.allowedOrigins[0] !== entry.origin ||
      allowHttp !== (entry.protocol === "http:")
    )
      throw new AcquisitionError("NAVIGATION_FAILED");
  }
  const rejection = new AbortController();
  const deadline = AbortSignal.any([
    signal,
    rejection.signal,
    AbortSignal.timeout(navigationTimeout),
  ]);
  const origins = trusted
    ? null
    : new Set(
        job.allowedOrigins.filter((item) =>
          settings.allowedOrigins.includes(item),
        ),
      );
  // The backend and upload destinations are never monitored as pages.
  const allowed = approvalGuard(origins, {
    allowHttp,
    excludedOrigins: [settings.apiOrigin, settings.storageOrigin],
  });
  if (!(await abortable(allowed(job.url), deadline).catch(() => false))) {
    if (signal.aborted) throw new AcquisitionError("CANCELLED");
    if (deadline.aborted) throw new AcquisitionError("PAGE_TIMEOUT");
    throw new AcquisitionError("NAVIGATION_FAILED");
  }

  const { owner, context } = await createMonitoringContext(job.jobId);
  let tabId: number | undefined;
  let requestCount = 0;
  let responseOrigin: string | undefined;
  const guard = async (request: browser.webRequest._OnBeforeRequestDetails) => {
    if (
      request.tabId !== tabId &&
      request.cookieStoreId !== context.cookieStoreId
    )
      return {};
    const mainFrame = request.type === "main_frame";
    if (trusted && mainFrame && request.tabId !== tabId)
      return { cancel: true };
    const accepted =
      !deadline.aborted &&
      (!trusted || !mainFrame || ++requestCount <= maxMainFrameRequests) &&
      (request.method === "GET" || request.method === "HEAD") &&
      (await abortable(allowed(request.url), deadline).catch(() => false));
    if (!accepted && mainFrame)
      rejection.abort(new AcquisitionError("NAVIGATION_FAILED"));
    return { cancel: !accepted };
  };
  const checkResponse: Parameters<
    typeof browser.webRequest.onHeadersReceived.addListener
  >[0] = (request) => {
    if (request.tabId !== tabId || redirects.has(request.statusCode)) return {};
    const header = (name: string) =>
      request.responseHeaders?.find((item) => item.name.toLowerCase() === name)
        ?.value;
    const mediaType = header("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (
      request.statusCode < 200 ||
      request.statusCode >= 300 ||
      request.statusCode === 204 ||
      request.statusCode === 205
    ) {
      rejection.abort(new AcquisitionError("HTTP_ERROR"));
      return { cancel: true };
    }
    if (
      (mediaType && mediaType !== "text/html") ||
      /^\s*attachment\b/i.test(header("content-disposition") ?? "")
    ) {
      rejection.abort(new AcquisitionError("UNSUPPORTED_CONTENT_TYPE"));
      return { cancel: true };
    }
    responseOrigin = new URL(request.url).origin;
    return {};
  };
  try {
    tabId = await createMonitoringTab(owner);
    browser.webRequest.onBeforeRequest.addListener(
      guard,
      { urls: ["<all_urls>"] },
      ["blocking"],
    );
    if (trusted)
      browser.webRequest.onHeadersReceived.addListener(
        checkResponse,
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
        ["blocking", "responseHeaders"],
      );
    monitoringTabEvent("Monitoring navigation started", owner);
    const page = await loaded(tabId, job.url, allowHttp, deadline);
    const pageOrigin = monitoredURL(page, { allowHttp }).origin;
    if (
      (trusted && responseOrigin !== pageOrigin) ||
      !(await abortable(allowed(page), deadline))
    )
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
      expectedOrigins: origins ? [...origins] : [pageOrigin],
      allowHttp,
    };
    const result = (await abortable(
      browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
      deadline,
    )) as Capture | null;
    const finalTab = await abortable(browser.tabs.get(tabId), deadline);
    if (
      !result ||
      result.pageUrl !== finalTab.url ||
      !(await abortable(allowed(result.pageUrl), deadline))
    )
      throw new AcquisitionError("CAPTURE_FAILED");
    monitoringTabEvent("Monitoring capture completed", owner);
    return result;
  } catch (error) {
    if (signal.aborted) throw new AcquisitionError("CANCELLED");
    if (deadline.reason instanceof AcquisitionError) throw deadline.reason;
    if (deadline.aborted) throw new AcquisitionError("PAGE_TIMEOUT");
    if (error instanceof AcquisitionError) throw error;
    throw new AcquisitionError("CAPTURE_FAILED");
  } finally {
    try {
      await cleanupMonitoringContext(owner, true);
    } finally {
      browser.webRequest.onBeforeRequest.removeListener(guard);
      if (trusted)
        browser.webRequest.onHeadersReceived.removeListener(checkResponse);
    }
  }
}
