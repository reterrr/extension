import { createPickerClient, type PickerClient } from "./pickerRpc";
import {
  createRemoteFileSourceCandidate,
  isRemoteSupportedFileUrl,
} from "../shared/sources/remoteFile";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";
import type { RemoteFileSourceCandidate } from "../shared/types/source";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let activePageTabId: number | null = null;
let port: browser.runtime.Port | null = null;
let pickerClient: PickerClient | null = null;
let fileModeEnabled = false;
let filePicking = false;
let fileModeStarting = false;
let fileCaptureBusy = false;
let fileModeGeneration = 0;
let currentWindowId: number | null = null;
let lastShortcutStamp = "";
const expandedFileSources = new Set<string>();

type FileTextMetadataKey =
  | "document_kind"
  | "purpose"
  | "intended_use"
  | "client_requirement"
  | "signature_requirement"
  | "delivery_method";

const FILE_TEXT_METADATA_FIELDS: Array<{
  key: FileTextMetadataKey;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}> = [
  {
    key: "document_kind",
    label: "Rodzaj",
    placeholder: "np. Oryginał operatora",
  },
  {
    key: "purpose",
    label: "Cel",
    placeholder: "np. Formularz do uzupełnienia",
  },
  {
    key: "intended_use",
    label: "Przeznaczenie",
    multiline: true,
    placeholder: "Do czego służy ten dokument?",
  },
  {
    key: "client_requirement",
    label: "Wymagalność dla klienta",
    multiline: true,
    placeholder: "np. Obowiązkowy na etapie naboru / informacyjny / warunkowy",
  },
  {
    key: "signature_requirement",
    label: "Podpis",
    multiline: true,
    placeholder: "np. Wymagany podpisany plik",
  },
  {
    key: "delivery_method",
    label: "Sposób dostarczenia",
    multiline: true,
    placeholder: "np. Opracowany wzór / generator",
  },
];

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

function keepControlInPlace(
  element: HTMLElement,
  beforeTop: number,
): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const delta = element.getBoundingClientRect().top - beforeTop;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      const capture = document.getElementById("capture-area");
      if (capture instanceof HTMLElement && !capture.hidden) {
        const rect = element.getBoundingClientRect();
        const dockTop = capture.getBoundingClientRect().top;
        if (rect.bottom > dockTop - 10) {
          window.scrollBy(0, rect.bottom - dockTop + 10);
        }
      }
    });
  });
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

async function activeTab(): Promise<browser.tabs.Tab> {
  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({
    active: true,
    windowId: currentWindow.id,
  });
  if (!tabs[0]) throw new Error("No active webpage.");
  return tabs[0];
}

async function refreshActivePage(): Promise<void> {
  const tab = await activeTab();
  activePageUrl = tab.url ?? "";
  activePageTabId = tab.id ?? null;
}

function workspacePageUrl(): string {
  const connection = document.getElementById("connection")?.textContent ?? "";
  return connection.includes("· connected") ? activePageUrl : "";
}

function isLocal(object: LegacyStoredObject, pageUrl: string): boolean {
  return (
    !!pageUrl &&
    (object.sourceUrl === pageUrl ||
      state.rules.some(
        (rule) => rule.objectId === object.id && rule.pageUrl === pageUrl,
      ))
  );
}

function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("workspace")?.dataset.activeObjectId ?? "";
  if (!activeId) return undefined;
  return state.objects.find((object) => object.id === activeId);
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function closeConnection(
  client: PickerClient | null,
  connectedPort: browser.runtime.Port | null,
): void {
  client?.dispose();
  try {
    connectedPort?.disconnect();
  } catch {
    // Already disconnected.
  }
}

function closeCurrentPickerConnection(): void {
  const currentClient = pickerClient;
  const currentPort = port;
  pickerClient = null;
  port = null;
  closeConnection(currentClient, currentPort);
  filePicking = false;
}

