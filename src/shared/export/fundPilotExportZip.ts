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
  const value =
    cleanText(object.values?.external_number) ||
    cleanText(object.values?.name) ||
    cleanText(object.label) ||
    cleanText(object.values?.source_number) ||
    cleanText(object.values?.number) ||
    cleanText(object.values?.nip);
  if (!value) {
    throw new Error(
      "Eksport FundPilot wymaga biznesowej nazwy obiektu zamiast wewnętrznego ID.",
    );
  }
  return value;
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

  // Internal portable state is used only to collect the current recruitment's
  // physical files. It is never serialized into fundpilot.json.
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


function objectByReference(
  state: LegacyStorageState,
  value: unknown,
): LegacyStoredObject | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.objects ?? []).find(
    (object) =>
      String(object.id) === raw ||
      String(object.importKey ?? "") === raw,
  );
}

function relationValue(
  state: LegacyStorageState,
  value: unknown,
  label: string,
): string {
  const object = objectByReference(state, value);
  if (!object) {
    throw new Error(
      "Eksport FundPilot nie może rozwiązać " +
        label +
        " „" +
        String(value) +
        "” do wartości.",
    );
  }
  return objectDisplayName(object);
}

function serviceByReference(
  state: LegacyStorageState,
  value: unknown,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.serviceCategories ?? []).find(
    (service) =>
      String(service.id) === raw ||
      String(service.importKey ?? "") === raw,
  );
}

function fileByReference(
  state: LegacyStorageState,
  value: unknown,
): LegacyStoredFileSource | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.fileSources ?? []).find(
    (file) =>
      String(file.id) === raw ||
      String(file.importKey ?? "") === raw,
  );
}

function documentByReference(
  state: LegacyStorageState,
  value: unknown,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.documentRequirements ?? []).find(
    (document) =>
      String(document.id) === raw ||
      String(document.importKey ?? "") === raw,
  );
}

function geographyByReference(
  state: LegacyStorageState,
  value: unknown,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.geographies ?? []).find(
    (row) =>
      String(row.id) === raw ||
      String(row.importKey ?? "") === raw,
  );
}

function financingByReference(
  state: LegacyStorageState,
  value: unknown,
): Record<string, unknown> | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.financingRules ?? []).find(
    (row) =>
      String(row.id ?? "") === raw ||
      String(row.importKey ?? "") === raw,
  );
}

function operatorContactByReference(
  state: LegacyStorageState,
  value: unknown,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.operatorContacts ?? []).find(
    (row) =>
      String(row.id) === raw ||
      String(row.importKey ?? "") === raw,
  );
}

function sourceByReference(
  state: LegacyStorageState,
  value: unknown,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  return (state.importSources ?? []).find(
    (source) =>
      String(source.id) === raw ||
      String(source.importKey ?? "") === raw,
  );
}

