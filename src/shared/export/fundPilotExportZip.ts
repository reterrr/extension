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
import { buildStoreZip } from "./roundImportZip";

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
  type: string;
  label?: string;
  source_url?: string;
  creation_note?: string;
  created_at?: string;
  updated_at?: string;
  last_checked_at?: string;
}

export interface FundPilotExternalPackageFile {
  path: string;
  name: string;
  file_type: string;
  original_url: string;
  documents?: string[];
}

export interface FundPilotExportV2 {
  format: "FundPilotExportV2";
  exported_at: string;
  root_object: {
    type: string;
    name: string;
  };
  package_files: FundPilotExternalPackageFile[];
  recruitment: Record<string, unknown>;
  system: {
    workspace_revision: number;
    object: FundPilotSystemObject;
  };
}

export interface FundPilotPackageSource {
  source: LegacyStoredFileSource;
  sourceKey: string;
  path: string;
}

export interface FundPilotExportPackagePlan {
  document: FundPilotExportV2;
  files: FundPilotPackageSource[];
  zipFileName: string;
}

export interface FundPilotExportZipResult {
  blob: Blob;
  document: FundPilotExportV2;
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
  const value = cleanText(object.values?.external_number);
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function scopedRows<T extends { objectId?: unknown }>(
  rows: readonly T[] | undefined,
  objectId: string,
): T[] {
  return (rows ?? []).filter(
    (row) => String(row.objectId ?? "") === String(objectId),
  );
}

function portableStateForRecruitment(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): LegacyStorageState {
  const object = cloneJson(recruitment);
  const values = { ...(object.values ?? {}) };

  // FundPilot package scope is exactly one Recruitment. Relations may still be
  // present in complete_state for traceability, but the portable business
  // payload must not pull Project / Operator objects into objects[].
  delete values.project_id;
  delete values.operator_id;
  object.values = values;

  return {
    version: 1,
    revision: state.revision,
    objects: [object],
    rules: cloneJson(scopedRows(state.rules, recruitment.id)),
    geographies: cloneJson(
      scopedRows(state.geographies, recruitment.id).map((row) => {
        const copy = { ...row };
        delete copy.operatorId;
        return copy;
      }),
    ),
    operatorAssignments: [],
    operatorContacts: [],
    fileSources: cloneJson(scopedRows(state.fileSources, recruitment.id)),
    importSources: cloneJson(state.importSources ?? []),
    importTargetEvidence: cloneJson(
      scopedRows(state.importTargetEvidence, recruitment.id),
    ),
    financingRules: cloneJson(
      scopedRows(state.financingRules, recruitment.id).map((row) => {
        const copy = { ...row };
        delete copy.service_category_id;
        return copy;
      }),
    ),
    serviceCategories: [],
    documentRequirements: cloneJson(
      scopedRows(state.documentRequirements, recruitment.id),
    ),
    fieldEvidence: cloneJson(
      scopedRows(state.fieldEvidence, recruitment.id),
    ),
  };
}

function completeStateForRecruitment(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): LegacyStorageState {
  const objectIds = new Set([String(recruitment.id)]);
  const belongsToExport = (row: { objectId?: unknown }) =>
    objectIds.has(String(row.objectId ?? ""));

  const fileSources = (state.fileSources ?? []).filter(belongsToExport);
  const importTargetEvidence = (state.importTargetEvidence ?? []).filter(
    belongsToExport,
  );

  const referencedSourceIds = new Set<string>();
  const referencedSourceKeys = new Set<string>();
  for (const proofs of Object.values(recruitment.evidence ?? {})) {
    for (const proof of proofs) {
      if (proof?.sourceId) referencedSourceIds.add(String(proof.sourceId));
    }
  }
  for (const proof of importTargetEvidence) {
    if (proof.sourceId) referencedSourceIds.add(String(proof.sourceId));
  }
  for (const file of fileSources) {
    if (file.sourceImportKey) {
      referencedSourceKeys.add(String(file.sourceImportKey));
    }
    if (file.sourcePageImportKey) {
      referencedSourceKeys.add(String(file.sourcePageImportKey));
    }
  }

  const importSources = (state.importSources ?? []).filter(
    (source) =>
      referencedSourceIds.has(String(source.id)) ||
      referencedSourceKeys.has(String(source.importKey)),
  );

  return cloneJson({
    version: 1,
    revision: state.revision,
    objects: [recruitment],
    rules: (state.rules ?? []).filter(belongsToExport),
    geographies: (state.geographies ?? []).filter(belongsToExport),
    operatorAssignments: [],
    operatorContacts: [],
    fileSources,
    importSources,
    importTargetEvidence,
    financingRules: (state.financingRules ?? []).filter(belongsToExport),
    serviceCategories: [],
    documentRequirements: (state.documentRequirements ?? []).filter(
      belongsToExport,
    ),
    fieldEvidence: (state.fieldEvidence ?? []).filter(belongsToExport),
  });
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
  if (rootObject.type !== "recruitment") {
    throw new Error("Eksport FundPilot jest dostępny tylko dla jednego naboru.");
  }

  const portableState = portableStateForRecruitment(state, rootObject);
  const portable = createPortableExport({
    state: portableState,
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
    complete_state: completeStateForRecruitment(state, rootObject),
    system: {
      workspace_revision: state.revision,
      objects: systemObjects(state, [portableRoot]),
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

export const buildFundPilotStoreZip = buildStoreZip;

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
