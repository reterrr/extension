import { sha256 } from "@noble/hashes/sha2.js";
import {
  archiveBase64,
  archiveDocument,
  archiveMediaTypes,
} from "../shared/monitoring/archive-document";
import {
  discardArchiveStage,
  pruneArchiveStages,
  replayArchiveScope,
  stagedArchiveBlob,
  writeArchiveChunk,
} from "../shared/monitoring/archive-stage";
import { archiveSVG } from "../shared/monitoring/archive-svg";
import {
  maxVisualArchiveBytes,
  type Settings,
} from "../shared/monitoring/contracts";
import {
  archiveDigest,
  archiveEntries,
  archiveObjectMime,
  archiveURL,
  fullArchiveVersion,
  maxArchiveBytes,
  maxArchiveCssBytes,
  maxArchiveManifestBytes,
  maxArchiveResourceBytes,
  type ArchiveObject,
  type ArchiveResource,
  type FullArchiveManifest,
} from "../shared/monitoring/full-archive";
import { agentFetch } from "./monitoring-request";

const maxReplayBytes = 768 * 1024 * 1024;
const maxStylesheetBytes = 16 * 1024 * 1024;
const base64Chunk = 96 * 1024; // A multiple of three, so only the last chunk gets padding.
const htmlMime = "text/html;charset=utf-8";

function object(value: ArchiveObject, max: number) {
  return (
    !!value &&
    typeof value.sha256 === "string" &&
    archiveDigest.test(value.sha256) &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= max
  );
}

function manifestValue(value: unknown): FullArchiveManifest {
  const manifest = value as FullArchiveManifest | null;
  if (
    !manifest ||
    manifest.archiveVersion !== fullArchiveVersion ||
    manifest.mode !== "full" ||
    typeof manifest.pageUrl !== "string" ||
    typeof manifest.baseUrl !== "string" ||
    !archiveURL(manifest.baseUrl, manifest.baseUrl, true) ||
    !object(manifest.document, maxVisualArchiveBytes) ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length > archiveEntries
  )
    throw new Error("Invalid archive manifest.");
  const objects = new Map([
    [manifest.document.sha256, manifest.document.sizeBytes],
  ]);
  const urls = new Set<string>();
  for (const resource of manifest.resources) {
    if (
      !resource ||
      typeof resource.originalUrl !== "string" ||
      archiveURL(resource.originalUrl, manifest.baseUrl, true) !==
        resource.originalUrl ||
      (resource.responseUrl != null &&
        (typeof resource.responseUrl !== "string" ||
          archiveURL(resource.responseUrl, manifest.baseUrl, true) !==
            resource.responseUrl)) ||
      urls.has(resource.originalUrl)
    )
      throw new Error("Invalid archive resource location.");
    urls.add(resource.originalUrl);
    if (resource.status !== "captured") continue;
    if (
      !object(resource, maxArchiveResourceBytes) ||
      (!archiveMediaTypes.has(resource.mediaType) &&
        resource.mediaType !== "image/svg+xml") ||
      (objects.has(resource.sha256) &&
        objects.get(resource.sha256) !== resource.sizeBytes)
    )
      throw new Error("Invalid archive resource descriptor.");
    objects.set(resource.sha256, resource.sizeBytes);
  }
  if (
    Array.from(objects.values()).reduce((sum, size) => sum + size, 0) >
    maxArchiveBytes
  )
    throw new Error("Archive exceeds its supported size.");
  return manifest;
}

async function download(
  settings: Settings,
  path: string,
  scope: string,
  id: string,
  maximum: number,
  signal: AbortSignal,
  expected?: ArchiveObject,
) {
  const response = await agentFetch(settings, path, { method: "GET", signal });
  const size = Number(response.headers.get("X-Burbot-Snapshot-Size"));
  const digest = response.headers.get("X-Burbot-Snapshot-SHA256") ?? "";
  if (
    !response.ok ||
    !response.body ||
    !object({ sizeBytes: size, sha256: digest }, maximum) ||
    response.headers.get("Content-Type")?.split(";")[0] !== archiveObjectMime ||
    (expected && (expected.sha256 !== digest || expected.sizeBytes !== size))
  )
    throw new Error("Archive object unavailable.");
  const reader = response.body.getReader();
  const hash = sha256.create();
  let count = 0;
  let index = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > size) throw new Error("Invalid archive object size.");
      hash.update(value);
      await writeArchiveChunk(
        scope,
        id,
        index++,
        new Blob([new Uint8Array(value)]),
      );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const checksum = Array.from(hash.digest(), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (count !== size || checksum !== digest)
    throw new Error("Archive object integrity check failed.");
  return stagedArchiveBlob(scope, id);
}

function resourceAliases<T>(
  map: Map<string, T>,
  resource: ArchiveResource,
  value: T,
) {
  map.set(resource.originalUrl, value);
  if (resource.responseUrl && !map.has(resource.responseUrl))
    map.set(resource.responseUrl, value);
}