function fundingLabel(
  state: LegacyStorageState,
  row: Record<string, unknown> | undefined,
): string {
  if (!row) return "Wariant finansowania";
  const service = row.service_category_id
    ? serviceByReference(state, row.service_category_id)?.label
    : undefined;
  return [
    cleanText(row.company_size),
    cleanText(service),
    Number(row.variant_no ?? 0) > 0
      ? "wariant " + String(row.variant_no)
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function packagePathMap(
  packageFiles: FundPilotPackageFile[],
  physicalSources: Array<{
    source: LegacyStoredFileSource;
    sourceKey: string;
    name: string;
  }>,
): Map<string, string> {
  const result = new Map<string, string>();
  physicalSources.forEach((entry, index) => {
    const path = packageFiles[index]?.path;
    if (path) result.set(String(entry.source.id), path);
  });
  return result;
}

function resolvedFileValue(
  state: LegacyStorageState,
  value: unknown,
  packagePaths: Map<string, string>,
): string {
  const file = fileByReference(state, value);
  if (!file) {
    throw new Error(
      "Eksport FundPilot nie może rozwiązać pliku „" +
        String(value) +
        "” do wartości.",
    );
  }
  return (
    packagePaths.get(String(file.id)) ||
    cleanText(file.display_name) ||
    cleanText(file.name) ||
    cleanText(file.url)
  );
}

function resolvedTarget(
  state: LegacyStorageState,
  target: { kind: string; id: string } | undefined,
  packagePaths: Map<string, string>,
): Record<string, unknown> | undefined {
  if (!target) return undefined;
  let value = "";
  if (target.kind === "funding") {
    value = fundingLabel(state, financingByReference(state, target.id));
  } else if (target.kind === "file_source") {
    value = resolvedFileValue(state, target.id, packagePaths);
  } else if (target.kind === "document") {
    value = cleanText(documentByReference(state, target.id)?.label);
  } else if (target.kind === "geography") {
    value = cleanText(geographyByReference(state, target.id)?.value);
  } else if (target.kind === "operator_contact") {
    value = cleanText(operatorContactByReference(state, target.id)?.value);
  } else if (target.kind === "service_category") {
    value = cleanText(serviceByReference(state, target.id)?.label);
  }
  return { kind: target.kind, value: value || target.kind };
}

function resolvedEvidenceSource(
  state: LegacyStorageState,
  value: unknown,
): Record<string, unknown> {
  const source = sourceByReference(state, value);
  if (!source) {
    throw new Error(
      "Eksport FundPilot nie może rozwiązać źródła dowodu „" +
        String(value) +
        "”.",
    );
  }
  return {
    type: source.type,
    ...(source.url ? { url: source.url } : {}),
  };
}

function externalFieldName(field: string): string {
  if (field === "project_id") return "project";
  if (field === "operator_id") return "operator";
  if (field === "service_category_id") return "service_category";
  return field;
}

function resolvedEvidenceValue(
  state: LegacyStorageState,
  field: string,
  value: unknown,
): unknown {
  if (value === undefined) return undefined;
  if (field === "project_id") {
    return relationValue(state, value, "projektu");
  }
  if (field === "operator_id") {
    return relationValue(state, value, "operatora");
  }
  if (field === "service_category_id") {
    const service = serviceByReference(state, value);
    if (!service?.label) {
      throw new Error(
        "Eksport FundPilot nie może rozwiązać kategorii usługi z dowodu.",
      );
    }
    return service.label;
  }
  return cloneJson(value);
}

function documentTypeValue(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  const catalog = (
    globalThis as typeof globalThis & {
      BurbotDocuments?: { catalog?: Array<Record<string, unknown>> };
    }
  ).BurbotDocuments?.catalog;
  const entry = catalog?.find((candidate) => String(candidate.key) === raw);
  return cleanText(entry?.label) || raw;
}

function resolvedRecruitmentState(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
  packageFiles: FundPilotPackageFile[],
  physicalSources: Array<{
    source: LegacyStoredFileSource;
    sourceKey: string;
    name: string;
  }>,
): Record<string, unknown> {
  const packagePaths = packagePathMap(packageFiles, physicalSources);
  const project = objectByReference(state, recruitment.values?.project_id);

  const fields: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(recruitment.values ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (field === "last_checked_at") continue;
    if (field === "project_id") {
      fields.project = relationValue(state, value, "projektu");
      continue;
    }
    if (field === "operator_id") {
      fields.operator = relationValue(state, value, "operatora");
      continue;
    }
    if (field === "id" || field.endsWith("_id") || field.endsWith("Id")) {
      throw new Error(
        "Eksport FundPilot zawiera nierozwiązane pole identyfikatora " + field + ".",
      );
    }
    fields[field] = cloneJson(value);
  }

  const operatorAssignments = scopedRows(
    state.operatorAssignments,
    recruitment.id,
  );
  const operators = operatorAssignments.map((assignment) => ({
    name: relationValue(state, assignment.operatorId, "operatora"),
    role: assignment.operatorType,
  }));

  const financing = scopedRows(state.financingRules, recruitment.id).map(
    (row) => {
      const result: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(row)) {
        if (
          [
            "id",
            "objectId",
            "importKey",
            "service_category_id",
            "copiedFromProjectId",
            "copiedFromFundingRuleId",
          ].includes(field)
        ) {
          continue;
        }
        if (field === "copiedAt") {
          result.copied_at = value;
          continue;
        }
        if (field.endsWith("_id") || field.endsWith("Id")) {
          throw new Error(
            "Eksport FundPilot zawiera nierozwiązane pole finansowania " +
              field +
              ".",
          );
        }
        if (value !== undefined && value !== null && value !== "") {
          result[field] = cloneJson(value);
        }
      }

      if (row.service_category_id) {
        const service = serviceByReference(state, row.service_category_id);
        if (!service?.label) {
          throw new Error(
            "Wariant finansowania używa usługi „" +
              String(row.service_category_id) +
              "”, której definicji nie ma w bazie.",
          );
        }
        result.service_category = service.label;
      }
      if (row.copiedFromProjectId) {
        result.copied_from_project = relationValue(
          state,
          row.copiedFromProjectId,
          "projektu źródłowego finansowania",
        );
      }
      if (row.copiedFromFundingRuleId) {
        result.copied_from_financing_variant = fundingLabel(
          state,
          financingByReference(state, row.copiedFromFundingRuleId),
        );
      }
      return result;
    },
  );

  const referencedServices = financing
    .map((row) => cleanText(row.service_category))
    .filter(Boolean);
  const projectServices = project
    ? (state.serviceCategories ?? [])
        .filter(
          (service) => String(service.objectId) === String(project.id),
        )
        .map((service) => cleanText(service.label))
        .filter(Boolean)
    : [];
  const serviceCategories = [...new Set([...projectServices, ...referencedServices])];

  const geography = scopedRows(state.geographies, recruitment.id).map((row) => ({
    type: row.type,
    role: row.role,
    value: row.value,
    ...(row.operatorId
      ? { operator: relationValue(state, row.operatorId, "operatora geografii") }
      : {}),
    ...(row.copiedFromProjectId
      ? {
          copied_from_project: relationValue(
            state,
            row.copiedFromProjectId,
            "projektu źródłowego geografii",
          ),
        }
      : {}),
    ...(row.copiedFromGeographyId
      ? {
          copied_from_geography:
            geographyByReference(state, row.copiedFromGeographyId)?.value ??
            "Geografia projektu",
        }
      : {}),
    ...(row.copiedAt ? { copied_at: row.copiedAt } : {}),
  }));

  const documents = scopedRows(
    state.documentRequirements,
    recruitment.id,
  ).map((row) => ({
    label: row.label,
    purpose: row.purpose,
    requirement: row.requirement,
    fulfillment_mode: row.fulfillment_mode,
    signature_requirement: row.signature_requirement,
    ...(documentTypeValue(row.document_type_key)
      ? { document_type: documentTypeValue(row.document_type_key) }
      : {}),
    ...(row.condition ? { condition: row.condition } : {}),
    ...(row.delivery_stage ? { delivery_stage: row.delivery_stage } : {}),
    ...(row.responsibility ? { responsibility: row.responsibility } : {}),
    ...(row.required_evidence
      ? { required_evidence: row.required_evidence }
      : {}),
    ...(row.source_url ? { source_url: row.source_url } : {}),
    ...(row.source_description
      ? { source_description: row.source_description }
      : {}),
    ...(row.version_label ? { version_label: row.version_label } : {}),
    ...(row.auto_fill !== undefined ? { auto_fill: row.auto_fill } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.original_file_source_id
      ? {
          original_file: resolvedFileValue(
            state,
            row.original_file_source_id,
            packagePaths,
          ),
        }
      : {}),
    ...(row.source_file_source_ids?.length
      ? {
          source_files: row.source_file_source_ids.map((fileId) =>
            resolvedFileValue(state, fileId, packagePaths),
          ),
        }
      : {}),
    ...(row.copiedFromProjectId
      ? {
          copied_from_project: relationValue(
            state,
            row.copiedFromProjectId,
            "projektu źródłowego dokumentu",
          ),
        }
      : {}),
    ...(row.copiedFromDocumentRequirementId
      ? {
          copied_from_document:
            documentByReference(
              state,
              row.copiedFromDocumentRequirementId,
            )?.label ?? "Dokument projektu",
        }
      : {}),
    ...(row.copiedAt ? { copied_at: row.copiedAt } : {}),
  }));

  const files = scopedRows(state.fileSources, recruitment.id).map((file) => ({
    name: file.name,
    file_type: file.fileType,
    url: file.url,
    source_page_url: file.sourcePageUrl,
    added_at: file.addedAt,
    ...(packagePaths.get(String(file.id))
      ? { package_path: packagePaths.get(String(file.id)) }
      : {}),
    ...(file.display_name ? { display_name: file.display_name } : {}),
    ...(file.purpose ? { purpose: file.purpose } : {}),
    ...(file.has_fields !== undefined ? { has_fields: file.has_fields } : {}),
    ...(file.intended_use ? { intended_use: file.intended_use } : {}),
    ...(file.client_requirement
      ? { client_requirement: file.client_requirement }
      : {}),
    ...(file.signature_requirement
      ? { signature_requirement: file.signature_requirement }
      : {}),
    ...(file.condition ? { condition: file.condition } : {}),
    ...(file.delivery_stage ? { delivery_stage: file.delivery_stage } : {}),
    ...(file.responsibility ? { responsibility: file.responsibility } : {}),
    ...(file.required_evidence
      ? { required_evidence: file.required_evidence }
      : {}),
    ...(file.source_url ? { source_url: file.source_url } : {}),
    ...(file.source_description
      ? { source_description: file.source_description }
      : {}),
    ...(file.sourceImportKey
      ? { source: resolvedEvidenceSource(state, file.sourceImportKey) }
      : {}),
    ...(file.sourcePageImportKey
      ? {
          source_page_source: resolvedEvidenceSource(
            state,
            file.sourcePageImportKey,
          ),
        }
      : {}),
    ...(file.document_kind ? { document_kind: file.document_kind } : {}),
    ...(file.delivery_method
      ? { delivery_method: file.delivery_method }
      : {}),
    ...(file.metadataInferenceVersion !== undefined
      ? { metadata_inference_version: file.metadataInferenceVersion }
      : {}),
    ...(file.copiedFromProjectId
      ? {
          copied_from_project: relationValue(
            state,
            file.copiedFromProjectId,
            "projektu źródłowego pliku",
          ),
        }
      : {}),
    ...(file.copiedFromFileSourceId
      ? {
          copied_from_file:
            fileByReference(state, file.copiedFromFileSourceId)?.display_name ??
            fileByReference(state, file.copiedFromFileSourceId)?.name ??
            "Plik projektu",
        }
      : {}),
    ...(file.copiedAt ? { copied_at: file.copiedAt } : {}),
  }));

  const evidence = Object.fromEntries(
    Object.entries(recruitment.evidence ?? {}).map(([field, proofs]) => [
      externalFieldName(field),
      proofs.map((proof) => ({
        source: resolvedEvidenceSource(state, proof.sourceId),
        char_start: proof.charStart,
        char_end: proof.charEnd,
        raw_value: proof.rawValue,
        ...(Object.prototype.hasOwnProperty.call(proof, "normalizedValue")
          ? {
              normalized_value: resolvedEvidenceValue(
                state,
                field,
                proof.normalizedValue,
              ),
            }
          : {}),
      })),
    ]),
  );

  const targetEvidence = scopedRows(
    state.importTargetEvidence,
    recruitment.id,
  ).map((proof) => ({
    field: externalFieldName(proof.field),
    target: resolvedTarget(state, proof.target, packagePaths),
    source: resolvedEvidenceSource(state, proof.sourceId),
    char_start: proof.charStart,
    char_end: proof.charEnd,
    raw_value: proof.rawValue,
    ...(Object.prototype.hasOwnProperty.call(proof, "normalizedValue")
      ? {
          normalized_value: resolvedEvidenceValue(
            state,
            proof.field,
            proof.normalizedValue,
          ),
        }
      : {}),
  }));

  const fieldEvidence = scopedRows(state.fieldEvidence, recruitment.id).map(
    (proof) => ({
      field: externalFieldName(proof.field),
      ...(proof.target
        ? { target: resolvedTarget(state, proof.target, packagePaths) }
        : {}),
      page_url: proof.pageUrl,
      selector: proof.selector,
      ...(proof.selectorFallbacks?.length
        ? { selector_fallbacks: cloneJson(proof.selectorFallbacks) }
        : {}),
      extraction: cloneJson(proof.extraction),
      raw_value: proof.rawValue,
      ...(Object.prototype.hasOwnProperty.call(proof, "valueAtCapture")
        ? {
            value_at_capture: resolvedEvidenceValue(
              state,
              proof.field,
              proof.valueAtCapture,
            ),
          }
        : {}),
      created_at: proof.createdAt,
    }),
  );

  const rules = scopedRows(state.rules, recruitment.id).map((rule) => {
    const result: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(rule)) {
      if (["id", "objectId", "target"].includes(field)) continue;
      if (field === "field") {
        result.field = externalFieldName(String(value));
        continue;
      }
      if (field.endsWith("_id") || field.endsWith("Id")) {
        throw new Error(
          "Eksport FundPilot zawiera nierozwiązane pole reguły " + field + ".",
        );
      }
      if (value !== undefined) result[field] = cloneJson(value);
    }
    if (rule.target) {
      result.target = resolvedTarget(state, rule.target, packagePaths);
    }
    return result;
  });

  const sourceIds = new Set<string>();
  const sourceKeys = new Set<string>();
  for (const proofs of Object.values(recruitment.evidence ?? {})) {
    for (const proof of proofs) sourceIds.add(String(proof.sourceId));
  }
  for (const proof of scopedRows(state.importTargetEvidence, recruitment.id)) {
    sourceIds.add(String(proof.sourceId));
  }
  for (const file of scopedRows(state.fileSources, recruitment.id)) {
    if (file.sourceImportKey) sourceKeys.add(String(file.sourceImportKey));
    if (file.sourcePageImportKey) {
      sourceKeys.add(String(file.sourcePageImportKey));
    }
  }
  const sourceSignatures = new Set<string>();
  const sources = (state.importSources ?? [])
    .filter(
      (source) =>
        sourceIds.has(String(source.id)) ||
        sourceKeys.has(String(source.importKey)),
    )
    .filter((source) => {
      const signature = JSON.stringify([
        source.type,
        source.url ?? "",
        source.snapshot,
      ]);
      if (sourceSignatures.has(signature)) return false;
      sourceSignatures.add(signature);
      return true;
    })
    .map((source) => ({
      type: source.type,
      ...(source.url ? { url: source.url } : {}),
      snapshot: cloneJson(source.snapshot),
      imported_at: source.importedAt,
    }));

  return {
    name: objectDisplayName(recruitment),
    type: "recruitment",
    ...(recruitment.sourceUrl ? { source_url: recruitment.sourceUrl } : {}),
    fields,
    ...(project ? { project: objectDisplayName(project) } : {}),
    operators,
    serviceCategories,
    financingRules: financing,
    geographies: geography,
    documentRequirements: documents,
    fileSources: files,
    rules,
    evidence,
    importTargetEvidence: targetEvidence,
    fieldEvidence,
    sources,
    manualFields: Object.entries(recruitment.manualFields ?? {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([field]) => externalFieldName(field)),
    ...(recruitment.createdAt ? { created_at: recruitment.createdAt } : {}),
    ...(recruitment.updatedAt ? { updated_at: recruitment.updatedAt } : {}),
    ...(recruitment.values?.last_checked_at
      ? { last_checked_at: String(recruitment.values.last_checked_at) }
      : {}),
  };
}

function externalPackageFiles(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
  packageFiles: FundPilotPackageFile[],
  physicalSources: Array<{
    source: LegacyStoredFileSource;
    sourceKey: string;
    name: string;
  }>,
): FundPilotExternalPackageFile[] {
  const documents = scopedRows(state.documentRequirements, recruitment.id);
  return packageFiles.map((file, index) => {
    const source = physicalSources[index]?.source;
    const labels = source
      ? documents
          .filter(
            (document) =>
              String(document.original_file_source_id ?? "") ===
                String(source.id) ||
              (document.source_file_source_ids ?? [])
                .map(String)
                .includes(String(source.id)),
          )
          .map((document) => cleanText(document.label))
          .filter(Boolean)
      : [];
    return {
      path: file.path,
      name: file.name,
      file_type: file.file_type,
      original_url: file.original_url,
      ...(labels.length ? { documents: [...new Set(labels)] } : {}),
    };
  });
}

function systemObject(object: LegacyStoredObject): FundPilotSystemObject {
  const row: FundPilotSystemObject = { type: String(object.type) };
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
  return row;
}

const FORBIDDEN_REFERENCE_KEYS = new Set([
  "id",
  "objectId",
  "importKey",
  "project_id",
  "operator_id",
  "operatorId",
  "service_category_id",
  "sourceId",
  "original_file_source_id",
  "source_file_source_ids",
  "copiedFromProjectId",
  "copiedFromFundingRuleId",
  "copiedFromGeographyId",
  "copiedFromFileSourceId",
  "copiedFromDocumentRequirementId",
  "$ref",
]);

function assertExternalValues(value: unknown, path = "fundpilot"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertExternalValues(entry, path + "[" + index + "]"),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      FORBIDDEN_REFERENCE_KEYS.has(key) ||
      key.endsWith("_id") ||
      key.endsWith("Id")
    ) {
      throw new Error(
        "Eksport FundPilot nie może zawierać identyfikatora " +
          path +
          "." +
          key +
          "; relacja musi być zapisana jako wartość.",
      );
    }
    assertExternalValues(entry, path + "." + key);
  }
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

  const externalFiles = externalPackageFiles(
    state,
    rootObject,
    packageFiles,
    physicalSources,
  );
  const recruitment = resolvedRecruitmentState(
    state,
    rootObject,
    packageFiles,
    physicalSources,
  );

  const document: FundPilotExportV2 = {
    format: "FundPilotExportV2",
    exported_at: exportedAt,
    root_object: {
      type: String(rootObject.type),
      name: objectDisplayName(rootObject),
    },
    package_files: externalFiles,
    recruitment,
    system: {
      workspace_revision: state.revision,
      object: systemObject(rootObject),
    },
  };
  assertExternalValues(document);

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
