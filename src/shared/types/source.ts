export type SourceFileType = "PDF";

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
