import type { RemoteFileSourceCandidate } from "../types/source";

function httpUrl(raw: string, base?: string): URL {
  const url = base ? new URL(raw, base) : new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "Burbot stores only the original HTTP(S) file URL, never a local file path.",
    );
  }
  return url;
}

function decodedFileName(url: URL): string {
  const raw = url.pathname.split("/").filter(Boolean).at(-1) || "document.pdf";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createRemotePdfSourceCandidate(
  rawUrl: string,
  sourcePageUrl: string,
  _nameHint?: string | null,
): RemoteFileSourceCandidate {
  const sourcePage = httpUrl(sourcePageUrl);
  const url = httpUrl(rawUrl, sourcePage.href);

  if (!/\.pdf$/i.test(url.pathname)) {
    throw new Error("Choose a PDF link ending in .pdf.");
  }

  return {
    fileType: "PDF",
    url: url.href,
    sourcePageUrl: sourcePage.href,
    // File display names are canonical and come from the actual URL filename,
    // never from link text or a predefined document catalog.
    name: decodedFileName(url).slice(0, 500),
  };
}

export function isRemotePdfUrl(rawUrl: string): boolean {
  try {
    const url = httpUrl(rawUrl);
    return /\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}
