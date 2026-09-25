export const SOURCE_FILE_TYPES = [
  "DOC",
  "DOCX",
  "PDF",
  "XLSX",
  "PNG",
  "JPG",
  "JPEG",
] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];

export const SOURCE_FILE_ACCEPT = ".doc,.docx,.pdf,.xlsx,.png,.jpg,.jpeg";

export function isSourceFileType(value: unknown): value is SourceFileType {
  return (
    typeof value === "string" &&
    (SOURCE_FILE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A remote file selected from a webpage or attached from the current tab.
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
