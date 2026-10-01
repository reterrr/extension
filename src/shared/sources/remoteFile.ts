import {
  isSourceFileType,
  type RemoteFileSourceCandidate,
  type SourceFileType,
} from "../types/source";

const EXTENSION_TYPES: Record<string, SourceFileType> = {
  doc: "DOC",
  docx: "DOCX",
  pdf: "PDF",
  xlsx: "XLSX",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  zip: "ZIP",
  rar: "RAR",
  "7z": "7Z",
  tar: "TAR",
  gz: "GZ",
  tgz: "TGZ",
};

const TYPE_EXTENSIONS: Partial<Record<SourceFileType, string>> = {
  DOC: "doc",
  DOCX: "docx",
  PDF: "pdf",
  XLSX: "xlsx",
  PNG: "png",
  JPG: "jpg",
  JPEG: "jpeg",
  ZIP: "zip",
  RAR: "rar",
  "7Z": "7z",
  TAR: "tar",
  GZ: "gz",
  TGZ: "tgz",
};

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

function sourceFileTypeFromExtension(extension: string): SourceFileType | null {
  return EXTENSION_TYPES[extension.toLocaleLowerCase("en-US")] ?? null;
}

export function sourceFileTypeFromName(rawName: string): SourceFileType | null {
  const clean = rawName.trim().split(/[?#]/, 1)[0];
  const match = /\.([^.\\/]+)$/i.exec(clean);
  return match ? sourceFileTypeFromExtension(match[1]) : null;
}

export function sourceFileTypeFromHint(
  rawHint: string | null | undefined,
): SourceFileType | null {
  if (!rawHint) return null;
  const match =
    /(?:^|[^a-z0-9])(docx|doc|pdf|xlsx|png|jpeg|jpg|zip|rar|7z|tar|tgz|gz)(?:$|[^a-z0-9])/i.exec(
      rawHint,
    );
  return match ? sourceFileTypeFromExtension(match[1]) : null;
}

function cleanNameHint(rawHint: string | null | undefined): string {
  return String(rawHint ?? "")
    .replace(/[\\/\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function hintedFileName(
  rawHint: string | null | undefined,
  fileType: SourceFileType,
): string | null {
  const clean = cleanNameHint(rawHint);
  if (!clean) return null;
  if (sourceFileTypeFromName(clean)) return clean;

  const extension = TYPE_EXTENSIONS[fileType];
  return extension ? `${clean}.${extension}`.slice(0, 500) : clean;
}

export function sourceFileTypeFromUrl(
  rawUrl: string,
  base?: string,
): SourceFileType | null {
  try {
    const url = httpUrl(rawUrl, base);
    const match = /\.([^.\/]+)$/i.exec(url.pathname);
    return match ? sourceFileTypeFromExtension(match[1]) : null;
  } catch {
    return null;
  }
}

export function createRemoteFileSourceCandidate(
  rawUrl: string,
  sourcePageUrl: string,
  nameHint?: string | null,
  fileTypeHint?: unknown,
): RemoteFileSourceCandidate {
  const sourcePage = httpUrl(sourcePageUrl);
  const url = httpUrl(rawUrl, sourcePage.href);
  const urlFileType = sourceFileTypeFromUrl(url.href);
  const pathExtension = /\.([^.\/]+)$/i.exec(url.pathname)?.[1] ?? null;
  const hintedType = isSourceFileType(fileTypeHint)
    ? fileTypeHint
    : sourceFileTypeFromHint(nameHint);

  if (!urlFileType && pathExtension && !hintedType) {
    throw new Error(
      "Choose a supported document/file link, or an opaque download URL without a filename extension.",
    );
  }

  const fileType = urlFileType ?? hintedType ?? "OTHER";

  const file: RemoteFileSourceCandidate = {
    fileType,
    url: url.href,
    sourcePageUrl: sourcePage.href,
    // Preserve the canonical URL filename whenever one exists. Opaque download
    // endpoints fall back to the page-provided document label instead.
    name: decodedFileName(url).slice(0, 500),
  };

  if (!urlFileType) {
    const hintedName = hintedFileName(nameHint, fileType);
    if (hintedName) file.name = hintedName;
  }

  return file;
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
