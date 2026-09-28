export interface DownloadFileInput {
  name: string;
  url: string;
}

export interface DownloadFilePlan extends DownloadFileInput {
  relativePath: string;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const UNICODE_SPACES = /\p{Z}+/gu;
const FORMAT_CHARS = /\p{Cf}+/gu;
const DOWNLOADS_API_FORBIDDEN = /[<>:"\\/|?*%]/g;

function trimPathSegment(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS, " ")
    .replace(FORMAT_CHARS, "")
    .replace(UNICODE_SPACES, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

export function safeDownloadPathSegment(
  value: string,
  fallback: string,
  windows = false,
  maxLength = 100,
): string {
  // Firefox's downloads API rejects a broader set of characters than the
  // underlying filesystem on some versions/platforms. Use one conservative
  // cross-platform set instead of branching by OS.
  const cleaned = trimPathSegment(
    value.replace(DOWNLOADS_API_FORBIDDEN, " - "),
  );
  const normalized =
    !cleaned || cleaned === "." || cleaned === ".." ? fallback : cleaned;
  return normalized.slice(0, maxLength).trim().replace(/[. ]+$/g, "") || fallback;
}

export function recruitmentDownloadFolderName(
  recruitmentName: string,
  projectName: string,
  windows = false,
): string {
  const recruitment = safeDownloadPathSegment(
    recruitmentName,
    "Nabór",
    windows,
    90,
  );
  const project = safeDownloadPathSegment(projectName, "Projekt", windows, 90);
  // Keep the logical "recruitment: project" meaning, but use a filesystem/API
  // safe separator because Firefox can reject ':' even where the OS accepts it.
  return `${recruitment} - ${project}`;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { stem: name, extension: "" };
  }
  return {
    stem: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  };
}

export function uniqueDownloadFileNames(
  names: readonly string[],
  windows = false,
): string[] {
  const used = new Set<string>();

  return names.map((rawName, index) => {
    const base = safeDownloadPathSegment(
      rawName,
      `plik-${index + 1}`,
      windows,
      180,
    );
    const { stem, extension } = splitExtension(base);
    let candidate = base;
    let suffix = 2;

    while (used.has(candidate.toLocaleLowerCase("pl-PL"))) {
      candidate = `${stem} (${suffix++})${extension}`;
    }
    used.add(candidate.toLocaleLowerCase("pl-PL"));
    return candidate;
  });
}

export function projectDownloadFolderName(
  projectName: string,
  windows = false,
): string {
  return safeDownloadPathSegment(projectName, "Projekt", windows, 180);
}

export function buildProjectDownloadPlan(
  projectName: string,
  files: readonly DownloadFileInput[],
  windows = false,
): { folderName: string; files: DownloadFilePlan[] } {
  const folderName = projectDownloadFolderName(projectName, windows);
  const fileNames = uniqueDownloadFileNames(
    files.map((file) => file.name),
    windows,
  );

  return {
    folderName,
    files: files.map((file, index) => ({
      ...file,
      relativePath: `${folderName}/${fileNames[index]}`,
    })),
  };
}

export function buildRecruitmentDownloadPlan(
  recruitmentName: string,
  projectName: string,
  files: readonly DownloadFileInput[],
  windows = false,
): { folderName: string; files: DownloadFilePlan[] } {
  const folderName = recruitmentDownloadFolderName(
    recruitmentName,
    projectName,
    windows,
  );
  const fileNames = uniqueDownloadFileNames(
    files.map((file) => file.name),
    windows,
  );

  return {
    folderName,
    files: files.map((file, index) => ({
      ...file,
      relativePath: `${folderName}/${fileNames[index]}`,
    })),
  };
}
