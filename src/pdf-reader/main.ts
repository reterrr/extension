import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import {
  createPdfTextCandidate,
  normalizePdfPageText,
  resolvePdfTextSelector,
} from "../shared/pdf/textSelector";
import { createCapturedExtractionInput } from "../shared/extraction/rules";
import type { PdfTextExtractionCandidate } from "../shared/types/picker";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

GlobalWorkerOptions.workerSrc = browser.runtime.getURL("pdf.worker.mjs");

type FieldDefinition = {
  label: string;
  type: string;
  options?: Record<string, string>;
  references?: string;
  numeric?: boolean;
  legacy?: boolean;
  multiline?: boolean;
  min?: number;
  max?: number;
};

type TextItemLike = {
  str?: string;
  hasEOL?: boolean;
};

const params = new URLSearchParams(location.search);
const objectId = params.get("objectId") ?? "";
const sourceId = params.get("sourceId") ?? "";

let state = BurbotCore.empty() as LegacyStorageState;
let object: LegacyStoredObject;
let source: LegacyStoredFileSource;
let selectedField = "";
let candidate: PdfTextExtractionCandidate | null = null;
let draft: unknown = "";
const pageTexts = new Map<number, string>();

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function notice(text: string, error = false): void {
  const target = $("notice");
  target.textContent = text;
  target.className = error ? "error" : "";
}

