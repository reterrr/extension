import {
  isSourceFileType,
  type RemoteFileSourceCandidate,
  type SourceFileType,
} from "../types/source";

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
  const raw = url.pathname.split("/").filter(Boolean).at(-1) || "document";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function sourceFileTypeFromUrl(rawUrl: string, base?: string): SourceFileType | null {
  try {
    const url = httpUrl(rawUrl, base);
    const match = /\.([^.\/]+)$/i.exec(url.pathname);
    const type = match?.[1]?.toUpperCase();
    return isSourceFileType(type) ? type : null;
  } catch {
    return null;
  }
}

export function createRemoteFileSourceCandidate(
  rawUrl: string,
  sourcePageUrl: string,
  _nameHint?: string | null,
): RemoteFileSourceCandidate {
  const sourcePage = httpUrl(sourcePageUrl);
  const url = httpUrl(rawUrl, sourcePage.href);
  const fileType = sourceFileTypeFromUrl(url.href);

  if (!fileType) {
    throw new Error(
      "Choose a .doc, .docx, .pdf, .xlsx, .png, .jpg or .jpeg file link.",
    );
  }

  return {
    fileType,
    url: url.href,
    sourcePageUrl: sourcePage.href,
    // Display names are canonical and come from the actual remote URL filename.
    name: decodedFileName(url).slice(0, 500),
  };
}

export function isRemoteSupportedFileUrl(rawUrl: string): boolean {
  return sourceFileTypeFromUrl(rawUrl) !== null;
}

// Compatibility helpers for the dedicated PDF extraction path.
export function createRemotePdfSourceCandidate(
  rawUrl: string,
  sourcePageUrl: string,
  nameHint?: string | null,
): RemoteFileSourceCandidate {
  const file = createRemoteFileSourceCandidate(rawUrl, sourcePageUrl, nameHint);
  if (file.fileType !== "PDF") {
    throw new Error("Choose a PDF link ending in .pdf.");
  }
  return file;
}

export function isRemotePdfUrl(rawUrl: string): boolean {
  return sourceFileTypeFromUrl(rawUrl) === "PDF";
}
