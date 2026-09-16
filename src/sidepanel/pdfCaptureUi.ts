import { createCapturedExtractionInput } from "../shared/extraction/rules";
import type { PdfTextExtractionCandidate } from "../shared/types/picker";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let windowId: number | undefined;
let pending:
  | {
      objectId: string;
      field: string;
      target?: { kind: string; id: string };
      candidate: PdfTextExtractionCandidate;
    }
  | undefined;
let originalSaveHandler: HTMLButtonElement["onclick"] = null;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function notice(text: string, error = false): void {
  const element = $("notice");
  element.textContent = text;
  element.className = error ? "error" : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function parseTarget(value: string | undefined): { kind: string; id: string } | undefined {
  if (!value || value === "object") return undefined;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    kind: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

function activeDescriptor():
  | { field: string; target?: { kind: string; id: string }; button: HTMLButtonElement }
  | undefined {
  const button = document.querySelector<HTMLButtonElement>(".field-row.selected");
  const field = button?.dataset.field;
  if (!button || !field) return undefined;
  return { field, target: parseTarget(button.dataset.target), button };
}

function sameTarget(
  left: { kind: string; id: string } | undefined,
  right: { kind: string; id: string } | undefined,
): boolean {
  return (left?.kind ?? "object") === (right?.kind ?? "object") &&
    (left?.id ?? "") === (right?.id ?? "");
}

function readEditorValue(): unknown {
  const input = document.getElementById("edit-value") as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!input) return "";
  if (input instanceof HTMLInputElement && input.type === "checkbox") {
    return input.checked;
  }
  return input.value;
}

function setEditorValue(value: unknown): void {
  const input = document.getElementById("edit-value") as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!input) return;

  if (input instanceof HTMLInputElement && input.type === "checkbox") {
    input.checked = Boolean(value);
    input.indeterminate = false;
  } else {
    input.value = String(value ?? "");
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function objectFor(id: string): LegacyStoredObject | undefined {
  return state.objects.find((entry) => entry.id === id);
}

function currentObjectLooksLike(object: LegacyStoredObject): boolean {
  const visible = $("object-title").textContent?.trim() ?? "";
  return visible === BurbotCore.displayName(object);
}

function validatePending(): void {
  if (!pending) return;
  const object = objectFor(pending.objectId);
  const save = $("save") as HTMLButtonElement;
  if (!object) {
    save.disabled = true;
    return;
  }

  try {
    const info = BurbotCore.fieldContext(
      state,
      object,
      pending.field,
      pending.target,
    );
    const value = BurbotCore.coerceField(readEditorValue(), info.definition, state);
    $("converted").textContent = `PDF → ${BurbotCore.formatValue(
      value,
      info.definition,
      state,
    )}`;
    save.disabled = false;
  } catch (error) {
    $("converted").textContent =
      error instanceof Error ? error.message : String(error);
    save.disabled = true;
  }
}

function clearPending(): void {
  if (!pending) return;
  pending = undefined;
  const save = $("save") as HTMLButtonElement;
  save.onclick = originalSaveHandler;
  save.textContent = "Save value & next";
  const method = $("method") as HTMLSelectElement;
  method.disabled = false;
}

async function savePendingPdf(): Promise<void> {
  if (!pending) return;
  const snapshot = pending;
  await data("GET");

  const active = activeDescriptor();
  if (
    !active ||
    active.field !== snapshot.field ||
    !sameTarget(active.target, snapshot.target)
  ) {
    clearPending();
    throw new Error("Pole w sidebarze zmieniło się. Zaznacz tekst w PDF ponownie.");
  }

  const object = objectFor(snapshot.objectId);
  if (!object || !currentObjectLooksLike(object)) {
    clearPending();
    throw new Error("Wybierz w sidebarze obiekt, do którego należy ten PDF.");
  }

  const option = snapshot.candidate.options[0];
  const candidate = createCapturedExtractionInput(snapshot.candidate, option);
  const value = readEditorValue();

  await data("ASSIGN_PDF", {
    objectId: snapshot.objectId,
    field: snapshot.field,
    target: snapshot.target,
    value,
    candidate,
  });

  const button = active.button;
  clearPending();
  notice(`Zapisano wartość i selector PDF ze strony ${option.extraction.selector.pageNumber}.`);
  button.click();
}

function presentPdfCapture(
  object: LegacyStoredObject,
  field: string,
  target: { kind: string; id: string } | undefined,
  candidate: PdfTextExtractionCandidate,
): void {
  const info = BurbotCore.fieldContext(state, object, field, target);
  const option = candidate.options[0];

  pending = { objectId: object.id, field, target, candidate };

  const source = $("capture-source");
  source.hidden = false;
  const method = $("method") as HTMLSelectElement;
  method.replaceChildren(
    new Option(`PDF selected text · strona ${option.extraction.selector.pageNumber}`, "0"),
  );
  method.value = "0";
  method.disabled = true;
  $("sample").textContent = option.raw;
  $("rule-details").hidden = false;
  $("rule").textContent = JSON.stringify(
    {
      pageUrl: candidate.pageUrl,
      selector: null,
      extraction: option.extraction,
    },
    null,
    2,
  );

  try {
    const normalized = BurbotCore.coerceField(option.raw, info.definition, state);
    setEditorValue(normalized);
  } catch {
    if (!BurbotCore.hasValue(info.values[field])) {
      $("converted").textContent =
        "Tekst PDF został przechwycony. Wybierz/uzupełnij wartość kanoniczną, potem zapisz selector.";
    }
  }

  const save = $("save") as HTMLButtonElement;
  if (!originalSaveHandler) originalSaveHandler = save.onclick;
  save.onclick = (event) => {
    event.preventDefault();
    save.disabled = true;
    void savePendingPdf().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
      validatePending();
    });
  };
  save.textContent = "Save PDF rule";
  validatePending();
  notice(`Zaznaczono tekst z PDF: „${option.raw}”. Sprawdź wartość i zapisz.`);
}

