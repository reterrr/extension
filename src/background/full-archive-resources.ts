import { sha256 } from "@noble/hashes/sha2.js";
import {
  discardArchiveStage,
  writeArchiveChunk,
} from "../shared/monitoring/archive-stage";
import {
  archiveEntries,
  archiveURL,
  maxArchiveCssBytes,
  type ArchiveIssue,
  type ArchiveLimits,
  type ArchiveResource,
} from "../shared/monitoring/full-archive";
import { archiveResponseType, resourceTypes } from "./archive-resources";

const maxBufferedBytes = 8 * 1024 * 1024;
const drainMs = 1_500;
const fullResourceTypes: browser.webRequest.ResourceType[] = [
  ...resourceTypes,
  "imageset",
];

interface Recording {
  id: string;
  originalUrl: string;
  responseUrl?: string;
  mediaType?: string;
  size: number;
  expectedSize?: number;
  index: number;
  hash: ReturnType<typeof sha256.create>;
  filter: browser.webRequest.StreamFilter;
  writes: Set<Promise<void>>;
  writeFailed: boolean;
}

export function recordFullArchiveResources(
  tabId: number,
  scope: string,
  limits: ArchiveLimits,
  allowHttp: boolean,
) {
  const resources = new Map<string, ArchiveResource>();
  const staged = new Map<string, string>();
  const issues = new Set<ArchiveIssue>();
  const streams = new Map<string, Recording>();
  const redirected = new Map<string, string>();
  const finishing = new Set<Promise<void>>();
  let heldBytes = 0;
  let queuedBytes = 0;
  let requests = 0;
  let accepting = true;
  let idle: (() => void) | undefined;

  const resourceLimit = (mime: string) =>
    mime === "text/css" || mime === "image/svg+xml"
      ? Math.min(limits.maxResourceBytes, maxArchiveCssBytes)
      : limits.maxResourceBytes;

  function notify() {
    if (!streams.size) idle?.();
  }

  function track(work: Promise<void>) {
    finishing.add(work);
    void work.finally(() => finishing.delete(work));
  }

  function remove(requestId: string, entry: Recording) {
    if (streams.get(requestId) !== entry) return false;
    streams.delete(requestId);
    notify();
    return true;
  }

  function absent(
    requestId: string,
    entry: Recording,
    reason: ArchiveIssue,
    status: "missing" | "truncated" = "missing",
  ) {
    if (!remove(requestId, entry)) return;
    heldBytes -= entry.size;
    if (resources.get(entry.originalUrl)?.status !== "captured")
      resources.set(entry.originalUrl, {
        originalUrl: entry.originalUrl,
        responseUrl: entry.responseUrl,
        mediaType: entry.mediaType,
        status,
        reason,
        sizeBytes: entry.expectedSize,
      });
    try {
      entry.filter.disconnect();
    } catch {
      /* Firefox already finished it. */
    }
    track(
      Promise.all(entry.writes)
        .then(() => discardArchiveStage(scope, entry.id).catch(() => undefined))
        .then(() => undefined),
    );
  }

  const headers: Parameters<
    typeof browser.webRequest.onHeadersReceived.addListener
  >[0] = (request) => {
    const entry = streams.get(request.requestId);
    if (!entry || request.tabId !== tabId) return {};
    if (request.statusCode >= 300 && request.statusCode < 400) return {};
    const responseUrl = archiveURL(request.url, request.url, allowHttp);
    if (responseUrl && responseUrl !== entry.originalUrl)
      entry.responseUrl = responseUrl;
    if (request.statusCode !== 200) {
      absent(request.requestId, entry, "response_unavailable");
      return {};
    }
    entry.mediaType = archiveResponseType(request, true);
    if (!entry.mediaType) {
      absent(request.requestId, entry, "unsupported_media");
      return {};
    }
    const size = Number(
      request.responseHeaders?.find(
        ({ name }) => name.toLowerCase() === "content-length",
      )?.value,
    );
    if (
      Number.isSafeInteger(size) &&
      size > 0 &&
      !request.responseHeaders?.some(
        ({ name }) => name.toLowerCase() === "content-encoding",
      )
    ) {
      entry.expectedSize = size;
      if (size > resourceLimit(entry.mediaType))
        absent(request.requestId, entry, "resource_limit", "truncated");
    }
    return {};
  };
  const redirect: Parameters<
    typeof browser.webRequest.onBeforeRedirect.addListener
  >[0] = ({ requestId }) => {
    const entry = streams.get(requestId);
    if (entry) redirected.set(requestId, entry.originalUrl);
  };
  const filter = {
    urls: ["http://*/*", "https://*/*"],
    types: fullResourceTypes,
    tabId,
  };
  browser.webRequest.onHeadersReceived.addListener(headers, filter, [
    "blocking",
    "responseHeaders",
  ]);
  browser.webRequest.onBeforeRedirect.addListener(redirect, filter);

  function observe(request: browser.webRequest._OnBeforeRequestDetails) {
    const { requestId, url } = request;
    if (
      !accepting ||
      request.tabId !== tabId ||
      request.frameId !== 0 ||
      request.method !== "GET" ||
      !fullResourceTypes.includes(request.type) ||
      streams.has(requestId)
    )
      return;
    const originalUrl =
      redirected.get(requestId) ?? archiveURL(url, url, allowHttp);
    if (!originalUrl || resources.get(originalUrl)?.status === "captured")
      return;
    if (requests >= archiveEntries) {
      issues.add("request_limit");
      return;
    }
    requests++;
    let stream: browser.webRequest.StreamFilter;
    try {
      stream = browser.webRequest.filterResponseData(requestId);
    } catch {
      resources.set(originalUrl, {
        originalUrl,
        status: "missing",
        reason: "recording_unavailable",
      });
      return;
    }
    const entry: Recording = {
      id: crypto.randomUUID(),
      originalUrl,
      size: 0,
      index: 0,
      hash: sha256.create(),
      filter: stream,
      writes: new Set(),
      writeFailed: false,
    };
    streams.set(requestId, entry);
    stream.ondata = ({ data }) => {
      // Forward every byte immediately even if archival storage is full or busy.
      stream.write(data);
      if (
        streams.get(requestId) !== entry ||
        !entry.mediaType ||
        data.byteLength === 0
      )
        return;
      let reason: ArchiveIssue | undefined;
      if (entry.size + data.byteLength > resourceLimit(entry.mediaType))
        reason = "resource_limit";
      else if (heldBytes + data.byteLength > limits.maxBytes)
        reason = "archive_limit";
      else if (
        queuedBytes + data.byteLength > maxBufferedBytes ||
        entry.writeFailed
      )
        reason = "buffer_limit";
      if (reason) {
        absent(requestId, entry, reason, "truncated");
        return;
      }
      entry.size += data.byteLength;
      heldBytes += data.byteLength;
      queuedBytes += data.byteLength;
      entry.hash.update(new Uint8Array(data));
      const write = writeArchiveChunk(
        scope,
        entry.id,
        entry.index++,
        new Blob([data]),
      )
        .catch(() => {
          entry.writeFailed = true;
        })
        .finally(() => {
          queuedBytes -= data.byteLength;
          entry.writes.delete(write);
        });
      entry.writes.add(write);
    };
    stream.onerror = () => absent(requestId, entry, "response_unavailable");
    stream.onstop = () => {
      if (!remove(requestId, entry)) return;
      try {
        stream.close();
      } catch {
        /* A finished response needs no further forwarding. */
      }
      track(
        Promise.all(entry.writes).then(async () => {
          if (!entry.size || !entry.mediaType || entry.writeFailed) {
            if (!resources.has(originalUrl))
              resources.set(originalUrl, {
                originalUrl,
                status: "missing",
                reason: "response_unavailable",
              });
            heldBytes -= entry.size;
            await discardArchiveStage(scope, entry.id).catch(() => undefined);
            return;
          }
          const digest = Array.from(entry.hash.digest(), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          if (staged.has(digest)) {
            heldBytes -= entry.size;
            await discardArchiveStage(scope, entry.id).catch(() => undefined);
          } else staged.set(digest, entry.id);
          resources.set(originalUrl, {
            originalUrl,
            responseUrl: entry.responseUrl,
            status: "captured",
            mediaType: entry.mediaType,
            sha256: digest,
            sizeBytes: entry.size,
          });
        }),
      );
    };
  }

  function close() {
    accepting = false;
    browser.webRequest.onHeadersReceived.removeListener(headers);
    browser.webRequest.onBeforeRedirect.removeListener(redirect);
    for (const [id, entry] of streams)
      absent(id, entry, "capture_timeout", "truncated");
  }

  return {
    observe,
    resources,
    staged,
    issues,
    close,
    async finish(signal: AbortSignal) {
      accepting = false;
      if (streams.size && !signal.aborted)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            idle = undefined;
            resolve();
          };
          const timer = setTimeout(done, drainMs);
          idle = done;
          signal.addEventListener("abort", done, { once: true });
        });
      close();
      await Promise.all(finishing);
    },
  };
}