async function data(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<LegacyStorageState> {
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
  return state;
}

function fieldDefinitions(): Array<[string, FieldDefinition]> {
  const fields = (BurbotSchema[object.type]?.fields ?? {}) as Record<
    string,
    FieldDefinition
  >;
  return Object.entries(fields).filter(([key, definition]) => {
    if (!definition.legacy) return true;
    return (
      BurbotCore.hasValue(object.values[key]) ||
      state.rules.some((rule) => rule.objectId === object.id && rule.field === key)
    );
  });
}

function fieldDefinition(): FieldDefinition {
  const definition = (BurbotSchema[object.type]?.fields as Record<
    string,
    FieldDefinition
  >)?.[selectedField];
  if (!definition) throw new Error("Choose a target field.");
  return definition;
}

function displayObject(entry: LegacyStoredObject): string {
  return BurbotCore.displayName(entry);
}

function currentRule() {
  return state.rules.find(
    (rule) =>
      rule.objectId === object.id &&
      rule.field === selectedField &&
      rule.extraction.type === "pdfText" &&
      rule.extraction.sourceId === source.id,
  );
}

function renderFieldSelector(): void {
  const select = $("field") as HTMLSelectElement;
  const fields = fieldDefinitions();
  select.replaceChildren(
    ...fields.map(
      ([key, definition]) =>
        new Option(definition.label ?? key, key),
    ),
  );

  if (!selectedField || !fields.some(([key]) => key === selectedField)) {
    selectedField = fields[0]?.[0] ?? "";
  }
  select.value = selectedField;
  select.onchange = () => {
    selectedField = select.value;
    candidate = null;
    draft = object.values[selectedField] ?? "";
    renderEditor();
  };
}

function renderValueControl(): void {
  const root = $("value-control");
  root.replaceChildren();
  if (!selectedField) return;

  const definition = fieldDefinition();
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  if (definition.type === "enum") {
    input = document.createElement("select");
    input.append(new Option("Choose…", ""));
    for (const [value, label] of Object.entries(definition.options ?? {})) {
      input.append(new Option(label, value));
    }
    input.value = String(draft ?? "");
  } else if (definition.type === "reference") {
    input = document.createElement("select");
    input.append(new Option("Choose…", ""));
    for (const entry of state.objects.filter(
      (item) => item.type === definition.references,
    )) {
      input.append(new Option(displayObject(entry), entry.id));
    }
    input.value = String(draft ?? "");
  } else if (definition.type === "boolean") {
    input = document.createElement("select");
    input.append(new Option("Choose…", ""));
    input.append(new Option("Tak", "true"));
    input.append(new Option("Nie", "false"));
    input.value =
      draft === true ? "true" : draft === false ? "false" : String(draft ?? "");
  } else {
    input = document.createElement(definition.multiline ? "textarea" : "input");
    if (input instanceof HTMLInputElement) {
      input.type =
        definition.type === "date"
          ? "date"
          : definition.type === "url"
            ? "url"
            : definition.type === "integer"
              ? "number"
              : "text";
      if (definition.type === "integer") {
        input.step = "1";
        if (definition.min !== undefined) input.min = String(definition.min);
        if (definition.max !== undefined) input.max = String(definition.max);
      }
    }
    input.value = String(draft ?? "");
  }

  input.id = "field-value";
  input.oninput = () => {
    if (definition.type === "boolean") {
      const value = (input as HTMLSelectElement).value;
      draft = value === "true" ? true : value === "false" ? false : "";
    } else {
      draft = input.value;
    }
    validateDraft();
  };
  root.append(input);
}

function validateDraft(): void {
  const save = $("save") as HTMLButtonElement;
  if (!candidate || !selectedField) {
    save.disabled = true;
    $("converted").textContent = "Zaznacz tekst w PDF-ie.";
    return;
  }

  try {
    const value = BurbotCore.coerceField(draft, fieldDefinition(), state);
    $("converted").textContent = `Zapisz jako: ${BurbotCore.formatValue(
      value,
      fieldDefinition(),
      state,
    )}`;
    save.disabled = false;
  } catch (error) {
    $("converted").textContent =
      error instanceof Error ? error.message : String(error);
    save.disabled = true;
  }
}

function renderRuleDetails(): void {
  const details = $("selector-details") as HTMLDetailsElement;
  const pre = $("selector-json");
  const rule = currentRule();
  const value = candidate?.options[0]?.extraction ?? rule?.extraction;
  details.hidden = !value;
  pre.textContent = value ? JSON.stringify(value, null, 2) : "";

  const status = $("selector-status");
  if (!rule || rule.extraction.type !== "pdfText") {
    status.textContent = "";
    return;
  }

  const pageText = pageTexts.get(rule.extraction.selector.pageNumber);
  if (!pageText) {
    status.textContent = "Selector zapisany — strona jeszcze się ładuje.";
    return;
  }

  try {
    resolvePdfTextSelector(pageText, rule.extraction.selector);
    status.textContent = `Selector aktywny · strona ${rule.extraction.selector.pageNumber}`;
    status.className = "selector-ok";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.className = "selector-error";
  }
}

function renderEditor(): void {
  renderFieldSelector();
  renderValueControl();
  const raw = candidate?.options[0]?.raw ?? "";
  $("selected-text").textContent = raw || "Nic nie zaznaczono.";
  renderRuleDetails();
  validateDraft();
}

function selectionPageElement(node: Node | null): HTMLElement | null {
  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>(".pdf-page-text") ?? null;
}

function captureSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const startPage = selectionPageElement(range.startContainer);
  const endPage = selectionPageElement(range.endContainer);
  if (!startPage || !endPage) return;

  if (startPage !== endPage) {
    candidate = null;
    notice("Zaznaczenie PDF musi mieścić się na jednej stronie.", true);
    renderEditor();
    return;
  }

  try {
    const pageNumber = Number(startPage.dataset.pageNumber);
    const pageText = startPage.textContent ?? "";
    const before = document.createRange();
    before.selectNodeContents(startPage);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;

    candidate = createPdfTextCandidate(
      source.id,
      source.url,
      pageNumber,
      pageText,
      start,
      end,
    );

    try {
      draft = BurbotCore.coerceField(
        candidate.options[0].raw,
        fieldDefinition(),
        state,
      );
    } catch {
      const definition = fieldDefinition();
      draft = ["enum", "reference", "boolean", "date"].includes(definition.type)
        ? object.values[selectedField] ?? ""
        : candidate.options[0].raw;
    }

    notice(`Zaznaczono wartość na stronie ${pageNumber}.`);
    renderEditor();
  } catch (error) {
    candidate = null;
    notice(error instanceof Error ? error.message : String(error), true);
    renderEditor();
  }
}

