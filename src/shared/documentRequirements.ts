import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "./types/legacy-storage";

export const DOCUMENT_REQUIREMENTS = [
  "UNKNOWN",
  "REQUIRED",
  "CONDITIONAL",
  "INFORMATIONAL",
] as const;
export type DocumentRequirementStatus = (typeof DOCUMENT_REQUIREMENTS)[number];

export const DOCUMENT_FULFILLMENT_MODES = [
  "OPERATOR_TEMPLATE",
  "WITHOUT_OPERATOR_TEMPLATE",
] as const;
export type DocumentFulfillmentMode =
  (typeof DOCUMENT_FULFILLMENT_MODES)[number];

export const DOCUMENT_DELIVERY_STAGES = [
  "APPLICATION",
  "AGREEMENT",
  "SERVICE",
  "REFUND",
  "CONTROL",
  "OTHER",
] as const;
export type DocumentDeliveryStage = (typeof DOCUMENT_DELIVERY_STAGES)[number];

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

export const DOCUMENT_REQUIREMENT_LABELS: Record<DocumentRequirementStatus, string> = {
  UNKNOWN: "Nie ustalono",
  REQUIRED: "Obowiązkowy",
  CONDITIONAL: "Warunkowy",
  INFORMATIONAL: "Informacyjny",
};

export const DOCUMENT_FULFILLMENT_LABELS: Record<DocumentFulfillmentMode, string> = {
  OPERATOR_TEMPLATE: "Wzór udostępniony przez operatora",
  WITHOUT_OPERATOR_TEMPLATE: "Dokument dostarczany bez wzoru operatora",
};

export const DOCUMENT_DELIVERY_STAGE_LABELS: Record<DocumentDeliveryStage, string> = {
  APPLICATION: "Zgłoszenie / wniosek",
  AGREEMENT: "Podpisanie umowy",
  SERVICE: "Realizacja usługi",
  REFUND: "Refundacja / rozliczenie",
  CONTROL: "Kontrola",
  OTHER: "Inny etap",
};

export const DOCUMENT_RESPONSIBILITY_LABELS: Record<DocumentResponsibility, string> = {
  FUNDPILOT: "FundPilot / operator",
  CLIENT: "Klient",
  SHARED: "Wspólna",
};

export const DOCUMENT_SIGNATURE_LABELS: Record<DocumentSignatureRequirement, string> = {
  UNKNOWN: "Nie ustalono",
  NOT_REQUIRED: "Nie jest wymagany",
  REQUIRED_FILE: "Wymagany podpisany plik",
  EXTERNAL_OPERATOR: "Potwierdzenie / podpis w systemie operatora",
};

export interface LegacyStoredDocumentRequirement {
  id: string;
  objectId: string;
  importKey?: string;

  /** Legacy compatibility with the former closed document catalog. */
  document_type_key?: string;

  label?: string;
  purpose?: string;
  requirement?: DocumentRequirementStatus | "OPTIONAL" | string;
  condition?: string;
  fulfillment_mode?: DocumentFulfillmentMode | string;
  delivery_stage?: DocumentDeliveryStage | string;
  responsibility?: DocumentResponsibility | string;
  required_evidence?: string;
  original_file_source_id?: string;
  source_file_ids?: string[];
  source_url?: string;
  source_description?: string;
  version_label?: string;
  signature_requirement?: DocumentSignatureRequirement | string;

  /** Legacy fields retained for round-trip compatibility. */
  auto_fill?: boolean;
  notes?: string;
}

export interface DocumentRequirementDraft {
  label: string;
  purpose?: string;
  requirement?: DocumentRequirementStatus;
  condition?: string;
  fulfillment_mode?: DocumentFulfillmentMode;
  delivery_stage?: DocumentDeliveryStage;
  responsibility?: DocumentResponsibility;
  required_evidence?: string;
  original_file_source_id?: string;
  source_file_ids?: string[];
  source_url?: string;
  source_description?: string;
  version_label?: string;
  signature_requirement?: DocumentSignatureRequirement;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bounded(
  value: unknown,
  maxLength: number,
  field: string,
  required = false,
): string | undefined {
  const text = clean(value);
  if (!text) {
    if (required) throw new Error(`${field} jest wymagane.`);
    return undefined;
  }
  if (text.length > maxLength) {
    throw new Error(`${field}: maksymalnie ${maxLength} znaków.`);
  }
  return text;
}

function oneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
  field: string,
): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${field}: nieznana wartość.`);
  }
  return value as T[number];
}

function url(value: unknown, field: string): string | undefined {
  const text = bounded(value, 2000, field);
  if (!text) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${field}: wpisz pełny adres HTTP(S).`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field}: wpisz pełny adres HTTP(S).`);
  }
  return parsed.href;
}

function uniqueIds(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field}: oczekiwano listy plików.`);
  const ids = value.map((entry) => bounded(entry, 200, field, true)!);
  if (ids.length > 30) throw new Error(`${field}: maksymalnie 30 plików.`);
  return [...new Set(ids)];
}

