import "../domain/schema.js";
import {
  safeDownloadPathSegment,
  uniqueDownloadFileNames,
} from "../fileDownloads";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../types/legacy-storage";
import { createPortableExport } from "./portableExport.js";

const MIB = 1024 * 1024;
export const FUNDPILOT_EXPORT_FILE_MAX_BYTES = 100 * MIB;
export const FUNDPILOT_EXPORT_TOTAL_FILE_MAX_BYTES = 512 * MIB;

export interface FundPilotPackageReference {
  object: string;
  file: string;
}

export interface FundPilotPackageFile {
  source: string;
  path: string;
  name: string;
  file_type: string;
  original_url: string;
  references: FundPilotPackageReference[];
}

export interface FundPilotSystemObject {
  key: string;
  id: string;
  type: string;
  label?: string;
  source_url?: string;
  creation_note?: string;
  created_at?: string;
  updated_at?: string;
  last_checked_at?: string;
}

export interface FundPilotExportV1 {
  format: "FundPilotExportV1";
  exported_at: string;
  root_object: {
    key: string;
    type: string;
    name: string;
  };
  package_files: FundPilotPackageFile[];
  data: ReturnType<typeof createPortableExport>;
  system: {
    workspace_revision: number;
    objects: FundPilotSystemObject[];
  };
}

export interface FundPilotPackageSource {
  source: LegacyStoredFileSource;
  sourceKey: string;
  path: string;
}

export interface FundPilotExportPackagePlan {
  document: FundPilotExportV1;
  files: FundPilotPackageSource[];
  zipFileName: string;
}

export interface FundPilotExportZipResult {
  blob: Blob;
  document: FundPilotExportV1;
  zipFileName: string;
}

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

interface PortableSource {
  key: string;
  type: string;
  url?: string;
}

interface PortableFile {
  key: string;
  source?: string;
  without_template?: boolean;
}

interface PortableObject {
  key: string;
  type: string;
  data?: Record<string, unknown>;
  files?: PortableFile[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectDisplayName(object: LegacyStoredObject): string {
  if (object.type === "recruitment") {
    const value = cleanText(object.values?.external_number);
    if (value) return value;
  }
  const value = cleanText(object.values?.name);
  return value || cleanText(object.label) || cleanText(object.importKey) || object.id;
}

function portableObjectForStoredObject(
  portableObjects: PortableObject[],
  object: LegacyStoredObject,
): PortableObject | undefined {
  const candidates = [
    cleanText(object.importKey),
    cleanText(object.id),
  ].filter(Boolean);
  return portableObjects.find(
    (entry) =>
      entry.type === object.type &&
      candidates.includes(String(entry.key)),
  );
}

function storedObjectForPortableObject(
  state: LegacyStorageState,
  portableObject: PortableObject,
): LegacyStoredObject | undefined {
  return (state.objects ?? []).find(
    (object) =>
      object.type === portableObject.type &&
      (String(object.importKey ?? "") === String(portableObject.key) ||
        String(object.id) === String(portableObject.key)),
  );
}

function sourceFileName(url: string): string {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "");
    return name.trim();
  } catch {
    return "";
  }
}

function findStoredFileSource(
  state: LegacyStorageState,
  object: LegacyStoredObject | undefined,
  source: PortableSource,
  portableFile: PortableFile,
): LegacyStoredFileSource | undefined {
  const candidates = (state.fileSources ?? []).filter(
    (row) =>
      row.url === source.url &&
      String(row.fileType) === String(source.type) &&
      (!object || row.objectId === object.id),
  );
  if (!candidates.length) {
    return (state.fileSources ?? []).find(
      (row) =>
        row.url === source.url &&
        String(row.fileType) === String(source.type),
    );
  }
  return (
    candidates.find(
      (row) =>
        String(row.importKey ?? "") === String(portableFile.key) ||
        String(row.id) === String(portableFile.key),
    ) ?? candidates[0]
  );
}