function canonicalTextFromItems(items: unknown[]): string {
  let text = "";
  for (const raw of items) {
    const item = raw as TextItemLike;
    if (typeof item.str !== "string" || !item.str) continue;

    if (
      text &&
      !text.endsWith("\n") &&
      !text.endsWith(" ") &&
      !/^[,.;:!?%)\]}]/.test(item.str)
    ) {
      text += " ";
    }
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return normalizePdfPageText(text);
}

async function renderPdf(): Promise<void> {
  $("loading").hidden = false;
  const response = await fetch(source.url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`PDF request failed: HTTP ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const task = getDocument({ data: bytes });
  const pdf = await task.promise;
  $("page-count").textContent = `${pdf.numPages} stron`;

  const root = $("pages");
  root.replaceChildren();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = canonicalTextFromItems(content.items as unknown[]);
    pageTexts.set(pageNumber, text);

    const article = document.createElement("article");
    article.className = "pdf-page";
    const heading = document.createElement("div");
    heading.className = "pdf-page-heading";
    heading.textContent = `Strona ${pageNumber}`;
    const body = document.createElement("div");
    body.className = "pdf-page-text";
    body.dataset.pageNumber = String(pageNumber);
    body.textContent = text || "[Brak warstwy tekstowej na tej stronie]";
    article.append(heading, body);
    root.append(article);
    page.cleanup();
  }

  $("loading").hidden = true;
  renderRuleDetails();
}

async function saveRule(): Promise<void> {
  if (!candidate) throw new Error("Zaznacz tekst w PDF-ie.");
  if (!selectedField) throw new Error("Wybierz pole docelowe.");

  const option = candidate.options[0];
  const captured = createCapturedExtractionInput(candidate, option);
  await data("ASSIGN_PDF", {
    objectId: object.id,
    field: selectedField,
    value: draft,
    candidate: captured,
  });

  object = state.objects.find((entry) => entry.id === object.id) ?? object;
  candidate = null;
  draft = object.values[selectedField] ?? "";
  window.getSelection()?.removeAllRanges();
  notice("Wartość i selector PDF zostały zapisane.");
  renderEditor();
}

async function initialize(): Promise<void> {
  if (!objectId || !sourceId) {
    throw new Error("Missing objectId/sourceId in PDF reader URL.");
  }

  state = await data("GET");
  const foundObject = state.objects.find((entry) => entry.id === objectId);
  const foundSource = state.fileSources?.find(
    (entry) => entry.id === sourceId && entry.objectId === objectId,
  );
  if (!foundObject || !foundSource) {
    throw new Error("PDF source or Burbot object no longer exists.");
  }
  object = foundObject;
  source = foundSource;

  document.title = `${source.name} · Burbot PDF Reader`;
  $("object-name").textContent = displayObject(object);
  $("source-name").textContent = source.name;
  const sourceLink = $("source-url") as HTMLAnchorElement;
  sourceLink.href = source.url;
  sourceLink.textContent = source.url;

  selectedField = fieldDefinitions()[0]?.[0] ?? "";
  draft = selectedField ? object.values[selectedField] ?? "" : "";
  renderEditor();

  $("save").addEventListener("click", () => {
    void saveRule().catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
  });
  $("pages").addEventListener("mouseup", captureSelection);
  $("pages").addEventListener("keyup", captureSelection);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes["burbot:v1"]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    object = state.objects.find((entry) => entry.id === objectId) ?? object;
    renderEditor();
  });

  await renderPdf();
}

void initialize().catch((error: unknown) => {
  $("loading").hidden = true;
  notice(error instanceof Error ? error.message : String(error), true);
  $("pages").textContent =
    "Nie udało się otworzyć PDF-a. Sprawdź dostęp do źródła i spróbuj ponownie.";
});