async function receivePdfCapture(message: Record<string, unknown>): Promise<void> {
  if (message.windowId !== windowId || typeof message.objectId !== "string") return;
  if (!isRecord(message.candidate)) return;

  const candidate = message.candidate as unknown as PdfTextExtractionCandidate;
  const option = candidate.options?.[0];
  if (!option || option.extraction?.type !== "pdfText") return;

  await data("GET");
  const object = objectFor(message.objectId);
  if (!object || !currentObjectLooksLike(object)) {
    notice("Wybierz w sidebarze obiekt, do którego należy ten PDF.", true);
    return;
  }

  const active = activeDescriptor();
  if (!active) {
    notice("Najpierw kliknij pole w sidebarze, potem zaznacz tekst w PDF.", true);
    return;
  }

  presentPdfCapture(object, active.field, active.target, candidate);
}

function sourceUrlFromRow(row: HTMLElement): string | undefined {
  return Array.from(row.querySelectorAll("small"))
    .map((item) => item.textContent?.trim() ?? "")
    .find((text) => /^https?:\/\//i.test(text));
}

function sourceByUrl(url: string): LegacyStoredFileSource | undefined {
  return state.fileSources?.find((source) => source.url === url);
}

async function ensurePdfPermission(url: string): Promise<void> {
  const parsed = new URL(url);
  const origins = [`${parsed.origin}/*`];
  if (await browser.permissions.contains({ origins })) return;
  if (!(await browser.permissions.request({ origins }))) {
    throw new Error("Burbot potrzebuje dostępu do hosta PDF, aby odczytać jego tekst.");
  }
}

async function openReaderInCurrentTab(source: LegacyStoredFileSource): Promise<void> {
  await ensurePdfPermission(source.url);
  await data("GET");

  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({ active: true, windowId: currentWindow.id });
  const tab = tabs[0];
  if (tab?.id === undefined) throw new Error("Brak aktywnej karty.");

  const reader = new URL(browser.runtime.getURL("pdf-reader.html"));
  reader.searchParams.set("objectId", source.objectId);
  reader.searchParams.set("sourceId", source.id);
  await browser.tabs.update(tab.id, { url: reader.href });
  notice("Burbot PDF Reader: wybierz pole w sidebarze i zaznacz tekst w PDF.");
}

async function syncReaderMode(): Promise<void> {
  if (windowId === undefined) return;
  const tabs = await browser.tabs.query({ active: true, windowId });
  const url = tabs[0]?.url ?? "";
  const isReader = url.startsWith(browser.runtime.getURL("pdf-reader.html"));
  if (!isReader) return;

  $("connection").textContent = "Burbot PDF Reader · zaznacz tekst w dokumencie";
  const connect = $("connect") as HTMLButtonElement;
  connect.disabled = true;
  const hint = $("capture-hint");
  hint.textContent = "Wybierz pole, potem zaznacz wartość w PDF.";
}

export async function initPdfCaptureUi(): Promise<void> {
  if (initialized) return;
  initialized = true;
  windowId = (await browser.windows.getCurrent()).id;
  state = await data("GET");

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRecord(message) || message.type !== "BURBOT_PDF_CAPTURE") return undefined;
    void receivePdfCapture(message).catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
    return undefined;
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (
        pending &&
        (target.closest(".field-row") ||
          target.closest("#pick,#selected-text,#page-url,#deselect,#connect"))
      ) {
        clearPending();
      }

      const read = target.closest<HTMLButtonElement>(".file-source-actions .text-button");
      if (!read || read.textContent?.trim() !== "Wydziel wartości") return;

      const row = read.closest<HTMLElement>(".file-source-row");
      const url = row ? sourceUrlFromRow(row) : undefined;
      const source = url ? sourceByUrl(url) : undefined;
      if (!source) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      void openReaderInCurrentTab(source).catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
    },
    true,
  );

  $("value-control").addEventListener("input", () => {
    if (pending) validatePending();
  });
  $("value-control").addEventListener("change", () => {
    if (pending) validatePending();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (next) state = next;
  });

  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId !== windowId) return;
    setTimeout(() => void syncReaderMode(), 100);
  });
  browser.tabs.onUpdated.addListener((_tabId, change) => {
    if (!change.url && change.status !== "complete") return;
    setTimeout(() => void syncReaderMode(), 100);
  });

  await syncReaderMode();
}
