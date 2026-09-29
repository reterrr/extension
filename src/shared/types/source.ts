export const SOURCE_FILE_TYPES = [
  "DOC",
  "DOCX",
  "PDF",
  "XLSX",
  "PNG",
  "JPG",
  "JPEG",
  "ZIP",
  "RAR",
  "7Z",
  "TAR",
  "GZ",
  "TGZ",
] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];

export const SOURCE_FILE_ACCEPT = ".doc,.docx,.pdf,.xlsx,.png,.jpg,.jpeg,.zip,.rar,.7z,.tar,.gz,.tgz";

export function isSourceFileType(value: unknown): value is SourceFileType {
  return (
    typeof value === "string" &&
    (SOURCE_FILE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A supported file selected from a webpage, attached from the current tab or
 * exposed by the local Burbot DB after a drag-and-drop upload.
 *
 * `url` is always the original HTTP(S) resource URL. Local `file:` paths,
 * browser blob URLs and downloaded filesystem paths are intentionally excluded.
 */
export interface RemoteFileSourceCandidate {
  fileType: SourceFileType;
  url: string;
  sourcePageUrl: string;
  name: string;
}
