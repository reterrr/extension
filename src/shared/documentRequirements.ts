import type {
  LegacyStoredDocumentRequirement,
  LegacyStoredFileSource,
} from "./types/legacy-storage";

export const DOCUMENT_REQUIREMENTS = [
  "UNKNOWN",
  "REQUIRED",
  "CONDITIONAL",
  "INFORMATIONAL",
  // Kept only so old committed states/imports remain readable.
  "OPTIONAL",
] as const;

export type DocumentRequirement = (typeof DOCUMENT_REQUIREMENTS)[number];

export const DOCUMENT_FULFILLMENT_MODES = [
  "OPERATOR_TEMPLATE",
  "WITHOUT_OPERATOR_TEMPLATE",
] as const;

export type DocumentFulfillmentMode =
  (typeof DOCUMENT_FULFILLMENT_MODES)[number];

export const DOCUMENT_RESPONSIBILITIES = [
  "FUNDPILOT",
  "CLIENT",
  "SHARED",
] as const;

export type DocumentResponsibility =
  (typeof DOCUMENT_RESPONSIBILITIES)[number];

export const DOCUMENT_SIGNATURE_REQUIREMENTS = [
  "UNKNOWN",
  "NOT_REQUIRED",
  "REQUIRED_FILE",
  "EXTERNAL_OPERATOR",
] as const;

export type DocumentSignatureRequirement =
  (typeof DOCUMENT_SIGNATURE_REQUIREMENTS)[number];

export const DOCUMENT_REQUIREMENT_LABELS: Record<DocumentRequirement, string> = {
  UNKNOWN: "Nie ustalono",
  REQUIRED: "Obowiązkowy",
  CONDITIONAL: "Warunkowy",
  INFORMATIONAL: "Informacyjny",
  OPTIONAL: "Opcjonalny (legacy)",
};

export const DOCUMENT_FULFILLMENT_MODE_LABELS: Record<
  DocumentFulfillmentMode,
  string
> = {
  OPERATOR_TEMPLATE: "Wzór udostępniony przez operatora",
  WITHOUT_OPERATOR_TEMPLATE: "Dokument dostarczany bez wzoru operatora",
};

export const DOCUMENT_RESPONSIBILITY_LABELS: Record<
  DocumentResponsibility,
  string
> = {
  FUNDPILOT: "FundPilot",
  CLIENT: "Klient",
  SHARED: "Wspólna",
};

export const DOCUMENT_SIGNATURE_LABELS: Record<
  DocumentSignatureRequirement,
  string
> = {
  UNKNOWN: "Nie ustalono",
  NOT_REQUIRED: "Nie jest wymagany",
  REQUIRED_FILE: "Wymagany podpisany plik",
  EXTERNAL_OPERATOR: "Dowód / podpis w systemie operatora",
};

const requirementFromFile: Record<string, DocumentRequirement> = {
  Obowiązkowy: "REQUIRED",
  Warunkowy: "CONDITIONAL",
  Informacyjny: "INFORMATIONAL",
};

const signatureFromFile: Record<string, DocumentSignatureRequirement> = {
  "Nie jest wymagany": "NOT_REQUIRED",
  "Wymagany podpisany plik": "REQUIRED_FILE",
  "Dowód w systemie operatora": "EXTERNAL_OPERATOR",
};

export function requirementFromFileSource(
  source: LegacyStoredFileSource,
): DocumentRequirement {
  return requirementFromFile[String(source.client_requirement ?? "")] ?? "UNKNOWN";
}

export function signatureFromFileSource(
  source: LegacyStoredFileSource,
): DocumentSignatureRequirement {
  return signatureFromFile[String(source.signature_requirement ?? "")] ?? "UNKNOWN";
}

export function documentRequirementFromFile(
  source: LegacyStoredFileSource,
  id: string,
  objectId: string,
  importKey: string,
): LegacyStoredDocumentRequirement {
  const requirement = requirementFromFileSource(source);
  const intendedUse =
    typeof source.intended_use === "string" ? source.intended_use.trim() : "";
  const label =
    (typeof source.display_name === "string" && source.display_name.trim()) ||
    source.name;

  return {
    id,
    objectId,
    importKey,
    label,
    purpose: intendedUse,
    requirement,
    ...(requirement === "CONDITIONAL" && intendedUse
      ? { condition: intendedUse.slice(0, 1000) }
      : {}),
    fulfillment_mode: "OPERATOR_TEMPLATE",
    responsibility: "CLIENT",
    signature_requirement: signatureFromFileSource(source),
    original_file_source_id: source.id,
    source_file_source_ids: [source.id],
    source_url: source.sourcePageUrl || source.url,
  };
}

export function emptyDocumentRequirement(
  id: string,
  objectId: string,
  importKey: string,
): LegacyStoredDocumentRequirement {
  return {
    id,
    objectId,
    importKey,
    label: "Nowy dokument",
    purpose: "",
    requirement: "UNKNOWN",
    fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
    responsibility: "CLIENT",
    signature_requirement: "UNKNOWN",
    source_file_source_ids: [],
  };
}

export function normalizeDocumentRequirement(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...row };

  // Old rows used only requirement/auto_fill/notes and a catalog key.
  if (!normalized.label) {
    const legacyName = globalThis.BurbotDocuments.catalog.find(
      (entry) =>
        String(entry.key) === String(normalized.document_type_key ?? ""),
    )?.name;
    normalized.label =
      (typeof legacyName === "string" && legacyName) ||
      String(normalized.document_type_key ?? "Dokument");
  }
  if (!normalized.purpose && typeof normalized.notes === "string") {
    normalized.purpose = normalized.notes;
  }
  if (!normalized.fulfillment_mode) {
    normalized.fulfillment_mode = "WITHOUT_OPERATOR_TEMPLATE";
  }
  if (!normalized.signature_requirement) {
    normalized.signature_requirement = "UNKNOWN";
  }
  if (!normalized.responsibility) {
    normalized.responsibility = "CLIENT";
  }
  if (!Array.isArray(normalized.source_file_source_ids)) {
    normalized.source_file_source_ids = [];
  }
  return normalized;
}

export function isDocumentRequirement(value: unknown): value is DocumentRequirement {
  return DOCUMENT_REQUIREMENTS.includes(value as DocumentRequirement);
}

export function isDocumentFulfillmentMode(
  value: unknown,
): value is DocumentFulfillmentMode {
  return DOCUMENT_FULFILLMENT_MODES.includes(value as DocumentFulfillmentMode);
}

export function isDocumentResponsibility(
  value: unknown,
): value is DocumentResponsibility {
  return DOCUMENT_RESPONSIBILITIES.includes(value as DocumentResponsibility);
}

export function isDocumentSignatureRequirement(
  value: unknown,
): value is DocumentSignatureRequirement {
  return DOCUMENT_SIGNATURE_REQUIREMENTS.includes(
    value as DocumentSignatureRequirement,
  );
}