function objectFor(
  state: LegacyStorageState,
  objectId: unknown,
): LegacyStoredObject {
  const id = clean(objectId);
  const object = state.objects.find((entry) => entry.id === id);
  if (!object) throw new Error("Wybierz istniejący obiekt.");
  if (object.type !== "project" && object.type !== "recruitment") {
    throw new Error("Wymagania dokumentowe są dostępne dla projektu i naboru.");
  }
  return object;
}

function fileFor(
  state: LegacyStorageState,
  objectId: string,
  sourceId: string | undefined,
): LegacyStoredFileSource | undefined {
  if (!sourceId) return undefined;
  return (state.fileSources ?? []).find(
    (file) => file.id === sourceId && file.objectId === objectId,
  );
}

function normalizeDraft(
  state: LegacyStorageState,
  objectId: string,
  input: Record<string, unknown>,
): DocumentRequirementDraft {
  const requirement =
    oneOf(DOCUMENT_REQUIREMENTS, input.requirement, "Wymagalność") ?? "UNKNOWN";
  const fulfillment =
    oneOf(
      DOCUMENT_FULFILLMENT_MODES,
      input.fulfillment_mode,
      "Sposób dostarczenia",
    ) ?? (requirement === "INFORMATIONAL" ? undefined : "WITHOUT_OPERATOR_TEMPLATE");
  const originalFileId = bounded(
    input.original_file_source_id,
    200,
    "Plik operatora",
  );
  const sourceFileIds = uniqueIds(input.source_file_ids, "Pliki źródłowe") ?? [];

  if (originalFileId && !fileFor(state, objectId, originalFileId)) {
    throw new Error("Wybrany plik operatora nie należy do tego obiektu.");
  }
  for (const id of sourceFileIds) {
    if (!fileFor(state, objectId, id)) {
      throw new Error("Jeden z plików źródłowych nie należy do tego obiektu.");
    }
  }

  if (
    requirement !== "INFORMATIONAL" &&
    fulfillment === "OPERATOR_TEMPLATE" &&
    !originalFileId
  ) {
    throw new Error("Dla wzoru operatora wybierz plik operatora.");
  }
  if (
    fulfillment === "WITHOUT_OPERATOR_TEMPLATE" &&
    originalFileId
  ) {
    throw new Error(
      "Dokument bez wzoru operatora nie może wskazywać pliku jako oryginalnego wzoru.",
    );
  }

  return {
    label: bounded(input.label, 500, "Nazwa", true)!,
    purpose: bounded(input.purpose, 1000, "Przeznaczenie"),
    requirement,
    condition: bounded(input.condition, 1000, "Kiedy dokument jest wymagany"),
    fulfillment_mode: requirement === "INFORMATIONAL" ? undefined : fulfillment,
    delivery_stage:
      requirement === "INFORMATIONAL"
        ? undefined
        : oneOf(DOCUMENT_DELIVERY_STAGES, input.delivery_stage, "Etap"),
    responsibility:
      requirement === "INFORMATIONAL"
        ? undefined
        : oneOf(DOCUMENT_RESPONSIBILITIES, input.responsibility, "Odpowiedzialność"),
    required_evidence:
      requirement === "INFORMATIONAL"
        ? undefined
        : bounded(input.required_evidence, 4000, "Co należy dostarczyć"),
    original_file_source_id:
      requirement === "INFORMATIONAL" ? undefined : originalFileId,
    source_file_ids: sourceFileIds.length ? sourceFileIds : undefined,
    source_url: url(input.source_url, "Oficjalne źródło"),
    source_description: bounded(input.source_description, 1000, "Opis źródła"),
    version_label: bounded(input.version_label, 255, "Wersja dokumentu"),
    signature_requirement:
      requirement === "INFORMATIONAL"
        ? "NOT_REQUIRED"
        : oneOf(
            DOCUMENT_SIGNATURE_REQUIREMENTS,
            input.signature_requirement,
            "Podpis",
          ) ?? "UNKNOWN",
  };
}

function cloneState(state: LegacyStorageState): LegacyStorageState {
  return JSON.parse(JSON.stringify(state)) as LegacyStorageState;
}

function requirements(
  state: LegacyStorageState,
): LegacyStoredDocumentRequirement[] {
  return (state.documentRequirements ?? []) as LegacyStoredDocumentRequirement[];
}