async function encodeResource(
  scope: string,
  id: string,
  mime: string,
  payload: Blob,
  signal: AbortSignal,
) {
  let offset = 0;
  let index = 0;
  await writeArchiveChunk(
    scope,
    id,
    index++,
    new Blob(["data:" + mime + ";base64,"]),
  );
  while (offset < payload.size) {
    signal.throwIfAborted();
    const chunk = await payload
      .slice(offset, offset + base64Chunk)
      .arrayBuffer();
    offset += chunk.byteLength;
    await writeArchiveChunk(
      scope,
      id,
      index++,
      new Blob([archiveBase64(new Uint8Array(chunk))]),
    );
  }
  return stagedArchiveBlob(scope, id);
}

async function stylesheetText(blob: Blob) {
  const prefix = await blob.slice(0, 150).text();
  const charset = /^@charset "([^"]+)";/.exec(prefix)?.[1];
  try {
    return new TextDecoder(charset).decode(await blob.arrayBuffer());
  } catch {
    return blob.text();
  }
}

export async function prepareFullReplay(
  settings: Settings,
  endpoint: string,
  commandId: string,
  signal: AbortSignal,
) {
  const scope = replayArchiveScope(commandId);
  await pruneArchiveStages().catch(() => undefined);
  const manifestBlob = await download(
    settings,
    endpoint + "/archive-manifest",
    scope,
    "manifest",
    maxArchiveManifestBytes,
    signal,
  );
  const manifest = manifestValue(JSON.parse(await manifestBlob.text()));
  const document = await download(
    settings,
    endpoint + "/archive-objects/" + manifest.document.sha256,
    scope,
    "markup",
    maxVisualArchiveBytes,
    signal,
    manifest.document,
  );

  const assets = new Map<string, { mediaType: string; token: string }>();
  const styles = new Map<string, { css: string; base: string }>();
  const tokens = new Map<string, Blob>();
  const encoded = new Map<string, string>();
  const cssBodies = new Map<string, string>();
  const tokenPrefix = "urn:burbot-archive:" + crypto.randomUUID() + "-";
  let styleBytes = 0;
  for (const resource of manifest.resources) {
    signal.throwIfAborted();
    if (resource.status !== "captured") continue;
    const { sha256: digest, mediaType, sizeBytes } = resource;
    const internal = digest + "-" + mediaType.replaceAll("/", "-");
    if (mediaType === "text/css") {
      if (!cssBodies.has(digest)) {
        if (
          sizeBytes > maxArchiveCssBytes ||
          styleBytes + sizeBytes > maxStylesheetBytes
        )
          continue;
        const css = await download(
          settings,
          endpoint + "/archive-objects/" + digest,
          scope,
          "wire",
          maxArchiveCssBytes,
          signal,
          resource,
        );
        cssBodies.set(digest, await stylesheetText(css));
        styleBytes += sizeBytes;
        await discardArchiveStage(scope, "wire");
      }
      resourceAliases(styles, resource, {
        css: cssBodies.get(digest)!,
        base: resource.responseUrl ?? resource.originalUrl,
      });
      continue;
    }
    let token = encoded.get(internal);
    if (!token) {
      const blob = await download(
        settings,
        endpoint + "/archive-objects/" + digest,
        scope,
        "wire",
        maxArchiveResourceBytes,
        signal,
        resource,
      );
      let payload = blob;
      if (mediaType === "image/svg+xml") {
        const safe =
          blob.size <= maxArchiveCssBytes && archiveSVG(await blob.text());
        if (!safe) {
          await discardArchiveStage(scope, "wire");
          continue;
        }
        payload = new Blob([safe], { type: mediaType });
      }
      token = tokenPrefix + tokens.size;
      tokens.set(
        token,
        await encodeResource(scope, internal, mediaType, payload, signal),
      );
      encoded.set(internal, token);
      await discardArchiveStage(scope, "wire");
    }
    resourceAliases(assets, resource, { mediaType, token });
  }

  const html = archiveDocument(
    await document.text(),
    manifest.baseUrl,
    undefined,
    {
      mode: "replay",
      assets,
      styles,
    },
  );
  // The opaque publisher expires with the launch page. A native archive can
  // therefore carry local data references in file-backed Blob parts.
  const parts: BlobPart[] = [];
  let offset = 0;
  let projected = html.length * 3;
  for (const match of html.matchAll(new RegExp(tokenPrefix + "\\d+", "g"))) {
    const resource = tokens.get(match[0]);
    if (!resource) continue;
    projected += resource.size;
    if (projected > maxReplayBytes)
      throw new Error("Native archive exceeds its replay limit.");
    parts.push(html.slice(offset, match.index), resource);
    offset = match.index + match[0].length;
  }
  parts.push(html.slice(offset));
  await writeArchiveChunk(
    scope,
    "document",
    0,
    new Blob(parts, { type: htmlMime }),
  );
}
