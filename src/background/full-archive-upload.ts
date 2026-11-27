import {
  archiveCssReferences,
  archiveDocument,
} from "../shared/monitoring/archive-document";
import {
  stagedArchiveBlob,
  writeArchiveChunk,
} from "../shared/monitoring/archive-stage";
import {
  maxVisualArchiveBytes,
  sha256,
  type Capture,
  type Settings,
  type VisualMarkup,
} from "../shared/monitoring/contracts";
import {
  archiveEntries,
  archiveObjectMime,
  archiveURL,
  fullArchiveVersion,
  type ArchiveIssue,
  type ArchiveLimits,
  type ArchiveObject,
  type ArchiveResource,
  type FullArchivePlan,
} from "../shared/monitoring/full-archive";
import type { recordFullArchiveResources } from "./full-archive-resources";
import { agentFetch } from "./monitoring-request";

export async function prepareFullArchive(
  scope: string,
  capture: Capture,
  visual: VisualMarkup,
  recorder: ReturnType<typeof recordFullArchiveResources> | undefined,
  limits: ArchiveLimits,
  allowHttp: boolean,
  signal: AbortSignal,
): Promise<FullArchivePlan> {
  await recorder?.finish(signal);
  const resources = recorder?.resources ?? new Map<string, ArchiveResource>();
  const staged = recorder?.staged ?? new Map<string, string>();
  const issues =
    recorder?.issues ?? new Set<ArchiveIssue>(["recording_unavailable"]);
  const aliases = new Set(
    Array.from(resources.values())
      .filter((resource) => resource.status === "captured")
      .map(({ responseUrl }) => responseUrl),
  );
  const baseUrl =
    archiveURL(visual.baseUrl, capture.pageUrl, allowHttp) ?? capture.pageUrl;
  const recordedCss = Array.from(resources.values()).filter(
    (resource) =>
      resource.status === "captured" && resource.mediaType === "text/css",
  );

  function reference(value: string, base: string) {
    if (!value || value.startsWith("#")) return undefined;
    const url = archiveURL(value, base, allowHttp);
    if (url && !resources.has(url) && !aliases.has(url)) {
      if (resources.size < archiveEntries)
        resources.set(url, {
          originalUrl: url,
          status: "missing",
          reason: "response_unavailable",
        });
      else issues.add("request_limit");
    }
    return url;
  }

  const html = archiveDocument(visual.html, baseUrl, undefined, {
    mode: "capture",
    reference,
  });
  for (const resource of recordedCss) {
    signal.throwIfAborted();
    if (resource.status !== "captured") continue;
    try {
      const blob = await stagedArchiveBlob(scope, staged.get(resource.sha256)!);
      if (blob.size !== resource.sizeBytes)
        throw new Error("Stylesheet unavailable.");
      archiveCssReferences(await blob.text(), (value) =>
        reference(value, resource.responseUrl ?? resource.originalUrl),
      );
    } catch {
      const { sha256: _sha256, ...rest } = resource;
      resources.set(resource.originalUrl, {
        ...rest,
        status: "missing",
        reason: "response_unavailable",
      });
    }
  }
  const bytes = new TextEncoder().encode(html);
  if (bytes.length > Math.min(limits.maxBytes, maxVisualArchiveBytes))
    return { scope, failure: "capture_unavailable" };
  const document: ArchiveObject = {
    sha256: await sha256(bytes),
    sizeBytes: bytes.length,
  };
  await writeArchiveChunk(scope, "document", 0, new Blob([bytes]));
  staged.set(document.sha256, "document");

  // Give the document its budget first and account for each payload once.
  const included = new Set([document.sha256]);
  let remaining = limits.maxBytes - document.sizeBytes;
  const items = Array.from(resources.values()).map(
    (resource): ArchiveResource => {
      if (resource.status !== "captured" || included.has(resource.sha256))
        return resource;
      if (resource.sizeBytes > remaining) {
        const { sha256: _sha256, ...rest } = resource;
        return { ...rest, status: "truncated", reason: "archive_limit" };
      }
      remaining -= resource.sizeBytes;
      included.add(resource.sha256);
      return resource;
    },
  );
  return {
    scope,
    staged: Object.fromEntries(staged),
    manifest: {
      archiveVersion: fullArchiveVersion,
      mode: "full",
      pageUrl: capture.pageUrl,
      baseUrl,
      capturedAt: capture.capturedAt,
      document,
      resources: items,
      issues: [...issues],
    },
  };
}

export async function uploadFullArchive(
  settings: Settings,
  jobId: string,
  leaseId: string,
  plan: FullArchivePlan,
  signal: AbortSignal,
) {
  const endpoint = "jobs/" + encodeURIComponent(jobId) + "/full-archive";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);

  async function post(path: string, data: object, abort = deadline) {
    const response = await agentFetch(settings, endpoint + path, {
      body: { leaseId, ...data },
      signal: abort,
    });
    if (!response.ok) throw new Error("Archive request failed.");
    return response;
  }

  async function upload(
    object: ArchiveObject,
    kind: "document" | "resource" = "resource",
  ) {
    const identity = {
      sha256: object.sha256,
      sizeBytes: object.sizeBytes,
      kind,
    };
    const target = await (await post("/uploads", identity)).json();
    if (target.stored === true) return;
    const url = new URL(target.url);
    if (
      url.origin !== settings.storageOrigin ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Invalid archive upload URL.");
    if (!("manifest" in plan)) throw new Error("Archive data unavailable.");
    const id = plan.staged[object.sha256];
    if (!id) throw new Error("Archive data unavailable.");
    const blob = await stagedArchiveBlob(plan.scope, id, archiveObjectMime);
    if (blob.size !== object.sizeBytes)
      throw new Error("Archive data size changed.");
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": archiveObjectMime },
      body: blob,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(25_000)]),
    });
    if (!response.ok) throw new Error("Archive upload failed.");
    await post("/seal", identity);
  }

  async function retry<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch {
      deadline.throwIfAborted();
      return operation();
    }
  }

  if (!("manifest" in plan)) {
    await retry(() => post("", { failure: plan.failure }));
    return;
  }
  try {
    const { manifest } = plan;
    await retry(() => upload(manifest.document, "document"));
    const outcomes = new Map([[manifest.document.sha256, true]]);
    const resources: ArchiveResource[] = [];
    for (const resource of manifest.resources) {
      signal.throwIfAborted();
      if (resource.status !== "captured") {
        resources.push(resource);
        continue;
      }
      if (!outcomes.has(resource.sha256))
        outcomes.set(
          resource.sha256,
          !deadline.aborted &&
            (await retry(() => upload(resource)).then(
              () => true,
              () => false,
            )),
        );
      if (outcomes.get(resource.sha256)) resources.push(resource);
      else {
        const { sha256: _sha256, ...rest } = resource;
        resources.push({ ...rest, status: "missing", reason: "upload_failed" });
      }
    }
    const reportSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
    await post("", { manifest: { ...manifest, resources } }, reportSignal);
  } catch (error) {
    if (signal.aborted) throw error;
    // Canonical completion has a separate receipt and can proceed.
    await post(
      "",
      { failure: "upload_failed" },
      AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
    ).catch(() => undefined);
  }
}