function removeEvidenceForDocument(
  state: LegacyStorageState,
  objectId: string,
  row: LegacyStoredDocumentRequirement,
): void {
  state.fieldEvidence = (state.fieldEvidence ?? []).filter(
    (entry) =>
      !(
        entry.objectId === objectId &&
        entry.target?.kind === "document" &&
        [row.id, row.importKey, row.document_type_key]
          .filter(Boolean)
          .includes(entry.target.id)
      ),
  );
  state.importTargetEvidence = (state.importTargetEvidence ?? []).filter(
    (entry) =>
      !(
        entry.objectId === objectId &&
        entry.target.kind === "document" &&
        [row.id, row.importKey, row.document_type_key]
          .filter(Boolean)
          .includes(entry.target.id)
      ),
  );
}

export function mutateDocumentRequirement(
  original: LegacyStorageState,
  message: Record<string, unknown>,
  uuid: () => string,
  now: string,
): LegacyStorageState {
  if (message.expectedRevision !== original.revision) {
    throw new Error(
      "Data changed in another panel. Review the refreshed values and retry.",
    );
  }

  const state = cloneState(original);
  const object = objectFor(state, message.objectId);
  const rows = requirements(state);

  if (message.op === "ADD_DOCUMENT_REQUIREMENT") {
    if (!isRecord(message.document)) {
      throw new Error("Brak danych wymagania dokumentowego.");
    }
    const draft = normalizeDraft(state, object.id, message.document);
    rows.push({
      id: uuid(),
      objectId: object.id,
      importKey: `DOC_${uuid().replace(/-/g, "").slice(0, 12)}`,
      ...draft,
    });
  } else if (message.op === "CREATE_DOCUMENT_REQUIREMENT_FROM_FILE") {
    const fileId = bounded(message.sourceId, 200, "Plik", true)!;
    const file = fileFor(state, object.id, fileId);
    if (!file) throw new Error("Plik nie należy do wybranego obiektu.");
    const existing = rows.find(
      (row) =>
        row.objectId === object.id &&
        row.original_file_source_id === file.id,
    );
    if (existing) {
      throw new Error("Ten plik ma już powiązane wymaganie dokumentowe.");
    }

    const requirement =
      file.client_requirement === "Obowiązkowy"
        ? "REQUIRED"
        : file.client_requirement === "Warunkowy"
          ? "CONDITIONAL"
          : file.client_requirement === "Informacyjny"
            ? "INFORMATIONAL"
            : "UNKNOWN";
    const signature =
      file.signature_requirement === "Wymagany podpisany plik"
        ? "REQUIRED_FILE"
        : file.signature_requirement === "Dowód w systemie operatora"
          ? "EXTERNAL_OPERATOR"
          : file.signature_requirement === "Nie jest wymagany"
            ? "NOT_REQUIRED"
            : "UNKNOWN";

    rows.push({
      id: uuid(),
      objectId: object.id,
      importKey: `DOC_${uuid().replace(/-/g, "").slice(0, 12)}`,
      label: clean(file.display_name) || file.name,
      purpose: clean(file.intended_use) || undefined,
      requirement,
      ...(requirement === "INFORMATIONAL"
        ? {}
        : {
            fulfillment_mode: "OPERATOR_TEMPLATE",
            original_file_source_id: file.id,
          }),
      source_file_ids: [file.id],
      source_url: file.sourcePageUrl || file.url,
      signature_requirement:
        requirement === "INFORMATIONAL" ? "NOT_REQUIRED" : signature,
    });
  } else if (message.op === "UPDATE_DOCUMENT_REQUIREMENT") {
    const id = bounded(message.requirementId, 200, "Wymaganie", true)!;
    const row = rows.find(
      (entry) => entry.id === id && entry.objectId === object.id,
    );
    if (!row) throw new Error("Wymaganie dokumentowe nie istnieje.");
    if (!isRecord(message.document)) {
      throw new Error("Brak danych wymagania dokumentowego.");
    }
    const draft = normalizeDraft(state, object.id, message.document);
    Object.assign(row, draft);
    for (const field of [
      "purpose",
      "condition",
      "fulfillment_mode",
      "delivery_stage",
      "responsibility",
      "required_evidence",
      "original_file_source_id",
      "source_file_ids",
      "source_url",
      "source_description",
      "version_label",
      "signature_requirement",
    ] as const) {
      if (draft[field] === undefined) delete row[field];
    }
  } else if (message.op === "REMOVE_DOCUMENT_REQUIREMENT") {
    const id = bounded(message.requirementId, 200, "Wymaganie", true)!;
    const row = rows.find(
      (entry) => entry.id === id && entry.objectId === object.id,
    );
    if (!row) throw new Error("Wymaganie dokumentowe nie istnieje.");
    removeEvidenceForDocument(state, object.id, row);
    const index = rows.findIndex((entry) => entry.id === id);
    rows.splice(index, 1);
  } else {
    throw new Error("Nieznana operacja wymagania dokumentowego.");
  }

  object.updatedAt = now;
  state.documentRequirements = rows;
  state.revision++;
  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
