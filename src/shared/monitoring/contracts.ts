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
export const captureMessage = "burbot:monitoring-capture";
export const representation = "rendered_dom";
export const representationVersion = "firefox-dom-1";
export const structureHashVersion = "dom-shape-1";
export const mimeType = "text/html";

export interface Settings {
  enabled: boolean;
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
  selectors: PinnedSelector[];
}

export interface Capture {
  html: string;
  contentHash: string;
  structureHash: string;
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
  representation: typeof representation;
  representationVersion: typeof representationVersion;
  structureHashVersion: typeof structureHashVersion;
  hashAlgorithm: "sha256";
  mimeType: typeof mimeType;
};

export interface CaptureMessage {
  type: typeof captureMessage;
  expectedOrigins: string[];
  selectors: PinnedSelector[];
}

export type AgentStatus = {
  state: "idle" | "checking" | "error" | "disabled";
  lastUpdate: string;
};

export const secretName =
  /token|password|passwd|secret|session|credential|auth|signature|code$/i;

export function monitoredURL(input: string): URL {
  const url = new URL(input);
  const labels = url.hostname.split(".");
  const suffix = labels.at(-1) ?? "";
  if (
    /[\x00-\x20\\\x7f]/.test(input) ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
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
    [
      ...url.searchParams.keys(),
      ...new URLSearchParams(url.hash.slice(1)).keys(),
    ].some((key) => secretName.test(key))
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
  return {
    enabled: settings.enabled,
    apiOrigin: configuredOrigin(settings.apiOrigin),
    storageOrigin: configuredOrigin(settings.storageOrigin),
    agentToken,
    allowedOrigins: allowedOrigins(settings.allowedOrigins),
  };
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