async function stopPickerConnection(): Promise<void> {
  // Invalidate callbacks from the old content-script port before requesting STOP.
  fileModeGeneration++;
  fileModeStarting = false;
  const currentClient = pickerClient;
  const currentPort = port;
  pickerClient = null;
  port = null;
  filePicking = false;

  try {
    await currentClient?.request("STOP");
  } catch {
    // The tab may already have navigated away.
  } finally {
    closeConnection(currentClient, currentPort);
    renderMode();
  }
}

async function attachFile(
  object: LegacyStoredObject,
  file: RemoteFileSourceCandidate,
): Promise<void> {
  const button = $("read-from-file");
  const beforeTop = button.getBoundingClientRect().top;
  await data("ADD_FILE_SOURCE", {
    objectId: object.id,
    file,
  });
  const added = (state.fileSources ?? []).find(
    (source) => source.objectId === object.id && source.url === file.url,
  );
  if (added) expandedFileSources.add(added.id);
  notice(`Dodano plik: ${file.name}. File Add Mode nadal jest aktywny.`);
  render();
  keepControlInPlace(button, beforeTop);
}

async function connectFileModeToActivePage(): Promise<void> {
  if (!fileModeEnabled || fileModeStarting) return;

  const object = chosenObject();
  if (!object) throw new Error("Wybierz obiekt przed włączeniem File Add Mode.");

  fileModeStarting = true;
  const token = ++fileModeGeneration;
  renderMode();

  try {
    const tab = await activeTab();
    if (token !== fileModeGeneration || !fileModeEnabled) return;
    if (!tab.url) throw new Error("The active tab has no URL.");

    activePageUrl = tab.url;
    activePageTabId = tab.id ?? null;

    const current = new URL(tab.url);
    if (current.protocol === "file:") {
      throw new Error(
        "Local file paths are never stored. Open the original project page and pick its remote file link.",
      );
    }

    if (isRemoteSupportedFileUrl(tab.url)) {
      fileCaptureBusy = true;
      renderMode();
      try {
        const file = createRemoteFileSourceCandidate(tab.url, tab.url);
        await attachFile(object, file);
      } finally {
        fileCaptureBusy = false;
        renderMode();
      }
      return;
    }

    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("Open an HTTP(S) webpage containing the file link first.");
    }
    if (tab.id === undefined) throw new Error("The active tab cannot be connected.");

    closeCurrentPickerConnection();

    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["core.js", "picker.js"],
    });
    if (token !== fileModeGeneration || !fileModeEnabled) return;

    const connectedPort = browser.tabs.connect(tab.id, {
      name: "burbot-file-picker",
      frameId: 0,
    });

    const client = createPickerClient(connectedPort, (event) => {
      if (token !== fileModeGeneration) return;

      if (event.event === "FILE_CAPTURE") {
        if (!fileModeEnabled) return;
        if (fileCaptureBusy) {
          notice("Poprzedni plik jest jeszcze zapisywany. Spróbuj ponownie za chwilę.", true);
          return;
        }

        const selectedObject = chosenObject();
        if (!selectedObject) {
          notice("Wybierz obiekt, do którego ma zostać dodany plik.", true);
          return;
        }

        fileCaptureBusy = true;
        renderMode();
        void attachFile(selectedObject, event.file)
          .catch((error: unknown) => {
            notice(error instanceof Error ? error.message : String(error), true);
          })
          .finally(() => {
            fileCaptureBusy = false;
            renderMode();
          });
        return;
      }

      if (event.event === "ERROR") {
        notice(event.error, true);
        return;
      }

      if (event.event === "MODE") {
        filePicking = event.picking;
        if (!event.picking && fileModeEnabled) {
          // A MODE=false from the live picker means the user pressed Esc.
          fileModeEnabled = false;
          notice("File Add Mode wyłączony.");
        }
        renderMode();
      }
    });

    if (token !== fileModeGeneration || !fileModeEnabled) {
      closeConnection(client, connectedPort);
      return;
    }

    port = connectedPort;
    pickerClient = client;

    connectedPort.onDisconnect.addListener(() => {
      client.dispose();
      if (port !== connectedPort || pickerClient !== client) return;
      port = null;
      pickerClient = null;
      filePicking = false;
      fileModeStarting = false;
      renderMode();
    });

    await client.request("PICK_FILE");
    if (token !== fileModeGeneration || !fileModeEnabled) {
      closeConnection(client, connectedPort);
      return;
    }

    filePicking = true;
    notice("File Add Mode aktywny. Klikaj kolejne pliki; Ctrl+Alt+F lub Esc wyłącza tryb.");
  } finally {
    if (token === fileModeGeneration) {
      fileModeStarting = false;
      renderMode();
    }
  }
}

