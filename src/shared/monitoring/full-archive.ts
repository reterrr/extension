import { monitoredURL } from "./contracts";

export const fullArchiveVersion = "full-resource-1";
export const archiveObjectMime = "application/octet-stream";
export const archiveEntries = 512;
export const maxArchiveBytes = 512 * 1024 * 1024;
export const maxArchiveResourceBytes = 64 * 1024 * 1024;
export const maxArchiveCssBytes = 2 * 1024 * 1024;
export const maxArchiveManifestBytes = 3 * 1024 * 1024;
export const archiveDigest = /^[0-9a-f]{64}$/;

export interface ArchiveLimits {
  version: typeof fullArchiveVersion;
  maxBytes: number;
  maxResourceBytes: number;
}

export type ArchiveIssue =
  | "response_unavailable"
  | "recording_unavailable"
  | "resource_limit"
  | "archive_limit"
  | "buffer_limit"
  | "request_limit"
  | "capture_timeout"
  | "upload_failed"
  | "unsupported_media";

export type ArchiveFailure = "capture_unavailable" | "upload_failed";

export interface ArchiveObject {
  sha256: string;
  sizeBytes: number;
}

type ResourceLocation = {
  originalUrl: string;
  responseUrl?: string;
};

export type ArchiveResource = ResourceLocation &
  (
    | (ArchiveObject & { status: "captured"; mediaType: string })
    | {
        status: "missing" | "truncated";
        mediaType?: string;
        sizeBytes?: number;
        reason: ArchiveIssue;
      }
  );

export interface FullArchiveManifest {
  archiveVersion: typeof fullArchiveVersion;
  mode: "full";
  pageUrl: string;
  baseUrl: string;
  capturedAt: string;
  document: ArchiveObject;
  resources: ArchiveResource[];
  issues: ArchiveIssue[];
}

export type FullArchivePlan =
  | {
      scope: string;
      manifest: FullArchiveManifest;
      staged: Record<string, string>;
    }
  | { scope: string; failure: ArchiveFailure };

export function validArchiveLimits(
  value: ArchiveLimits | undefined,
): value is ArchiveLimits {
  return (
    !!value &&
    value.version === fullArchiveVersion &&
    Number.isSafeInteger(value.maxBytes) &&
    value.maxBytes > 0 &&
    value.maxBytes <= maxArchiveBytes &&
    Number.isSafeInteger(value.maxResourceBytes) &&
    value.maxResourceBytes > 0 &&
    value.maxResourceBytes <= value.maxBytes &&
    value.maxResourceBytes <= maxArchiveResourceBytes
  );
}

export function archiveURL(value: string, base: string, allowHttp: boolean) {
  try {
    const url = monitoredURL(new URL(value, base).href, { allowHttp });
    url.hash = "";
    return url.href.length <= 2048 ? url.href : undefined;
  } catch {
    return undefined;
  }
}