function packageSources(
  state: LegacyStorageState,
  portable: ReturnType<typeof createPortableExport>,
): {
  packageFiles: FundPilotPackageFile[];
  packageSources: Array<{
    sourceKey: string;
    source: LegacyStoredFileSource;
    name: string;
  }>;
} {
  const portableSources = new Map(
    (portable.sources as PortableSource[]).map((source) => [String(source.key), source]),
  );
  const occurrences = new Map<
    string,
    {
      source: PortableSource;
      stored: LegacyStoredFileSource;
      references: FundPilotPackageReference[];
    }
  >();

  for (const portableObject of portable.objects as PortableObject[]) {
    const storedObject = storedObjectForPortableObject(state, portableObject);
    for (const portableFile of portableObject.files ?? []) {
      if (portableFile.without_template || !portableFile.source) continue;
      const sourceKey = String(portableFile.source);
      const portableSource = portableSources.get(sourceKey);
      if (!portableSource?.url) {
        throw new Error(
          `Plik „${portableFile.key}” nie ma adresu źródłowego i nie może zostać dołączony do eksportu FundPilot.`,
        );
      }
      const stored = findStoredFileSource(
        state,
        storedObject,
        portableSource,
        portableFile,
      );
      if (!stored) {
        throw new Error(
          `Nie znaleziono fizycznego pliku dla źródła „${sourceKey}”.`,
        );
      }

      const existing = occurrences.get(sourceKey);
      const reference = {
        object: String(portableObject.key),
        file: String(portableFile.key),
      };
      if (existing) {
        if (
          !existing.references.some(
            (entry) =>
              entry.object === reference.object &&
              entry.file === reference.file,
          )
        ) {
          existing.references.push(reference);
        }
      } else {
        occurrences.set(sourceKey, {
          source: portableSource,
          stored,
          references: [reference],
        });
      }
    }
  }

  const entries = [...occurrences.entries()];
  const names = uniqueDownloadFileNames(
    entries.map(([sourceKey, entry], index) => {
      const fallbackFromUrl = sourceFileName(entry.source.url ?? "");
      const fallback = fallbackFromUrl || `plik-${index + 1}`;
      return safeDownloadPathSegment(
        cleanText(entry.stored.name) || fallback,
        fallback,
        false,
        180,
      );
    }),
    false,
  );

  const packageFiles: FundPilotPackageFile[] = [];
  const packageSourceRows: Array<{
    sourceKey: string;
    source: LegacyStoredFileSource;
    name: string;
  }> = [];

  entries.forEach(([sourceKey, entry], index) => {
    const name = names[index];
    packageFiles.push({
      source: sourceKey,
      path: `files/${name}`,
      name,
      file_type: String(entry.source.type),
      original_url: String(entry.source.url),
      references: entry.references,
    });
    packageSourceRows.push({
      sourceKey,
      source: entry.stored,
      name,
    });
  });

  return {
    packageFiles,
    packageSources: packageSourceRows,
  };
}

function systemObjects(
  state: LegacyStorageState,
  portableObjects: PortableObject[],
): FundPilotSystemObject[] {
  const rows: FundPilotSystemObject[] = [];
  for (const portableObject of portableObjects) {
    const object = storedObjectForPortableObject(state, portableObject);
    if (!object) continue;
    const row: FundPilotSystemObject = {
      key: String(portableObject.key),
      id: String(object.id),
      type: String(object.type),
    };
    const label = cleanText(object.label);
    const sourceUrl = cleanText(object.sourceUrl);
    const creationNote = cleanText(object.creationNote);
    const createdAt = cleanText(object.createdAt);
    const updatedAt = cleanText(object.updatedAt);
    const lastCheckedAt = cleanText(object.values?.last_checked_at);
    if (label) row.label = label;
    if (sourceUrl) row.source_url = sourceUrl;
    if (creationNote) row.creation_note = creationNote;
    if (createdAt) row.created_at = createdAt;
    if (updatedAt) row.updated_at = updatedAt;
    if (lastCheckedAt) row.last_checked_at = lastCheckedAt;
    rows.push(row);
  }
  return rows;
}

