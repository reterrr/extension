import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
import type {
  SelectorEvaluationResult,
  SelectorVersion,
} from "../types/selectors";

export const settingsKey = "burbotMonitoringSettings";
export const statusKey = "burbotMonitoringStatus";
const permissions: browser._manifest.OptionalPermission[] = [
  "cookies",
  "webRequest",
  "webRequestBlocking",
];
export const monitoringAccess = {
  permissions,
  origins: ["http://*/*", "https://*/*"],
};
export const maxSnapshotBytes = 5 * 1024 * 1024;
export const maxVisualArchiveBytes = 16 * 1024 * 1024;
export const visualArchiveVersion = "visual-html-1";
export const visualArchiveAccess = {
  permissions: [
    "webRequestFilterResponse",
  ] as browser._manifest.OptionalPermission[],
};
export const captureMessage = "burbot:monitoring-capture";
export const representation = "rendered_dom";
export const representationVersion = "firefox-dom-1";
export const structureHashVersion = "dom-shape-1";
export const comparisonVersion = "dom-comparison-1";
export const mimeType = "text/html";
export type MonitoringMode = "strict" | "trusted";

export interface Settings {
  enabled: boolean;
  mode?: MonitoringMode;
  apiOrigin: string;
  storageOrigin: string;
  agentToken: string;
  allowedOrigins: string[];
}

export interface PinnedSelector {
  selectorUuid: string;
  versionUuid: string;
  versionNo: number;
  definitionFingerprint: string;
  definition: SelectorVersion;
}

export interface Job {
  jobId: string;
  sourceId: number;
  url: string;
  allowedOrigins: string[];
  reason: string;
  leaseId: string;
  leaseExpiresAt: string;
  representation: typeof representation;
  comparisonVersion?: string;
  visualArchiveVersion?: string;
  selectors: PinnedSelector[];
  navigation?: { mode: "trusted"; allowHttp: boolean };
}

export interface SnapshotComparison {
  version: typeof comparisonVersion;
  contentHash: string;
  structureHash: string;
}

export interface Capture {
  html: string;
  contentHash: string;
  structureHash: string;
  comparison?: SnapshotComparison;
  contentSize: number;
  capturedAt: string;
  pageUrl: string;
  evaluations: {
    definitionFingerprint: string;
    result: SelectorEvaluationResult;
  }[];
}

export type Completion = Omit<Capture, "html"> & {
  leaseId: string;
  completionKey: string;
  uploadIntentId: string;
  visualArchiveUploadId?: string;
  representation: typeof representation;
  representationVersion: typeof representationVersion;
  structureHashVersion: typeof structureHashVersion;
  hashAlgorithm: "sha256";
  mimeType: typeof mimeType;
};

export interface CaptureMessage {
  type: typeof captureMessage;
  comparisonVersion?: typeof comparisonVersion;
  visualArchive?: boolean;
  expectedOrigins: string[];
  allowHttp?: boolean;
  selectors: PinnedSelector[];
}

export interface VisualMarkup {
  html: string;
  baseUrl: string;
}

export type AgentStatus = {
  state: "idle" | "checking" | "error" | "disabled";
  lastUpdate: string;
};

export const secretName =
  /token|password|passwd|secret|session|credential|auth|signature|code$/i;

export function hasSensitiveParameters(url: URL): boolean {
  let sensitive = false;
  // WebIDL iterator objects can be unavailable through Firefox's content-script wrappers.
  const inspect = (_value: string, key: string) => {
    sensitive ||= secretName.test(key);
  };
  url.searchParams.forEach(inspect);
  new URLSearchParams(url.hash.slice(1)).forEach(inspect);
  return sensitive;
}

export function monitoredURL(input: string, { allowHttp = false } = {}): URL {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
  const url = new URL(input);
  const labels = url.hostname.split(".");
  const suffix = labels.at(-1) ?? "";
  if (
    !authority ||
    authority.includes("@") ||
    /[\x00-\x20\\\x7f]/.test(input) ||
    (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
    url.port ||
    url.username ||
    url.password ||
    url.hostname.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ) ||
    !/^[a-z][a-z0-9-]*$/.test(suffix) ||
    [
      "localhost",
      "local",
      "internal",
      "lan",
      "home",
      "test",
      "invalid",
      "onion",
    ].includes(suffix) ||
    url.hostname.endsWith(".home.arpa") ||
    hasSensitiveParameters(url)
  )
    throw new Error("Unapproved source URL.");
  return url;
}

export function configuredOrigin(input: string): string {
  const url = new URL(input);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !local) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTPS origin. Local development can use loopback HTTP.",
    );
  return url.origin;
}

export function allowedOrigins(input: string[]): string[] {
  const normalized = input.map((item) => {
    const url = monitoredURL(item);
    if (url.pathname !== "/" || url.search || url.hash)
      throw new Error("Enter approved HTTPS origins without paths.");
    return url.origin;
  });
  if (!normalized.length)
    throw new Error("Add at least one approved website origin.");
  return [...new Set(normalized)].sort();
}

export function validateSettings(settings: Settings): Settings {
  const agentToken = settings.agentToken.trim();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(agentToken))
    throw new Error("Enter the issued Browser Agent token.");
  const mode = settings.mode ?? "strict";
  if (mode !== "strict" && mode !== "trusted")
    throw new Error("Choose a monitoring mode.");
  return {
    enabled: settings.enabled,
    mode,
    apiOrigin: configuredOrigin(settings.apiOrigin),
    storageOrigin: configuredOrigin(settings.storageOrigin),
    agentToken,
    allowedOrigins:
      mode === "trusted"
        ? (settings.allowedOrigins ?? [])
        : allowedOrigins(settings.allowedOrigins),
  };
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  // Firefox omits Web Crypto from content scripts on approved HTTP Sources.
  const digest = crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    : sha256Bytes(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
