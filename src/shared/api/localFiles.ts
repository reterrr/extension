import {
  createRemoteFileSourceCandidate,
  sourceFileTypeFromUrl,
} from "../sources/remoteFile";
import type { RemoteFileSourceCandidate } from "../types/source";

const DB_SERVICE_URL = "http://127.0.0.1:8765";
const MAX_LOCAL_FILE_BYTES = 100 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  "doc",
  "docx",
  "pdf",
  "xlsx",
  "png",
  "jpg",
  "jpeg",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
]);

interface LocalFileUploadResponse {
  id: string;
  name: string;
  size: number;
  url: string;
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLocaleLowerCase("en-US") : "";
}

export function isSupportedLocalUpload(file: File): boolean {
  return (
    file.size > 0 &&
    file.size <= MAX_LOCAL_FILE_BYTES &&
    SUPPORTED_EXTENSIONS.has(extension(file.name))
  );
}

export function localUploadValidationMessage(file: File): string | null {
  if (!file.size) return `${file.name || "Plik"} jest pusty.`;
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    return `${file.name}: maksymalny rozmiar pliku to 100 MB.`;
  }
  if (!SUPPORTED_EXTENSIONS.has(extension(file.name))) {
    return `${file.name}: obsługiwane są .doc, .docx, .pdf, .xlsx, .png, .jpg, .jpeg, .zip, .rar, .7z, .tar, .gz i .tgz.`;
  }
  return null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Fall through to the HTTP status text.
  }
  return response.statusText || `HTTP ${response.status}`;
}

export async function uploadLocalFile(
  file: File,
): Promise<RemoteFileSourceCandidate> {
  const validation = localUploadValidationMessage(file);
  if (validation) throw new Error(validation);

  let response: Response;
  try {
    response = await fetch(
      `${DB_SERVICE_URL}/files?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      },
    );
  } catch (cause) {
    const suffix = cause instanceof Error ? ` (${cause.message})` : "";
    throw new Error(
      `Nie można wgrać pliku. Uruchom lokalną bazę przez "npm run db".${suffix}`,
    );
  }

  if (!response.ok) throw new Error(await readError(response));
  const uploaded = (await response.json()) as Partial<LocalFileUploadResponse>;
  if (
    typeof uploaded.url !== "string" ||
    typeof uploaded.name !== "string" ||
    typeof uploaded.id !== "string" ||
    sourceFileTypeFromUrl(uploaded.url) === null
  ) {
    throw new Error("Lokalna baza zwróciła nieprawidłowy rekord pliku.");
  }

  // The DB service exposes the uploaded blob through a stable localhost HTTP URL.
  // Reuse the normal remote-file pipeline so PDF reading, download and inheritance
  // work exactly the same way as for files picked from a webpage.
  return createRemoteFileSourceCandidate(
    uploaded.url,
    uploaded.url,
    uploaded.name,
  );
}
