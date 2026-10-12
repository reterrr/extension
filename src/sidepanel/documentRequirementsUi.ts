import { readWorkspaceState } from "./workspaceData";
import {
  DOCUMENT_DELIVERY_STAGES,
  DOCUMENT_DELIVERY_STAGE_LABELS,
  DOCUMENT_FULFILLMENT_LABELS,
  DOCUMENT_FULFILLMENT_MODES,
  DOCUMENT_REQUIREMENTS,
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_RESPONSIBILITIES,
  DOCUMENT_RESPONSIBILITY_LABELS,
  DOCUMENT_SIGNATURE_LABELS,
  DOCUMENT_SIGNATURE_REQUIREMENTS,
  type LegacyStoredDocumentRequirement,
} from "../shared/documentRequirements";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";
import "./documentRequirementStyles";

let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
const expanded = new Set<string>();

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node as T;
}

function notice(text: string, error = false): void {
  const node = $("notice");
  node.textContent = text;
  node.className = error ? "error" : "";
}

function chosenObject(): LegacyStoredObject | undefined {
  const id = document.getElementById("workspace")?.dataset.activeObjectId ?? "";
  return state.objects.find((object) => object.id === id);
}

function requirementsFor(objectId: string): LegacyStoredDocumentRequirement[] {
  return ((state.documentRequirements ?? []) as LegacyStoredDocumentRequirement[])
    .filter((row) => row.objectId === objectId);
}

function filesFor(objectId: string): LegacyStoredFileSource[] {
  return (state.fileSources ?? []).filter((file) => file.objectId === objectId);
}

async function data(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op,
    expectedRevision: state.revision,
    ...payload,
  })) as { ok?: boolean; value?: LegacyStorageState; error?: string };
  if (!response?.ok || !response.value) {
    throw new Error(response?.error ?? "Storage is unavailable.");
  }
  state = response.value;
  render();
}

function optionSelect(
  values: readonly string[],
  labels: Record<string, string>,
  current: unknown,
  placeholder = "Nie ustalono",
): HTMLSelectElement {
  const select = document.createElement("select");
  select.append(new Option(placeholder, ""));
  for (const value of values) {
    select.append(new Option(labels[value] ?? value, value));
  }
  select.value = typeof current === "string" ? current : "";
  return select;
}

function field(
  label: string,
  control: HTMLElement,
  className = "",
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = `document-requirement-field ${className}`.trim();
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function textInput(value: unknown, maxLength: number, placeholder = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = typeof value === "string" ? value : "";
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.autocomplete = "off";
  return input;
}

function textarea(value: unknown, maxLength: number, placeholder = ""): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.value = typeof value === "string" ? value : "";
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  return input;
}

function linkedFileSelect(
  objectId: string,
  current: unknown,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.append(new Option("Wybierz plik operatora", ""));
  for (const file of filesFor(objectId)) {
    select.append(
      new Option(file.display_name?.trim() || file.name, file.id),
    );
  }
  select.value = typeof current === "string" ? current : "";
  return select;
}

function sourceFiles(
  objectId: string,
  row: LegacyStoredDocumentRequirement,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "document-source-files";
  const caption = document.createElement("span");
  caption.textContent = "Pliki, z których wynika wymaganie";
  root.append(caption);

  const selected = new Set(row.source_file_ids ?? []);
  for (const file of filesFor(objectId)) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = file.id;
    checkbox.checked = selected.has(file.id);
    label.append(
      checkbox,
      document.createTextNode(file.display_name?.trim() || file.name),
    );
    root.append(label);
  }
  if (!filesFor(objectId).length) {
    const empty = document.createElement("small");
    empty.textContent = "Brak plików przypiętych do tego obiektu.";
    root.append(empty);
  }
  return root;
}

function rowPayload(
  row: LegacyStoredDocumentRequirement,
  controls: {
    label: HTMLInputElement;
    purpose: HTMLTextAreaElement;
    requirement: HTMLSelectElement;
    condition: HTMLTextAreaElement;
    fulfillment: HTMLSelectElement;
    deliveryStage: HTMLSelectElement;
    responsibility: HTMLSelectElement;
    requiredEvidence: HTMLTextAreaElement;
    originalFile: HTMLSelectElement;
    sourceFiles: HTMLElement;
    sourceUrl: HTMLInputElement;
    sourceDescription: HTMLTextAreaElement;
    versionLabel: HTMLInputElement;
    signature: HTMLSelectElement;
  },
): Record<string, unknown> {
  const sourceIds = Array.from(
    controls.sourceFiles.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    ),
  ).map((input) => input.value);

  return {
    label: controls.label.value,
    purpose: controls.purpose.value,
    requirement: controls.requirement.value || "UNKNOWN",
    condition: controls.condition.value,
    fulfillment_mode: controls.fulfillment.value || undefined,
    delivery_stage: controls.deliveryStage.value || undefined,
    responsibility: controls.responsibility.value || undefined,
    required_evidence: controls.requiredEvidence.value,
    original_file_source_id: controls.originalFile.value || undefined,
    source_file_ids: sourceIds,
    source_url: controls.sourceUrl.value,
    source_description: controls.sourceDescription.value,
    version_label: controls.versionLabel.value,
    signature_requirement: controls.signature.value || "UNKNOWN",
  };
}