async function enableFileMode(): Promise<void> {
  if (fileModeEnabled) return;
  if (!chosenObject()) throw new Error("Wybierz obiekt przed włączeniem File Add Mode.");
  fileModeEnabled = true;
  renderMode();
  try {
    await connectFileModeToActivePage();
  } catch (error) {
    fileModeEnabled = false;
    renderMode();
    throw error;
  }
}

async function disableFileMode(message = "File Add Mode wyłączony."): Promise<void> {
  fileModeEnabled = false;
  fileCaptureBusy = false;
  await stopPickerConnection();
  notice(message);
}

async function toggleFileMode(): Promise<void> {
  if (fileModeEnabled) {
    await disableFileMode();
  } else {
    await enableFileMode();
  }
}

async function reconnectFileMode(): Promise<void> {
  await stopPickerConnection();
  await refreshActivePage();
  if (fileModeEnabled) {
    await connectFileModeToActivePage();
  }
  render();
}

async function handleShortcutToggle(stamp = ""): Promise<void> {
  if (stamp && stamp === lastShortcutStamp) return;
  if (stamp) lastShortcutStamp = stamp;
  await toggleFileMode();
}

async function ensurePdfPermission(url: string): Promise<void> {
  const parsed = new URL(url);
  const origins = [`${parsed.origin}/*`];

  // Call request() directly from the click handler call stack. Firefox may
  // reject permission requests after an earlier await because user activation
  // is no longer guaranteed to be preserved.
  const granted = await browser.permissions.request({ origins });
  if (!granted) {
    throw new Error("Burbot potrzebuje dostępu do hosta PDF, aby odczytać jego tekst.");
  }
}

async function openPdfReader(
  object: LegacyStoredObject,
  source: LegacyStoredFileSource,
): Promise<void> {
  await ensurePdfPermission(source.url);

  const tab = await activeTab();
  if (tab.id === undefined) throw new Error("Brak aktywnej karty.");

  const url = new URL(browser.runtime.getURL("pdf-reader.html"));
  url.searchParams.set("objectId", object.id);
  url.searchParams.set("sourceId", source.id);

  // Reuse the current tab deliberately. That makes the mode transition
  // explicit: Firefox's native PDF viewer is replaced by Burbot PDF Reader.
  await browser.tabs.update(tab.id, { url: url.href });
  notice("Burbot PDF Reader: zaznacz wartość w dokumencie dla aktywnego pola.");
}

function metadataProgress(source: LegacyStoredFileSource): {
  filled: number;
  total: number;
  complete: boolean;
} {
  const textFilled = FILE_TEXT_METADATA_FIELDS.filter(
    ({ key }) => typeof source[key] === "string" && source[key]!.trim().length > 0,
  ).length;
  const filled = textFilled + (typeof source.has_fields === "boolean" ? 1 : 0);
  const total = FILE_TEXT_METADATA_FIELDS.length + 1;
  return { filled, total, complete: filled === total };
}

