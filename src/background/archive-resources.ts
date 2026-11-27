import {
  archiveMediaTypes,
  type ArchiveResource,
} from "../shared/monitoring/archive-document";

export const resourceTypes: browser.webRequest.ResourceType[] = [
  "stylesheet",
  "image",
  "font",
];
// Keep the total below the 16 MiB visual HTML limit after base64 expansion.
// Never buffer scripts, API responses, or resources from unrelated tabs.
const maxResourceBytes = 8 * 1024 * 1024;
const maxBytes = 10 * 1024 * 1024;
const maxRequests = 750;
const drainMs = 1_500;

interface ResourceStream {
  url: string;
  responseUrl?: string;
  mediaType?: string;
  bytes: number;
  chunks: ArrayBuffer[];
  filter: browser.webRequest.StreamFilter;
}

export function archiveResponseType(
  request: browser.webRequest._OnHeadersReceivedDetails,
  full = false,
) {
  let mime = request.responseHeaders
    ?.find(({ name }) => name.toLowerCase() === "content-type")
    ?.value?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (full && mime)
    mime =
      (
        {
          "application/x-font-ttf": "font/ttf",
          "application/x-font-opentype": "font/otf",
          "application/font-woff2": "font/woff2",
        } as Record<string, string>
      )[mime] ?? mime;
  if (
    !mime ||
    (!archiveMediaTypes.has(mime) && !(full && mime === "image/svg+xml"))
  )
    return undefined;
  const matches =
    request.type === "stylesheet"
      ? mime === "text/css"
      : request.type === "image" || request.type === "imageset"
        ? mime.startsWith("image/")
        : mime !== "text/css" && !mime.startsWith("image/");
  return matches ? mime : undefined;
}

export function recordArchiveResources(tabId: number) {
  const resources = new Map<string, ArchiveResource>();
  const streams = new Map<string, ResourceStream>();
  let heldBytes = 0;
  let requests = 0;
  let onIdle: (() => void) | undefined;

  function release(id: string, entry: ResourceStream) {
    if (streams.get(id) !== entry) return;
    streams.delete(id);
    heldBytes -= entry.bytes;
    if (!streams.size) onIdle?.();
  }

  function disconnect(id: string, entry: ResourceStream) {
    release(id, entry);
    try {
      entry.filter.disconnect();
    } catch {
      // Firefox can end a request before cleanup runs.
    }
  }

  const headers: Parameters<
    typeof browser.webRequest.onHeadersReceived.addListener
  >[0] = (request) => {
    const entry = streams.get(request.requestId);
    if (!entry || request.tabId !== tabId || request.statusCode !== 200)
      return {};
    const mime = archiveResponseType(request);
    if (mime) {
      entry.mediaType = mime;
      entry.responseUrl = request.url;
    } else disconnect(request.requestId, entry);
    return {};
  };
  browser.webRequest.onHeadersReceived.addListener(
    headers,
    { urls: ["http://*/*", "https://*/*"], types: resourceTypes, tabId },
    // Firefox can deliver the entire body before a nonblocking headers event.
    ["blocking", "responseHeaders"],
  );

  function observe(request: browser.webRequest._OnBeforeRequestDetails) {
    const { requestId, url } = request;
    if (
      request.tabId !== tabId ||
      request.frameId !== 0 ||
      request.method !== "GET" ||
      !resourceTypes.includes(request.type) ||
      streams.has(requestId) ||
      resources.has(url) ||
      heldBytes >= maxBytes ||
      requests >= maxRequests
    )
      return;
    requests++;
    let filter: browser.webRequest.StreamFilter;
    try {
      filter = browser.webRequest.filterResponseData(requestId);
    } catch {
      return;
    }
    const entry: ResourceStream = { url, bytes: 0, chunks: [], filter };
    streams.set(requestId, entry);
    filter.ondata = ({ data }) => {
      // Preserve the live response, including when the archive budget is exhausted.
      filter.write(data);
      if (
        entry.bytes + data.byteLength > maxResourceBytes ||
        heldBytes + data.byteLength > maxBytes
      ) {
        disconnect(requestId, entry);
        return;
      }
      heldBytes += data.byteLength;
      entry.bytes += data.byteLength;
      entry.chunks.push(data);
    };
    filter.onerror = () => release(requestId, entry);
    filter.onstop = () => {
      if (streams.get(requestId) !== entry) return;
      try {
        if (!entry.mediaType || !entry.bytes || resources.has(entry.url)) {
          release(requestId, entry);
          return;
        }
        const bytes = new Uint8Array(entry.bytes);
        let offset = 0;
        for (const chunk of entry.chunks) {
          bytes.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
        const resource = {
          mediaType: entry.mediaType,
          bytes,
          responseUrl: entry.responseUrl,
        };
        resources.set(entry.url, resource);
        if (entry.responseUrl && !resources.has(entry.responseUrl))
          resources.set(entry.responseUrl, resource);
        // Keep completed bytes charged to the budget until the capture ends.
        streams.delete(requestId);
        if (!streams.size) onIdle?.();
      } finally {
        filter.close();
      }
    };
  }

  return {
    resources,
    observe,
    async drain(signal: AbortSignal) {
      if (!streams.size || signal.aborted) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          onIdle = undefined;
          resolve();
        };
        const timer = setTimeout(done, drainMs);
        onIdle = done;
        signal.addEventListener("abort", done, { once: true });
      });
    },
    close() {
      browser.webRequest.onHeadersReceived.removeListener(headers);
      for (const [id, entry] of streams) disconnect(id, entry);
    },
  };
}
