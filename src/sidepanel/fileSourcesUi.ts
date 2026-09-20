import { createPickerClient, type PickerClient } from "./pickerRpc";
import {
  createRemotePdfSourceCandidate,
  isRemotePdfUrl,
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
let filePicking = false;
let fileModeStarting = false;
let fileModeGeneration = 0;

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

/** Mirrors workspace.js switcher ordering to resolve its private objectId. */
function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("object-options")?.dataset.activeObjectId ?? "";
  return (
    state.objects.find((object) => object.id === activeId) ??
    state.objects.at(-1)
  );
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

function disconnectPicker(): void {
  fileModeGeneration++;
  fileModeStarting = false;
  closeCurrentPickerConnection();
  renderMode();
}

async function attachFile(
  object: LegacyStoredObject,
  file: RemoteFileSourceCandidate,
): Promise<void> {
  await data("ADD_FILE_SOURCE", {
    objectId: object.id,
    file,
  });
  disconnectPicker();
  notice(`Dodano źródło PDF: ${file.name}`);
  render();
}

async function stopFileMode(): Promise<void> {
  // Invalidate an in-flight start before touching the current connection.
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

async function startFileMode(): Promise<void> {
  if (fileModeStarting) return;

  const object = chosenObject();
  if (!object) throw new Error("Choose an object first.");

  if (filePicking) {
    await stopFileMode();
    notice("Read from file mode cancelled.");
    return;
  }

  fileModeStarting = true;
  const token = ++fileModeGeneration;
  renderMode();

  try {
    const tab = await activeTab();
    if (token !== fileModeGeneration) return;
    if (!tab.url) throw new Error("The active tab has no URL.");

    const current = new URL(tab.url);
    if (current.protocol === "file:") {
      throw new Error(
        "Local file paths are never stored. Open the original project page and pick its remote PDF link.",
      );
    }

    if (isRemotePdfUrl(tab.url)) {
      const file = createRemotePdfSourceCandidate(tab.url, tab.url);
      await attachFile(object, file);
      return;
    }

    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("Open an HTTP(S) webpage containing the PDF link first.");
    }
    if (tab.id === undefined) throw new Error("The active tab cannot be connected.");

    // Close an idle/stale file-picker connection before creating a new one.
    closeCurrentPickerConnection();

    // Use the same lightweight picker bundles as the normal workspace. Injecting
    // content.js here reparsed the whole content entrypoint on every file-pick.
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["core.js", "picker.js"],
    });
    if (token !== fileModeGeneration) return;

    const connectedPort = browser.tabs.connect(tab.id, {
      name: "burbot-file-picker",
      frameId: 0,
    });

    const client = createPickerClient(connectedPort, (event) => {
      if (token !== fileModeGeneration) return;

      if (event.event === "FILE_CAPTURE") {
        const selectedObject = chosenObject();
        if (!selectedObject || selectedObject.id !== object.id) {
          disconnectPicker();
          notice("Object changed. Start Read from file again.", true);
          return;
        }

        // Disable the button while the source is being persisted so another
        // click cannot create a second picker connection for the same capture.
        fileModeStarting = true;
        filePicking = false;
        renderMode();
        void attachFile(object, event.file).catch((error: unknown) => {
          disconnectPicker();
          notice(error instanceof Error ? error.message : String(error), true);
        });
        return;
      }

      if (event.event === "ERROR") {
        notice(event.error, true);
        return;
      }

      if (event.event === "MODE") {
        filePicking = event.picking;
        renderMode();
      }
    });

    if (token !== fileModeGeneration) {
      closeConnection(client, connectedPort);
      return;
    }

    port = connectedPort;
    pickerClient = client;

    connectedPort.onDisconnect.addListener(() => {
      client.dispose();

      // A late disconnect from an older port must never clear a newer picker.
      if (port !== connectedPort || pickerClient !== client) return;
      port = null;
      pickerClient = null;
      filePicking = false;
      fileModeStarting = false;
      renderMode();
    });

    await client.request("PICK_FILE");
    if (token !== fileModeGeneration) {
      closeConnection(client, connectedPort);
      return;
    }

    filePicking = true;
    notice("Read from file: click a PDF link on the webpage. Press Esc to cancel.");
  } finally {
    if (token === fileModeGeneration) {
      fileModeStarting = false;
      renderMode();
    }
  }
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

function renderSource(source: LegacyStoredFileSource): HTMLElement {
  const row = document.createElement("div");
  row.className = "file-source-row";

  const title = document.createElement("strong");
  title.textContent = source.name;
  const meta = document.createElement("small");
  meta.textContent = `${source.fileType} · ${host(source.url)}`;
  const url = document.createElement("small");
  url.textContent = source.url;

  const actions = document.createElement("div");
  actions.className = "file-source-actions";

  const read = document.createElement("button");
  read.type = "button";
  read.className = "text-button";
  read.textContent = "Wydziel wartości";
  read.onclick = () => {
    const object = chosenObject();
    if (!object || object.id !== source.objectId) {
      notice("Choose the object that owns this PDF first.", true);
      return;
    }

    // This handler is the single source of truth for launching the PDF reader.
    // Do not proxy/intercept it from another sidepanel module.
    void openPdfReader(object, source).catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
  };

  const open = document.createElement("a");
  open.href = source.url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Open source ↗";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.setAttribute("aria-label", `Usuń źródło ${source.name}`);
  remove.textContent = "×";
  remove.onclick = () => {
    const object = chosenObject();
    if (!object) return;
    void data("REMOVE_FILE_SOURCE", {
      objectId: object.id,
      sourceId: source.id,
    })
      .then(() => {
        notice("Usunięto źródło plikowe.");
        render();
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };

  actions.append(read, open, remove);
  row.append(title, meta, url, actions);
  return row;
}

function renderMode(): void {
  const button = $("read-from-file") as HTMLButtonElement;
  const hint = $("file-source-mode-hint");
  button.disabled = fileModeStarting;
  button.dataset.active = String(filePicking);
  button.textContent = fileModeStarting
    ? "Starting…"
    : filePicking
      ? "Cancel file mode"
      : "Read from file";
  hint.hidden = !filePicking;
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
    void startFileMode().catch((error: unknown) => {
      disconnectPicker();
      notice(error instanceof Error ? error.message : String(error), true);
    });
  };

  state = await data("GET");
  await refreshActivePage();

  const observer = new MutationObserver(render);
  observer.observe($("object-options"), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current"],
  });
  observer.observe($("object-title"), { childList: true, subtree: true });
  observer.observe($("connection"), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    render();
  });

  browser.tabs.onActivated.addListener(() => {
    void stopFileMode()
      .then(refreshActivePage)
      .then(render)
      .catch(() => undefined);
  });

  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== activePageTabId) return;
    if (!change.url && change.status !== "loading") return;
    void stopFileMode()
      .then(refreshActivePage)
      .then(render)
      .catch(() => undefined);
  });

  window.addEventListener("pagehide", () => void stopFileMode());
  render();
}
