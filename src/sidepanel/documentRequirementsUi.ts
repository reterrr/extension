import {
  DOCUMENT_FULFILLMENT_MODES,
  DOCUMENT_FULFILLMENT_MODE_LABELS,
  DOCUMENT_REQUIREMENTS,
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_RESPONSIBILITIES,
  DOCUMENT_RESPONSIBILITY_LABELS,
  DOCUMENT_SIGNATURE_REQUIREMENTS,
  DOCUMENT_SIGNATURE_LABELS,
  normalizeDocumentRequirement,
} from "../shared/documentRequirements";
import type {
  LegacyStorageState,
  LegacyStoredDocumentRequirement,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

type Mutate = (
  op: string,
  payload?: Record<string, unknown>,
) => Promise<LegacyStorageState>;

interface RenderOptions {
  root: HTMLElement;
  state: LegacyStorageState;
  object: LegacyStoredObject;
  mutate: Mutate;
  notice: (message: string, error?: boolean) => void;
  onChanged: () => void;
}

function text(
  value: unknown,
): string {
  return typeof value === "string" ? value : "";
}

function fieldLabel(caption: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "document-requirement-field";
  const span = document.createElement("span");
  span.textContent = caption;
  label.append(span, control);
  return label;
}

function input(value = "", maxLength?: number): HTMLInputElement {
  const control = document.createElement("input");
  control.type = "text";
  control.value = value;
  control.autocomplete = "off";
  if (maxLength) control.maxLength = maxLength;
  return control;
}

function textarea(value = "", maxLength?: number): HTMLTextAreaElement {
  const control = document.createElement("textarea");
  control.value = value;
  if (maxLength) control.maxLength = maxLength;
  return control;
}

function select(
  values: readonly string[],
  labels: Record<string, string>,
  current: string,
  allowUnset = false,
): HTMLSelectElement {
  const control = document.createElement("select");
  if (allowUnset) control.append(new Option("Nie ustalono", ""));
  for (const value of values) {
    control.append(new Option(labels[value] ?? value, value));
  }
  if (current && !values.includes(current)) {
    control.append(new Option(`Dotychczas: ${current}`, current));
  }
  control.value = current;
  return control;
}

function fileLabel(source: LegacyStoredFileSource): string {
  return source.display_name?.trim() || source.name;
}

function documentLabel(row: LegacyStoredDocumentRequirement): string {
  return row.label?.trim() || row.document_type_key || "Dokument";
}

function physicalFileOptions(
  selectNode: HTMLSelectElement,
  files: LegacyStoredFileSource[],
  current?: string,
): void {
  selectNode.replaceChildren(new Option("Nie wybrano", ""));
  for (const source of files) {
    selectNode.append(new Option(fileLabel(source), source.id));
  }
  selectNode.value = current ?? "";
}

function renderRequirement(
  row: LegacyStoredDocumentRequirement,
  options: RenderOptions,
): HTMLElement {
  const normalized = normalizeDocumentRequirement(
    row as unknown as Record<string, unknown>,
  ) as unknown as LegacyStoredDocumentRequirement;
  const files = (options.state.fileSources ?? []).filter(
    (source) => source.objectId === options.object.id,
  );

  const card = document.createElement("details");
  card.className = "document-requirement-row";
  card.open = row.label === "Nowy dokument";

  const summary = document.createElement("summary");
  const summaryCopy = document.createElement("span");
  summaryCopy.className = "document-requirement-summary-copy";
  const title = document.createElement("strong");
  title.textContent = documentLabel(normalized);
  const meta = document.createElement("small");
  const requirementLabel =
    DOCUMENT_REQUIREMENT_LABELS[
      normalized.requirement as keyof typeof DOCUMENT_REQUIREMENT_LABELS
    ] ?? normalized.requirement;
  const fulfillmentLabel =
    normalized.requirement === "INFORMATIONAL"
      ? "Materiał informacyjny"
      : DOCUMENT_FULFILLMENT_MODE_LABELS[
          normalized.fulfillment_mode as keyof typeof DOCUMENT_FULFILLMENT_MODE_LABELS
        ] ?? normalized.fulfillment_mode;
  meta.textContent = `${requirementLabel} · ${fulfillmentLabel}`;
  summaryCopy.append(title, meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "document-requirement-remove icon-button danger";
  remove.textContent = "×";
  remove.title = "Usuń wymaganie dokumentowe";
  remove.setAttribute("aria-label", `Usuń wymaganie ${documentLabel(normalized)}`);
  remove.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void options
      .mutate("REMOVE_DOCUMENT_REQUIREMENT", {
        objectId: options.object.id,
        documentId: row.id,
      })
      .then(() => {
        options.notice(`Usunięto wymaganie: ${documentLabel(normalized)}.`);
        options.onChanged();
      })
      .catch((error: unknown) =>
        options.notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  summary.append(summaryCopy, remove);

  const body = document.createElement("div");
  body.className = "document-requirement-body";

  const labelInput = input(text(normalized.label), 500);
  const purposeInput = textarea(text(normalized.purpose), 1000);
  const requirement = select(
    DOCUMENT_REQUIREMENTS,
    DOCUMENT_REQUIREMENT_LABELS,
    text(normalized.requirement) || "UNKNOWN",
  );
  const conditionInput = textarea(text(normalized.condition), 1000);
  const fulfillment = select(
    DOCUMENT_FULFILLMENT_MODES,
    DOCUMENT_FULFILLMENT_MODE_LABELS,
    text(normalized.fulfillment_mode) || "WITHOUT_OPERATOR_TEMPLATE",
  );
  const deliveryStage = input(text(normalized.delivery_stage), 60);
  const responsibility = select(
    DOCUMENT_RESPONSIBILITIES,
    DOCUMENT_RESPONSIBILITY_LABELS,
    text(normalized.responsibility) || "CLIENT",
    true,
  );
  const requiredEvidence = textarea(text(normalized.required_evidence), 4000);
  const signature = select(
    DOCUMENT_SIGNATURE_REQUIREMENTS,
    DOCUMENT_SIGNATURE_LABELS,
    text(normalized.signature_requirement) || "UNKNOWN",
  );
  const sourceUrl = input(text(normalized.source_url), 2000);
  sourceUrl.type = "url";
  sourceUrl.placeholder = "https://…";
  const sourceDescription = textarea(text(normalized.source_description), 1000);

  const originalFile = document.createElement("select");
  physicalFileOptions(originalFile, files, normalized.original_file_source_id);

  const firstRow = document.createElement("div");
  firstRow.className = "document-requirement-field-row";
  firstRow.append(
    fieldLabel("Nazwa", labelInput),
    fieldLabel("Przeznaczenie", purposeInput),
  );

  const secondRow = document.createElement("div");
  secondRow.className = "document-requirement-field-row";
  secondRow.append(
    fieldLabel("Wymagalność", requirement),
    fieldLabel("Podpis", signature),
  );

  const fulfillmentLabelNode = fieldLabel(
    "Źródło / sposób przygotowania",
    fulfillment,
  );
  const originalFileLabel = fieldLabel("Wzór operatora", originalFile);

  const thirdRow = document.createElement("div");
  thirdRow.className = "document-requirement-field-row";
  thirdRow.append(fulfillmentLabelNode, originalFileLabel);

  const fourthRow = document.createElement("div");
  fourthRow.className = "document-requirement-field-row";
  fourthRow.append(
    fieldLabel("Etap dostarczenia", deliveryStage),
    fieldLabel("Odpowiedzialność", responsibility),
  );

  const sourceRow = document.createElement("div");
  sourceRow.className = "document-requirement-field-row";
  sourceRow.append(fieldLabel("Oficjalne źródło", sourceUrl));

  body.append(
    firstRow,
    secondRow,
    thirdRow,
    fieldLabel("Kiedy dokument jest wymagany", conditionInput),
    fourthRow,
    fieldLabel("Co należy dostarczyć", requiredEvidence),
    sourceRow,
    fieldLabel("Opis źródła", sourceDescription),
  );

  const informational = () => requirement.value === "INFORMATIONAL";
  const refreshMode = () => {
    const isInfo = informational();
    fulfillmentLabelNode.hidden = isInfo;
    originalFileLabel.hidden =
      isInfo || fulfillment.value !== "OPERATOR_TEMPLATE";
    conditionInput.closest("label")!.hidden = requirement.value !== "CONDITIONAL";
  };
  requirement.onchange = refreshMode;
  fulfillment.onchange = refreshMode;
  refreshMode();

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary document-requirement-save";
  save.textContent = "Zapisz wymaganie";
  save.onclick = () => {
    const values: Record<string, unknown> = {
      label: labelInput.value,
      purpose: purposeInput.value,
      requirement: requirement.value,
      condition:
        requirement.value === "CONDITIONAL" ? conditionInput.value : undefined,
      fulfillment_mode: informational()
        ? "WITHOUT_OPERATOR_TEMPLATE"
        : fulfillment.value,
      delivery_stage: deliveryStage.value,
      responsibility: responsibility.value || undefined,
      required_evidence: requiredEvidence.value,
      original_file_source_id:
        !informational() && fulfillment.value === "OPERATOR_TEMPLATE"
          ? originalFile.value || undefined
          : undefined,
      source_url: sourceUrl.value,
      source_description: sourceDescription.value,
      signature_requirement: signature.value,
    };
    void options
      .mutate("UPDATE_DOCUMENT_REQUIREMENT", {
        objectId: options.object.id,
        documentId: row.id,
        values,
      })
      .then(() => {
        options.notice(`Zapisano wymaganie: ${labelInput.value || "Dokument"}.`);
        options.onChanged();
      })
      .catch((error: unknown) =>
        options.notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  body.append(save);

  card.append(summary, body);
  return card;
}

export function hasRequirementForFile(
  state: LegacyStorageState,
  objectId: string,
  fileSourceId: string,
): boolean {
  const source = (state.fileSources ?? []).find(
    (entry) => entry.id === fileSourceId && entry.objectId === objectId,
  );
  const sourceLabel = source
    ? (source.display_name?.trim() || source.name).trim()
    : "";

  return (state.documentRequirements ?? []).some((row) => {
    if (row.objectId !== objectId) return false;
    if (row.original_file_source_id === fileSourceId) return true;
    if (!(row.source_file_source_ids ?? []).includes(fileSourceId)) return false;
    return Boolean(
      sourceLabel &&
        row.label?.trim() &&
        row.label.trim().toLocaleLowerCase("pl-PL") ===
          sourceLabel.toLocaleLowerCase("pl-PL"),
    );
  });
}

export function renderDocumentRequirementsUi(options: RenderOptions): void {
  const rows = (options.state.documentRequirements ?? []).filter(
    (row) => row.objectId === options.object.id,
  );
  options.root.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "document-requirement-empty";
    empty.textContent =
      "Brak wymagań dokumentowych. Dodaj dokument bez wzoru albo utwórz wymaganie z pliku operatora.";
    options.root.append(empty);
    return;
  }

  for (const row of rows) {
    options.root.append(renderRequirement(row, options));
  }
}