export function buildFundPilotExportPackagePlan(
  state: LegacyStorageState,
  rootObject: LegacyStoredObject,
  exportedAt = new Date().toISOString(),
): FundPilotExportPackagePlan {
  if (rootObject.type !== "project" && rootObject.type !== "recruitment") {
    throw new Error("Eksport FundPilot jest dostępny dla projektu i naboru.");
  }

  const portable = createPortableExport({
    state,
    view: { objectIds: [rootObject.id] },
    schema: globalThis.BurbotSchema ?? {},
    exportedAt,
  });

  const portableObjects = portable.objects as PortableObject[];
  const portableRoot = portableObjectForStoredObject(
    portableObjects,
    rootObject,
  );
  if (!portableRoot) {
    throw new Error("Nie udało się ustalić obiektu głównego eksportu FundPilot.");
  }

  const { packageFiles, packageSources: physicalSources } = packageSources(
    state,
    portable,
  );

  const document: FundPilotExportV1 = {
    format: "FundPilotExportV1",
    exported_at: exportedAt,
    root_object: {
      key: String(portableRoot.key),
      type: String(rootObject.type),
      name: objectDisplayName(rootObject),
    },
    package_files: packageFiles,
    data: portable,
    system: {
      workspace_revision: state.revision,
      objects: systemObjects(state, portableObjects),
    },
  };

  const folderName = safeDownloadPathSegment(
    `FundPilot - ${objectDisplayName(rootObject)}`,
    "FundPilot-export",
    false,
    180,
  );

  return {
    document,
    files: physicalSources.map((entry, index) => ({
      source: entry.source,
      sourceKey: entry.sourceKey,
      path: packageFiles[index].path,
    })),
    zipFileName: `${folderName}.zip`,
  };
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function buildFundPilotStoreZip(
  entries: readonly ZipEntry[],
  modifiedAt = new Date(),
): Uint8Array {
  if (!entries.length || entries.length > 0xffff) {
    throw new Error("ZIP musi zawierać od 1 do 65535 wpisów.");
  }

  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(modifiedAt);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const paths = new Set<string>();
  let localOffset = 0;

  for (const entry of entries) {
    if (
      !entry.path ||
      entry.path.startsWith("/") ||
      entry.path.includes("\\") ||
      entry.path.includes(":") ||
      entry.path.includes("%") ||
      entry.path.split("/").includes("..")
    ) {
      throw new Error(`Nieprawidłowa ścieżka ZIP: ${entry.path}`);
    }
    if (paths.has(entry.path)) {
      throw new Error(`Duplikat ścieżki ZIP: ${entry.path}`);
    }
    paths.add(entry.path);

    const name = encoder.encode(entry.path);
    if (name.byteLength > 0xffff) {
      throw new Error(`Nazwa ZIP jest zbyt długa: ${entry.path}`);
    }
    if (entry.data.byteLength > 0xffffffff) {
      throw new Error(`Plik jest zbyt duży dla ZIP bez ZIP64: ${entry.path}`);
    }

    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    setU32(localView, 0, 0x04034b50);
    setU16(localView, 4, 20);
    setU16(localView, 6, 0x0800);
    setU16(localView, 8, 0);
    setU16(localView, 10, time);
    setU16(localView, 12, date);
    setU32(localView, 14, crc);
    setU32(localView, 18, entry.data.byteLength);
    setU32(localView, 22, entry.data.byteLength);
    setU16(localView, 26, name.byteLength);
    setU16(localView, 28, 0);
    local.set(name, 30);
    locals.push(local, entry.data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    setU32(centralView, 0, 0x02014b50);
    setU16(centralView, 4, 20);
    setU16(centralView, 6, 20);
    setU16(centralView, 8, 0x0800);
    setU16(centralView, 10, 0);
    setU16(centralView, 12, time);
    setU16(centralView, 14, date);
    setU32(centralView, 16, crc);
    setU32(centralView, 20, entry.data.byteLength);
    setU32(centralView, 24, entry.data.byteLength);
    setU16(centralView, 28, name.byteLength);
    setU16(centralView, 30, 0);
    setU16(centralView, 32, 0);
    setU16(centralView, 34, 0);
    setU16(centralView, 36, 0);
    setU32(centralView, 38, 0);
    setU32(centralView, 42, localOffset);
    central.set(name, 46);
    centrals.push(central);

    localOffset += local.byteLength + entry.data.byteLength;
  }

  const centralBytes = concatBytes(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setU32(endView, 0, 0x06054b50);
  setU16(endView, 4, 0);
  setU16(endView, 6, 0);
  setU16(endView, 8, entries.length);
  setU16(endView, 10, entries.length);
  setU32(endView, 12, centralBytes.byteLength);
  setU32(endView, 16, localOffset);
  setU16(endView, 20, 0);

  return concatBytes([...locals, centralBytes, end]);
}

async function readResponseWithLimit(
  response: Response,
  sourceName: string,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > FUNDPILOT_EXPORT_FILE_MAX_BYTES
  ) {
    throw new Error(
      `${sourceName}: plik przekracza limit 100 MiB eksportu FundPilot.`,
    );
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > FUNDPILOT_EXPORT_FILE_MAX_BYTES) {
      throw new Error(`${sourceName}: plik przekracza limit 100 MiB.`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > FUNDPILOT_EXPORT_FILE_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`${sourceName}: plik przekracza limit 100 MiB.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

async function fetchPackageFile(file: FundPilotPackageSource): Promise<Uint8Array> {
  const response = await fetch(file.source.url, {
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `${file.source.name}: pobranie zwróciło HTTP ${response.status}.`,
    );
  }
  return readResponseWithLimit(response, file.source.name);
}

export async function buildFundPilotExportZip(
  state: LegacyStorageState,
  rootObject: LegacyStoredObject,
  onProgress?: (completed: number, total: number, fileName: string) => void,
): Promise<FundPilotExportZipResult> {
  const exportedAt = new Date().toISOString();
  const plan = buildFundPilotExportPackagePlan(state, rootObject, exportedAt);
  const entries: ZipEntry[] = [
    {
      path: "fundpilot.json",
      data: new TextEncoder().encode(JSON.stringify(plan.document, null, 2)),
    },
  ];

  let totalBytes = 0;
  for (let index = 0; index < plan.files.length; index++) {
    const file = plan.files[index];
    onProgress?.(index, plan.files.length, file.source.name);
    const data = await fetchPackageFile(file);
    totalBytes += data.byteLength;
    if (totalBytes > FUNDPILOT_EXPORT_TOTAL_FILE_MAX_BYTES) {
      throw new Error(
        "Łączny rozmiar plików przekracza limit 512 MiB eksportu FundPilot.",
      );
    }
    entries.push({ path: file.path, data });
  }
  if (plan.files.length) {
    onProgress?.(plan.files.length, plan.files.length, "");
  }

  const zip = buildFundPilotStoreZip(entries, new Date(exportedAt));
  const blobBytes = new Uint8Array(zip.byteLength);
  blobBytes.set(zip);
  return {
    blob: new Blob([blobBytes.buffer], { type: "application/zip" }),
    document: plan.document,
    zipFileName: plan.zipFileName,
  };
}