function metadataText(
  source: LegacyStoredFileSource,
  key: FileTextMetadataKey,
): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function renderSource(source: LegacyStoredFileSource): HTMLElement {
  const row = document.createElement("details");
  row.className = "file-source-row";
  row.open = expandedFileSources.has(source.id);

  const progress = metadataProgress(source);
  row.dataset.classified = String(progress.complete);
  row.addEventListener("toggle", () => {
    if (row.open) expandedFileSources.add(source.id);
    else expandedFileSources.delete(source.id);
  });

  const summary = document.createElement("summary");
  summary.className = "file-source-summary";

  const summaryCopy = document.createElement("span");
  summaryCopy.className = "file-source-summary-copy";
  const title = document.createElement("strong");
  title.textContent = source.name;
  const meta = document.createElement("small");
  meta.textContent = `${source.fileType} · ${host(source.url)}`;
  summaryCopy.append(title, meta);

  const status = document.createElement("span");
  status.className = progress.complete
    ? "file-source-classification-status complete"
    : "file-source-classification-status pending";
  status.textContent = progress.complete
    ? "Oznaczony"
    : `${progress.filled}/${progress.total} · Do oznaczenia`;
  summary.append(summaryCopy, status);

  const body = document.createElement("div");
  body.className = "file-source-body";

  const url = document.createElement("small");
  url.className = "file-source-url";
  url.textContent = source.url;
  body.append(url);

  const classification = document.createElement("div");
  classification.className = "file-source-classification";

  const controls = new Map<FileTextMetadataKey, HTMLInputElement | HTMLTextAreaElement>();
  for (const definition of FILE_TEXT_METADATA_FIELDS) {
    const label = document.createElement("label");
    label.className = "file-source-field";
    const caption = document.createElement("span");
    caption.textContent = definition.label;

    const input = definition.multiline
      ? document.createElement("textarea")
      : document.createElement("input");
    if (input instanceof HTMLInputElement) input.type = "text";
    if (input instanceof HTMLTextAreaElement) input.rows = 2;
    input.value = metadataText(source, definition.key);
    input.placeholder = definition.placeholder ?? "";
    input.autocomplete = "off";
    controls.set(definition.key, input);
    label.append(caption, input);
    classification.append(label);
  }

  const hasFieldsLabel = document.createElement("label");
  hasFieldsLabel.className = "file-source-field";
  const hasFieldsCaption = document.createElement("span");
  hasFieldsCaption.textContent = "Zawiera pola?";
  const hasFields = document.createElement("select");
  hasFields.append(
    new Option("Nie ustawiono", ""),
    new Option("Tak", "true"),
    new Option("Nie", "false"),
  );
  hasFields.value =
    typeof source.has_fields === "boolean" ? String(source.has_fields) : "";
  hasFieldsLabel.append(hasFieldsCaption, hasFields);
  classification.insertBefore(hasFieldsLabel, classification.children[2] ?? null);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary file-source-save";
  save.textContent = "Zapisz oznaczenia";
  save.onclick = () => {
    const object = chosenObject();
    if (!object || object.id !== source.objectId) {
      notice("Wybierz obiekt, do którego należy ten plik.", true);
      return;
    }

    expandedFileSources.add(source.id);
    const metadata: Record<string, unknown> = {};
    for (const [key, input] of controls) metadata[key] = input.value;
    metadata.has_fields =
      hasFields.value === ""
        ? undefined
        : hasFields.value === "true";

    void data("UPDATE_FILE_SOURCE", {
      objectId: object.id,
      sourceId: source.id,
      metadata,
    })
      .then(() => {
        notice(`Zapisano oznaczenia pliku: ${source.name}`);
        render();
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };
  classification.append(save);
  body.append(classification);

  const actions = document.createElement("div");
  actions.className = "file-source-actions";

  const read =
    source.fileType === "PDF" ? document.createElement("button") : null;
  if (read) {
    read.type = "button";
    read.className = "text-button";
    read.textContent = "Wydziel wartości";
    read.onclick = () => {
      const object = chosenObject();
      if (!object || object.id !== source.objectId) {
        notice("Wybierz obiekt, do którego należy ten PDF.", true);
        return;
      }

      void openPdfReader(object, source).catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
    };
  }

  const open = document.createElement("a");
  open.href = source.url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Otwórz źródło ↗";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.setAttribute("aria-label", `Usuń plik ${source.name}`);
  remove.textContent = "×";
  remove.onclick = () => {
    const object = chosenObject();
    if (!object) return;
    const button = $("read-from-file");
    const beforeTop = button.getBoundingClientRect().top;
    void data("REMOVE_FILE_SOURCE", {
      objectId: object.id,
      sourceId: source.id,
    })
      .then(() => {
        expandedFileSources.delete(source.id);
        notice("Usunięto plik.");
        render();
        keepControlInPlace(button, beforeTop);
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };

  if (read) actions.append(read);
  actions.append(open, remove);
  body.append(actions);
  row.append(summary, body);
  return row;
}

function renderMode(): void {
  const button = $("read-from-file") as HTMLButtonElement;
  const hint = $("file-source-mode-hint");
  button.disabled = fileModeStarting && !fileModeEnabled;
  button.dataset.active = String(fileModeEnabled);
  button.setAttribute("aria-pressed", String(fileModeEnabled));
  button.title = "Ctrl+Alt+F";
  button.textContent = fileCaptureBusy
    ? "Dodawanie pliku…"
    : fileModeEnabled
      ? "✓ File Add Mode ON · Ctrl+Alt+F"
      : "+ Dodaj pliki · Ctrl+Alt+F";
  hint.hidden = !fileModeEnabled;
  if (fileModeEnabled) {
    hint.textContent =
      "Tryb pozostaje aktywny po dodaniu pliku. Klikaj kolejne pliki; Ctrl+Alt+F lub Esc wyłącza.";
  }
}

function render(): void {
  const object = chosenObject();
  const section = $("file-sources-section");
  section.hidden = !object;
  if (!object) return;

  const root = $("file-source-list");
  const sources = (state.fileSources ?? []).filter(
    (source) => source.objectId === object.id,
  );
  root.replaceChildren();

  if (!sources.length) {
    const empty = document.createElement("p");
    empty.className = "file-source-empty";
    empty.textContent = "Brak przypiętych plików.";
    root.append(empty);
  } else {
    for (const source of sources) root.append(renderSource(source));
  }
  renderMode();
}

export async function initFileSourcesUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  $("read-from-file").onclick = () => {
    void toggleFileMode().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  };

  const currentWindow = await browser.windows.getCurrent();
  currentWindowId = currentWindow.id ?? null;
  state = await data("GET");
  await refreshActivePage();

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== "BURBOT_TOGGLE_FILE_MODE"
    ) {
      return undefined;
    }
    const payload = message as { windowId?: unknown; stamp?: unknown };
    if (
      typeof payload.windowId === "number" &&
      currentWindowId !== null &&
      payload.windowId !== currentWindowId
    ) {
      return undefined;
    }
    void handleShortcutToggle(
      typeof payload.stamp === "string" ? payload.stamp : "",
    ).catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
    return undefined;
  });

  const observer = new MutationObserver(render);
  observer.observe($("workspace"), {
    attributes: true,
    attributeFilter: ["data-active-object-id"],
  });
  observer.observe($("object-title"), { childList: true, subtree: true });
  observer.observe($("connection"), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener("burbot:active-object-changed", render);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    render();
  });

  browser.tabs.onActivated.addListener(() => {
    void reconnectFileMode().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  });

  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== activePageTabId) return;
    if (!change.url && change.status !== "loading") return;
    void reconnectFileMode().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  });

  window.addEventListener("pagehide", () => {
    fileModeEnabled = false;
    void stopPickerConnection();
  });
  render();
}
