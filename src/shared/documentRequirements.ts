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

  const informational = requirement === "INFORMATIONAL";
  const legacyDelivery = String(source.delivery_method ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pl-PL");
  const explicitlyWithoutTemplate =
    legacyDelivery.includes("bez wzoru") ||
    legacyDelivery.includes("without operator template");
  const explicitlyOperatorTemplate =
    legacyDelivery.includes("oryginalu operatora") ||
    legacyDelivery.includes("original operator") ||
    legacyDelivery.includes("operator template");
  const looksLikeOperatorTemplate =
    source.purpose === "Formularz do uzupełnienia" ||
    source.has_fields === true;
  const usesOperatorTemplate =
    !informational &&
    !explicitlyWithoutTemplate &&
    (explicitlyOperatorTemplate || looksLikeOperatorTemplate);
  return {
    id,
    objectId,
    importKey,
    label,
    purpose: intendedUse.slice(0, 1000),
    requirement,
    ...(requirement === "CONDITIONAL"
      ? {
          condition:
            (typeof source.condition === "string" && source.condition.trim()
              ? source.condition.trim()
              : intendedUse
            ).slice(0, 1000),
        }
      : {}),
    fulfillment_mode: usesOperatorTemplate
      ? "OPERATOR_TEMPLATE"
      : "WITHOUT_OPERATOR_TEMPLATE",
    ...(informational
      ? {}
      : {
          responsibility:
            source.responsibility === "FUNDPILOT" ||
            source.responsibility === "SHARED" ||
            source.responsibility === "CLIENT"
              ? source.responsibility
              : "CLIENT",
        }),
    ...(typeof source.delivery_stage === "string" && source.delivery_stage.trim()
      ? { delivery_stage: source.delivery_stage.trim().slice(0, 60) }
      : {}),
    ...(typeof source.required_evidence === "string" &&
    source.required_evidence.trim()
      ? { required_evidence: source.required_evidence.trim().slice(0, 4000) }
      : {}),
    ...(typeof source.source_description === "string" &&
    source.source_description.trim()
      ? { source_description: source.source_description.trim().slice(0, 1000) }
      : {}),
    signature_requirement: signatureFromFileSource(source),
    ...(usesOperatorTemplate ? { original_file_source_id: source.id } : {}),
    // The physical file remains useful as provenance even when it is only an
    // informational regulation/instruction rather than a client template.
    source_file_source_ids: [source.id],
    source_url:
      (typeof source.source_url === "string" && source.source_url.trim()) ||
      source.sourcePageUrl ||
      source.url,
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