function renderRequirement(
  object: LegacyStoredObject,
  row: LegacyStoredDocumentRequirement,
): HTMLElement {
  const card = document.createElement("details");
  card.className = "document-requirement-card";
  card.open = expanded.has(row.id);
  card.addEventListener("toggle", () => {
    if (card.open) expanded.add(row.id);
    else expanded.delete(row.id);
  });

  const summary = document.createElement("summary");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = row.label?.trim() || "Dokument bez nazwy";
  const meta = document.createElement("small");
  const requirement = DOCUMENT_REQUIREMENT_LABELS[
    (DOCUMENT_REQUIREMENTS.includes(row.requirement as never)
      ? row.requirement
      : "UNKNOWN") as keyof typeof DOCUMENT_REQUIREMENT_LABELS
  ];
  const mode =
    row.requirement === "INFORMATIONAL"
      ? "materiał informacyjny"
      : row.fulfillment_mode
        ? DOCUMENT_FULFILLMENT_LABELS[
            row.fulfillment_mode as keyof typeof DOCUMENT_FULFILLMENT_LABELS
          ] ?? row.fulfillment_mode
        : "sposób dostarczenia nieustalony";
  meta.textContent = `${requirement} · ${mode}`;
  copy.append(title, meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.textContent = "×";
  remove.title = "Usuń wymaganie";
  remove.setAttribute("aria-label", `Usuń wymaganie ${title.textContent}`);
  remove.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void data("REMOVE_DOCUMENT_REQUIREMENT", {
      objectId: object.id,
      requirementId: row.id,
    })
      .then(() => notice("Usunięto wymaganie dokumentowe."))
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  summary.append(copy, remove);

  const body = document.createElement("div");
  body.className = "document-requirement-body";

  const name = textInput(row.label, 500, "Nazwa dokumentu");
  const purpose = textarea(row.purpose, 1000, "Do czego dokument służy");
  const requirement = optionSelect(
    DOCUMENT_REQUIREMENTS,
    DOCUMENT_REQUIREMENT_LABELS,
    row.requirement,
  );
  if (!requirement.value && row.requirement === "OPTIONAL") {
    requirement.value = "CONDITIONAL";
  }

  const condition = textarea(
    row.condition,
    1000,
    "Np. tylko gdy wniosek podpisuje pełnomocnik",
  );
  const fulfillment = optionSelect(
    DOCUMENT_FULFILLMENT_MODES,
    DOCUMENT_FULFILLMENT_LABELS,
    row.fulfillment_mode,
  );
  const deliveryStage = optionSelect(
    DOCUMENT_DELIVERY_STAGES,
    DOCUMENT_DELIVERY_STAGE_LABELS,
    row.delivery_stage,
  );
  const responsibility = optionSelect(
    DOCUMENT_RESPONSIBILITIES,
    DOCUMENT_RESPONSIBILITY_LABELS,
    row.responsibility,
  );
  const requiredEvidence = textarea(
    row.required_evidence,
    4000,
    "Opisz dokładnie, co klient ma dostarczyć",
  );
  const originalFile = linkedFileSelect(
    object.id,
    row.original_file_source_id,
  );
  const sourceFileRoot = sourceFiles(object.id, row);
  const sourceUrl = textInput(row.source_url, 2000, "https://...");
  const sourceDescription = textarea(
    row.source_description,
    1000,
    "Np. Regulamin rekrutacji, rozdział 5",
  );
  const versionLabel = textInput(row.version_label, 255, "Np. wersja 2 z 01.10.2026");
  const signature = optionSelect(
    DOCUMENT_SIGNATURE_REQUIREMENTS,
    DOCUMENT_SIGNATURE_LABELS,
    row.signature_requirement,
  );

  const top = document.createElement("div");
  top.className = "document-requirement-grid";
  top.append(
    field("Nazwa", name),
    field("Przeznaczenie", purpose),
    field("Wymagalność", requirement),
  );

  const delivery = document.createElement("div");
  delivery.className = "document-requirement-delivery";
  delivery.append(
    field("Sposób dostarczenia", fulfillment),
    field("Plik operatora", originalFile),
    field("Etap dostarczenia", deliveryStage),
    field("Odpowiedzialność", responsibility),
    field("Podpis", signature),
  );

  body.append(
    top,
    delivery,
    field("Kiedy dokument jest wymagany", condition, "wide"),
    field("Co należy dostarczyć", requiredEvidence, "wide"),
    sourceFileRoot,
    field("Oficjalne źródło", sourceUrl, "wide"),
    field("Opis źródła", sourceDescription, "wide"),
    field("Wersja dokumentu", versionLabel),
  );

  const informationalHint = document.createElement("p");
  informationalHint.className = "document-requirement-info";
  informationalHint.textContent =
    "Materiał informacyjny — klient nie dostarcza tego dokumentu.";
  body.append(informationalHint);

  const syncVisibility = () => {
    const informational = requirement.value === "INFORMATIONAL";
    informationalHint.hidden = !informational;
    delivery.hidden = informational;
    condition.closest("label")!.hidden = informational;
    requiredEvidence.closest("label")!.hidden = informational;

    const operatorTemplate =
      !informational && fulfillment.value === "OPERATOR_TEMPLATE";
    originalFile.closest("label")!.hidden = !operatorTemplate;
    if (!informational && !fulfillment.value) {
      fulfillment.value = "WITHOUT_OPERATOR_TEMPLATE";
    }
    if (informational) {
      signature.value = "NOT_REQUIRED";
    }
  };
  requirement.onchange = syncVisibility;
  fulfillment.onchange = syncVisibility;
  syncVisibility();

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary document-requirement-save";
  save.textContent = "Zapisz wymaganie";
  save.onclick = () => {
    expanded.add(row.id);
    void data("UPDATE_DOCUMENT_REQUIREMENT", {
      objectId: object.id,
      requirementId: row.id,
      document: rowPayload(row, {
        label: name,
        purpose,
        requirement,
        condition,
        fulfillment,
        deliveryStage,
        responsibility,
        requiredEvidence,
        originalFile,
        sourceFiles: sourceFileRoot,
        sourceUrl,
        sourceDescription,
        versionLabel,
        signature,
      }),
    })
      .then(() => notice(`Zapisano wymaganie: ${name.value}.`))
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  body.append(save);
  card.append(summary, body);
  return card;
}

function render(): void {
  const object = chosenObject();
  const root = $("document-requirement-list");
  const add = $("add-document-requirement") as HTMLButtonElement;
  const section = $("document-requirements-block");
  if (!object || !["project", "recruitment"].includes(object.type)) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const rows = requirementsFor(object.id);
  root.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "document-requirement-empty";
    empty.textContent =
      "Brak wymagań dokumentowych. Dodaj także dokumenty, których operator nie udostępnia jako wzoru.";
    root.append(empty);
  } else {
    for (const row of rows) root.append(renderRequirement(object, row));
  }

  add.disabled = false;
  const count = document.getElementById("document-requirement-count");
  if (count) {
    count.textContent = rows.length
      ? `${rows.length} ${rows.length === 1 ? "wymaganie" : "wymagań"}`
      : "Brak wymagań";
  }
}

export async function initDocumentRequirementsUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  state = await readWorkspaceState();

  $("add-document-requirement").onclick = () => {
    const object = chosenObject();
    if (!object) {
      notice("Wybierz projekt lub nabór.", true);
      return;
    }
    void data("ADD_DOCUMENT_REQUIREMENT", {
      objectId: object.id,
      document: {
        label: "Nowy dokument",
        requirement: "UNKNOWN",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        signature_requirement: "UNKNOWN",
      },
    })
      .then(() => {
        const latest = requirementsFor(object.id).at(-1);
        if (latest) expanded.add(latest.id);
        notice("Dodano wymaganie dokumentowe bez wzoru operatora.");
        render();
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };

  window.addEventListener("burbot:workspace-state-changed", (event) => {
    const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail?.state;
    if (next) state = next;
    render();
  });
  window.addEventListener("burbot:workspace-rendered", render);
  render();
}

export async function createRequirementFromFile(
  objectId: string,
  sourceId: string,
): Promise<void> {
  await data("CREATE_DOCUMENT_REQUIREMENT_FROM_FILE", {
    objectId,
    sourceId,
  });
  const latest = requirementsFor(objectId).at(-1);
  if (latest) expanded.add(latest.id);
  notice("Utworzono wymaganie dokumentowe na podstawie pliku operatora.");
  render();
}
