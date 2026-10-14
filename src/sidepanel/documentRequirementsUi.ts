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

function text(value: unknown): string {
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

function linkedFileForRequirement(
  row: LegacyStoredDocumentRequirement,
  state: LegacyStorageState,
  objectId: string,
): LegacyStoredFileSource | undefined {
  const files = (state.fileSources ?? []).filter(
    (source) => source.objectId === objectId,
  );
  if (row.original_file_source_id) {
    const original = files.find(
      (source) => source.id === row.original_file_source_id,
    );
    if (original) return original;
  }

  const label = documentLabel(row).trim().toLocaleLowerCase("pl-PL");
  return files.find(
    (source) =>
      (row.source_file_source_ids ?? []).includes(source.id) &&
      fileLabel(source).trim().toLocaleLowerCase("pl-PL") === label,
  );
}

function renderRequirement(
  row: LegacyStoredDocumentRequirement,
  options: RenderOptions,
): { node: HTMLElement; linkedFileId?: string } {
  const normalized = normalizeDocumentRequirement(
    row as unknown as Record<string, unknown>,
  ) as unknown as LegacyStoredDocumentRequirement;
  const files = (options.state.fileSources ?? []).filter(
    (source) => source.objectId === options.object.id,
  );
  const linkedFile = linkedFileForRequirement(
    normalized,
    options.state,
    options.object.id,
  );

  const card = document.createElement("details");
  card.className = "document-requirement-row file-source-row";
  card.dataset.sortLabel = documentLabel(normalized).toLocaleLowerCase("pl-PL");
  card.open = row.label === "Nowy dokument";

  const summary = document.createElement("summary");
  summary.className = "file-source-summary";
  const summaryCopy = document.createElement("span");
  summaryCopy.className = "document-requirement-summary-copy file-source-summary-copy";
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
  const physicalMeta = linkedFile
    ? ` · ${linkedFile.fileType} · ${linkedFile.name}`
    : "";
  meta.textContent = `${requirementLabel} · ${fulfillmentLabel}${physicalMeta}`;
  summaryCopy.append(title, meta);

  if (row.copiedFromProjectId) {
    const inherited = document.createElement("span");
    inherited.className = "file-source-inherited-badge";
    inherited.textContent = "kopia z projektu";
    summaryCopy.append(inherited);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "document-requirement-remove icon-button danger";
  remove.textContent = "×";
  remove.title = linkedFile
    ? "Usuń wymaganie; plik operatora pozostanie"
    : "Usuń dokument";
  remove.setAttribute(
    "aria-label",
    `Usuń dokument ${documentLabel(normalized)}`,
  );
  remove.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void options
      .mutate("REMOVE_DOCUMENT_REQUIREMENT", {
        objectId: options.object.id,
        documentId: row.id,
      })
      .then(() => {
        options.notice(`Usunięto dokument: ${documentLabel(normalized)}.`);
        options.onChanged();
      })
      .catch((error: unknown) =>
        options.notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  summary.append(summaryCopy, remove);

  const body = document.createElement("div");
  body.className = "document-requirement-body file-source-body";

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
  const originalFileLabel = fieldLabel("Plik / wzór operatora", originalFile);

  const thirdRow = document.createElement("div");
  thirdRow.className = "document-requirement-field-row";
  thirdRow.append(fulfillmentLabelNode, originalFileLabel);

  const fourthRow = document.createElement("div");
  fourthRow.className = "document-requirement-field-row";
  fourthRow.append(
    fieldLabel("Etap dostarczenia", deliveryStage),
    fieldLabel("Odpowiedzialność", responsibility),
  );

  body.append(
    firstRow,
    secondRow,
    thirdRow,
    fieldLabel("Kiedy dokument jest wymagany", conditionInput),
    fourthRow,
    fieldLabel("Co należy dostarczyć", requiredEvidence),
    fieldLabel("Oficjalne źródło", sourceUrl),
    fieldLabel("Opis źródła", sourceDescription),
  );

  if (linkedFile) {
    const physical = document.createElement("div");
    physical.className = "document-linked-file";
    const copy = document.createElement("span");
    copy.textContent = `Plik: ${linkedFile.name} · ${linkedFile.fileType}`;
    const open = document.createElement("a");
    open.href = linkedFile.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Otwórz plik ↗";
    physical.append(copy, open);
    body.append(physical);
  }

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
  save.textContent = "Zapisz dokument";
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
        options.notice(`Zapisano dokument: ${labelInput.value || "Dokument"}.`);
        options.onChanged();
      })
      .catch((error: unknown) =>
        options.notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  body.append(save);

  card.append(summary, body);
  return { node: card, linkedFileId: linkedFile?.id };
}

export function hasRequirementForFile(
  state: LegacyStorageState,
  objectId: string,
  fileSourceId: string,
): boolean {
  return (state.documentRequirements ?? []).some(
    (row) =>
      row.objectId === objectId &&
      linkedFileForRequirement(row, state, objectId)?.id === fileSourceId,
  );
}

/**
 * Appends document cards to the shared document list and returns physical files
 * represented by those cards, so the caller does not render the same document
 * for a second time as a raw attachment.
 */
export function renderDocumentRequirementsUi(options: RenderOptions): Set<string> {
  const rows = (options.state.documentRequirements ?? []).filter(
    (row) => row.objectId === options.object.id,
  );
  const representedFileIds = new Set<string>();

  for (const row of rows) {
    const rendered = renderRequirement(row, options);
    options.root.append(rendered.node);
    if (rendered.linkedFileId) representedFileIds.add(rendered.linkedFileId);
  }
  return representedFileIds;
}
