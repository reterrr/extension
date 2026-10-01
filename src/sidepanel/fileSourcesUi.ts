import { createPickerClient, type PickerClient } from "./pickerRpc";
import {
  localUploadValidationMessage,
  uploadLocalFile,
} from "../shared/api/localFiles";
import {
  FILE_CLIENT_REQUIREMENTS,
  FILE_METADATA_UNSET_LABEL,
  FILE_PURPOSES,
  FILE_SIGNATURE_REQUIREMENTS,
} from "../shared/fileMetadata";
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
import {
  buildProjectDownloadPlan,
  buildRecruitmentDownloadPlan,
} from "../shared/fileDownloads";
import {
  projectFileInheritanceStatus,
  projectForRecruitment,
} from "../shared/fileInheritance";

let initialized = false;
let renderQueued = false;

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { if (renderQueued) render(); });
}
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let activePageTabId: number | null = null;
let port: browser.runtime.Port | null = null;
let pickerClient: PickerClient | null = null;
let fileModeEnabled = false;
let filePicking = false;
let fileModeStarting = false;
let fileCaptureBusy = false;
let fileDownloadBusy = false;
let fileInheritanceBusy = false;
let localUploadBusy = false;
let localDragDepth = 0;
let fileModeGeneration = 0;
let currentWindowId: number | null = null;
const handledShortcutStamps = new Set<string>();
const expandedFileSources = new Set<string>();

const CURRENT_FILE_METADATA_FIELDS = [
  "display_name",
  "purpose",
  "has_fields",
  "intended_use",
  "client_requirement",
  "signature_requirement",
] as const;

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
  const connected = document.getElementById("connection")?.dataset.connected === "true";
  return connected ? activePageUrl : "";
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

function isLocalUploadedFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "8765" &&
      parsed.pathname.startsWith("/files/")
    );
  } catch {
    return false;
  }
}

function host(url: string): string {
  if (isLocalUploadedFileUrl(url)) return "plik lokalny";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function objectDisplayName(object: LegacyStoredObject): string {
  if (object.type === "recruitment") {
    const name = object.values?.external_number;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  if (object.type === "project" || object.type === "operator") {
    const name = object.values?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return object.label?.trim() || object.importKey?.trim() || object.id;
}

async function downloadAllObjectFiles(
  object: LegacyStoredObject,
): Promise<void> {
  if (object.type !== "recruitment" && object.type !== "project") {
    throw new Error(
      "Pobieranie wszystkich plików jest dostępne dla projektu i naboru.",
    );
  }

  const sources = (state.fileSources ?? []).filter(
    (source) => source.objectId === object.id,
  );
  if (!sources.length) {
    throw new Error(
      object.type === "project"
        ? "Ten projekt nie ma przypiętych plików."
        : "Ten nabór nie ma przypiętych plików.",
    );
  }

  const project =
    object.type === "recruitment"
      ? projectForRecruitment(state, object)
      : object;
  if (!project) {
    throw new Error(
      "Najpierw przypisz projekt do naboru — nazwa katalogu używa nazwy naboru i projektu.",
    );
  }

  fileDownloadBusy = true;
  render();
  try {
    const platform = await browser.runtime.getPlatformInfo();
    const inputFiles = sources.map((source) => ({
      name: source.name,
      url: source.url,
    }));
    const plan =
      object.type === "project"
        ? buildProjectDownloadPlan(
            objectDisplayName(project),
            inputFiles,
            platform.os === "win",
          )
        : buildRecruitmentDownloadPlan(
            objectDisplayName(object),
            objectDisplayName(project),
            inputFiles,
            platform.os === "win",
          );
    const results = await Promise.allSettled(
      plan.files.map((file) =>
        browser.downloads.download({
          url: file.url,
          filename: file.relativePath,
          conflictAction: "uniquify",
          saveAs: false,
        }),
      ),
    );

    const failed = results
      .map((result, index) => ({ result, file: plan.files[index] }))
      .filter(
        (
          entry,
        ): entry is {
          result: PromiseRejectedResult;
          file: (typeof plan.files)[number];
        } => entry.result.status === "rejected",
      );

    if (failed.length) {
      const downloaded = results.length - failed.length;
      const details = failed
        .slice(0, 3)
        .map(({ result, file }) => {
          const reason =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          return `${file.name}: ${reason}`;
        })
        .join(" | ");
      console.error("Burbot bulk download failures", failed);
      throw new Error(
        `Pobrano ${downloaded}/${results.length} plików do katalogu „${plan.folderName}”. ${failed.length} pobrań nie udało się uruchomić. ${details}`,
      );
    }

    notice(
      `Pobieranie ${results.length} plików uruchomione. Katalog: „${plan.folderName}”.`,
    );
  } finally {
    fileDownloadBusy = false;
    render();
  }
}

async function inheritProjectFiles(
  recruitment: LegacyStoredObject,
): Promise<void> {
  if (recruitment.type !== "recruitment") {
    throw new Error("Dziedziczenie plików jest dostępne dla naboru.");
  }

  const before = projectFileInheritanceStatus(state, recruitment);
  if (!before.project) {
    throw new Error("Najpierw przypisz projekt do naboru.");
  }
  if (!before.projectFiles.length) {
    throw new Error("Przypisany projekt nie ma plików do skopiowania.");
  }
  if (!before.pendingFiles.length) {
    notice(
      "Wszystkie aktualne pliki projektu są już skopiowane do naboru. Kopie pozostają niezależne od projektu.",
    );
    return;
  }

  fileInheritanceBusy = true;
  render();
  try {
    const expected = before.pendingFiles.length;
    await data("INHERIT_PROJECT_FILES", {
      objectId: recruitment.id,
    });
    const refreshed = state.objects.find(
      (object) => object.id === recruitment.id,
    );
    const after = refreshed
      ? projectFileInheritanceStatus(state, refreshed)
      : undefined;
    const copied = after
      ? Math.max(0, expected - after.pendingFiles.length)
      : expected;

    notice(
      `Skopiowano ${copied} plików z projektu do naboru. To niezależne kopie — późniejsze zmiany projektu ich nie zmienią.`,
    );
  } finally {
    fileInheritanceBusy = false;
    render();
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
  announce = true,
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
  if (announce) {
    notice(`Dodano plik: ${file.name}. File Add Mode nadal jest aktywny.`);
  }
  render();
  keepControlInPlace(button, beforeTop);
}

async function uploadLocalFiles(files: readonly File[]): Promise<void> {
  if (!files.length || localUploadBusy) return;
  const object = chosenObject();
  if (!object) throw new Error("Wybierz obiekt przed wgraniem pliku.");

  const invalid = files
    .map((file) => localUploadValidationMessage(file))
    .filter((message): message is string => Boolean(message));
  if (invalid.length) {
    throw new Error(invalid.slice(0, 3).join(" "));
  }

  localUploadBusy = true;
  localDragDepth = 0;
  render();

  let attached = 0;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const title = $("local-file-drop-title");
      const hint = $("local-file-drop-hint");
      title.textContent = `Wgrywanie ${index + 1}/${files.length}…`;
      hint.textContent = file.name;

      const candidate = await uploadLocalFile(file);
      await attachFile(object, candidate, false);
      attached++;
    }

    notice(
      attached === 1
        ? `Wgrano plik z komputera: ${files[0].name}.`
        : `Wgrano ${attached} plików z komputera.`,
    );
  } finally {
    localUploadBusy = false;
    render();
  }
}

function setLocalDropDragging(active: boolean): void {
  $("local-file-drop-zone").classList.toggle("is-dragging", active);
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
          closeCurrentPickerConnection();
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

function shortcutStorageKey(): string | null {
  return currentWindowId === null
    ? null
    : `burbot:file-mode-toggle:${currentWindowId}`;
}

async function handleShortcutToggle(stamp = ""): Promise<void> {
  if (stamp && handledShortcutStamps.has(stamp)) return;
  if (stamp) {
    handledShortcutStamps.add(stamp);
    if (handledShortcutStamps.size > 32) {
      handledShortcutStamps.delete(handledShortcutStamps.values().next().value!);
    }
  }

  try {
    await toggleFileMode();
  } finally {
    const key = shortcutStorageKey();
    if (key) await browser.storage.session.remove(key);
  }
}

async function consumePendingShortcutToggle(): Promise<void> {
  const key = shortcutStorageKey();
  if (!key) return;
  const stored = await browser.storage.session.get(key);
  const pending = stored[key] as
    | { stamp?: unknown; createdAt?: unknown }
    | undefined;
  if (!pending || typeof pending.stamp !== "string") return;

  const createdAt =
    typeof pending.createdAt === "number" ? pending.createdAt : Date.now();
  if (Date.now() - createdAt > 5000) {
    await browser.storage.session.remove(key);
    return;
  }
  await handleShortcutToggle(pending.stamp);
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
  const filled = CURRENT_FILE_METADATA_FIELDS.filter((field) => {
    if (field === "has_fields") return typeof source.has_fields === "boolean";
    if (field === "display_name") {
      return Boolean(source.display_name?.trim() || source.name?.trim());
    }
    const value = source[field];
    return typeof value === "string" && value.trim().length > 0;
  }).length;
  const total = CURRENT_FILE_METADATA_FIELDS.length;
  return { filled, total, complete: filled === total };
}

function metadataText(
  source: LegacyStoredFileSource,
  key: "display_name" | "intended_use",
): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function appendSelectOptions(
  select: HTMLSelectElement,
  placeholder: string,
  values: readonly string[],
  current: string | undefined,
): void {
  select.append(new Option(placeholder, ""));
  for (const value of values) select.append(new Option(value, value));

  if (current && !values.includes(current)) {
    const legacy = new Option(`Dotychczas: ${current}`, current);
    legacy.dataset.legacy = "true";
    select.append(legacy);
  }
  select.value = current ?? "";
}

async function removeFileSource(source: LegacyStoredFileSource): Promise<void> {
  const object = chosenObject();
  if (!object || object.id !== source.objectId) {
    throw new Error("Wybierz obiekt, do którego należy ten plik.");
  }

  const button = $("read-from-file");
  const beforeTop = button.getBoundingClientRect().top;
  await data("REMOVE_FILE_SOURCE", {
    objectId: object.id,
    sourceId: source.id,
  });
  expandedFileSources.delete(source.id);
  notice(`Usunięto plik: ${source.name}.`);
  render();
  keepControlInPlace(button, beforeTop);
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
  title.textContent = source.display_name?.trim() || source.name;
  const meta = document.createElement("small");
  meta.textContent = source.display_name?.trim()
    ? `${source.name} · ${source.fileType} · ${host(source.url)}`
    : `${source.fileType} · ${host(source.url)}`;
  if (source.copiedFromProjectId) {
    const inherited = document.createElement("span");
    inherited.className = "file-source-inherited-badge";
    inherited.textContent = "kopia z projektu";
    inherited.title =
      "Ten plik został skopiowany z projektu i nie aktualizuje się automatycznie.";
    meta.append(inherited);
  }
  summaryCopy.append(title, meta);

  const status = document.createElement("span");
  status.className = progress.complete
    ? "file-source-classification-status complete"
    : "file-source-classification-status pending";
  status.textContent = progress.complete
    ? "Oznaczony"
    : `${progress.filled}/${progress.total} · Do oznaczenia`;

  const quickRemove = document.createElement("button");
  quickRemove.type = "button";
  quickRemove.className = "file-source-quick-remove icon-button danger";
  quickRemove.setAttribute("aria-label", `Usuń plik ${source.name}`);
  quickRemove.title = "Usuń plik";
  quickRemove.textContent = "×";
  quickRemove.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void removeFileSource(source).catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
  };

  summary.append(summaryCopy, status, quickRemove);

  const body = document.createElement("div");
  body.className = "file-source-body";

  const url = document.createElement("small");
  url.className = "file-source-url";
  url.textContent = source.url;
  body.append(url);

  const classification = document.createElement("div");
  classification.className = "file-source-classification";

  const nameLabel = document.createElement("label");
  nameLabel.className = "file-source-field";
  const nameCaption = document.createElement("span");
  nameCaption.textContent = "Nazwa";
  const displayName = document.createElement("input");
  displayName.type = "text";
  displayName.value = metadataText(source, "display_name") || source.name;
  displayName.placeholder = "Nazwa dokumentu";
  displayName.autocomplete = "off";
  nameLabel.append(nameCaption, displayName);

  const intendedUseLabel = document.createElement("label");
  intendedUseLabel.className = "file-source-field";
  const intendedUseCaption = document.createElement("span");
  intendedUseCaption.textContent = "Przeznaczenie";
  const intendedUse = document.createElement("input");
  intendedUse.type = "text";
  intendedUse.value = metadataText(source, "intended_use");
  intendedUse.placeholder = FILE_METADATA_UNSET_LABEL;
  intendedUse.autocomplete = "off";
  intendedUseLabel.append(intendedUseCaption, intendedUse);

  const textRow = document.createElement("div");
  textRow.className = "file-source-field-row";
  textRow.append(nameLabel, intendedUseLabel);
  classification.append(textRow);

  const purposeLabel = document.createElement("label");
  purposeLabel.className = "file-source-field";
  const purposeCaption = document.createElement("span");
  purposeCaption.textContent = "Cel dokumentu";
  const purpose = document.createElement("select");
  appendSelectOptions(
    purpose,
    FILE_METADATA_UNSET_LABEL,
    FILE_PURPOSES,
    typeof source.purpose === "string" ? source.purpose : undefined,
  );
  purposeLabel.append(purposeCaption, purpose);
  classification.append(purposeLabel);

  const hasFieldsLabel = document.createElement("label");
  hasFieldsLabel.className = "file-source-field";
  const hasFieldsCaption = document.createElement("span");
  hasFieldsCaption.textContent = "Czy plik zawiera pola do wypełnienia?";
  const hasFields = document.createElement("select");
  hasFields.append(
    new Option(FILE_METADATA_UNSET_LABEL, ""),
    new Option("Tak, pola lub deklaracje", "true"),
    new Option("Nie", "false"),
  );
  hasFields.value =
    typeof source.has_fields === "boolean" ? String(source.has_fields) : "";
  hasFieldsLabel.append(hasFieldsCaption, hasFields);
  classification.append(hasFieldsLabel);

  const requirementLabel = document.createElement("label");
  requirementLabel.className = "file-source-field";
  const requirementCaption = document.createElement("span");
  requirementCaption.textContent = "Wymagalność";
  const clientRequirement = document.createElement("select");
  appendSelectOptions(
    clientRequirement,
    FILE_METADATA_UNSET_LABEL,
    FILE_CLIENT_REQUIREMENTS,
    typeof source.client_requirement === "string"
      ? source.client_requirement
      : undefined,
  );
  requirementLabel.append(requirementCaption, clientRequirement);
  classification.append(requirementLabel);

  const signatureLabel = document.createElement("label");
  signatureLabel.className = "file-source-field";
  const signatureCaption = document.createElement("span");
  signatureCaption.textContent = "Podpis";
  const signatureRequirement = document.createElement("select");
  appendSelectOptions(
    signatureRequirement,
    FILE_METADATA_UNSET_LABEL,
    FILE_SIGNATURE_REQUIREMENTS,
    typeof source.signature_requirement === "string"
      ? source.signature_requirement
      : undefined,
  );
  signatureLabel.append(signatureCaption, signatureRequirement);
  classification.append(signatureLabel);

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
    const metadata: Record<string, unknown> = {
      display_name: displayName.value,
      intended_use: intendedUse.value,
      purpose: purpose.value || undefined,
      client_requirement: clientRequirement.value || undefined,
      signature_requirement: signatureRequirement.value || undefined,
      has_fields:
        hasFields.value === ""
          ? undefined
          : hasFields.value === "true",
    };

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
  open.textContent = isLocalUploadedFileUrl(source.url)
    ? "Otwórz plik ↗"
    : "Otwórz źródło ↗";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.setAttribute("aria-label", `Usuń plik ${source.name}`);
  remove.textContent = "×";
  remove.onclick = () => {
    void removeFileSource(source).catch((error: unknown) =>
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
  const dropZone = $("local-file-drop-zone");
  const dropTitle = $("local-file-drop-title");
  const dropHint = $("local-file-drop-hint");
  dropZone.setAttribute("aria-disabled", String(localUploadBusy));
  if (!localUploadBusy) {
    dropTitle.textContent = "Upuść pliki tutaj";
    dropHint.textContent = "albo kliknij, aby wybrać z komputera";
  }
  button.disabled = fileModeStarting && !fileModeEnabled;
  button.dataset.active = String(fileModeEnabled);
  button.setAttribute("aria-pressed", String(fileModeEnabled));
  button.title = "Ctrl+Alt+F";
  button.textContent = fileCaptureBusy
    ? "Dodawanie pliku…"
    : fileModeEnabled
      ? "✓ File Add Mode ON · Ctrl+Alt+F"
      : "+ Dodaj ze strony · Ctrl+Alt+F";
  hint.hidden = !fileModeEnabled;
  if (fileModeEnabled) {
    hint.textContent =
      "Tryb pozostaje aktywny po dodaniu pliku. Klikaj kolejne pliki; Ctrl+Alt+F lub Esc wyłącza.";
  }
}

function render(): void {
  renderQueued = false;
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

  const isRecruitment = object.type === "recruitment";
  const inheritance = isRecruitment
    ? projectFileInheritanceStatus(state, object)
    : undefined;
  const project = inheritance?.project;

  const inherit = $("inherit-project-files") as HTMLButtonElement;
  const inheritanceHint = $("file-source-inheritance-hint");
  inherit.hidden = !isRecruitment;
  inheritanceHint.hidden = !isRecruitment;
  if (isRecruitment && inheritance) {
    const pending = inheritance.pendingFiles.length;
    const projectFileCount = inheritance.projectFiles.length;
    const alreadyInherited = inheritance.inheritedFiles.length;
    inherit.disabled =
      fileInheritanceBusy ||
      !project ||
      projectFileCount === 0 ||
      pending === 0;
    inherit.textContent = fileInheritanceBusy
      ? "Kopiowanie plików…"
      : !project
        ? "↳ Dziedzicz pliki z projektu"
        : projectFileCount === 0
          ? "Projekt nie ma plików"
          : pending > 0
            ? alreadyInherited > 0
              ? `↳ Skopiuj nowe z projektu (${pending})`
              : `↳ Dziedzicz pliki z projektu (${pending})`
            : `✓ Pliki projektu skopiowane (${projectFileCount})`;
    inherit.title = !project
      ? "Najpierw przypisz projekt do naboru."
      : pending > 0
        ? "Tworzy niezależne kopie brakujących plików projektu."
        : "Kopie naboru są niezależne. Zmiany plików projektu nie aktualizują ich automatycznie.";
  } else {
    inherit.disabled = true;
    inherit.title = "";
  }

  const downloadAll = $("download-all-files") as HTMLButtonElement;
  const canBulkDownload =
    object.type === "project" || object.type === "recruitment";
  downloadAll.hidden = !canBulkDownload;
  downloadAll.disabled =
    fileDownloadBusy ||
    sources.length === 0 ||
    (isRecruitment && !project);
  downloadAll.textContent = fileDownloadBusy
    ? "Pobieranie…"
    : `↓ Pobierz wszystkie (${sources.length})`;
  if (object.type === "project") {
    downloadAll.title = `Pobierz do: ${objectDisplayName(object)}`;
  } else if (isRecruitment) {
    downloadAll.title = project
      ? `Pobierz do: ${objectDisplayName(object)} - ${objectDisplayName(project)}`
      : "Przypisz projekt, aby utworzyć katalog naboru.";
  } else {
    downloadAll.title = "";
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

  const localInput = $("local-file-input") as HTMLInputElement;
  const localDropZone = $("local-file-drop-zone");

  const chooseLocalFiles = () => {
    if (localUploadBusy) return;
    localInput.click();
  };

  localDropZone.onclick = (event: MouseEvent) => {
    if (event.target === localInput) return;
    chooseLocalFiles();
  };
  localInput.onclick = (event: MouseEvent) => event.stopPropagation();
  localDropZone.onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    chooseLocalFiles();
  };
  localInput.onchange = () => {
    const files = Array.from(localInput.files ?? []);
    localInput.value = "";
    void uploadLocalFiles(files).catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  };

  localDropZone.ondragenter = (event: DragEvent) => {
    event.preventDefault();
    if (localUploadBusy) return;
    localDragDepth++;
    setLocalDropDragging(true);
  };
  localDropZone.ondragover = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  localDropZone.ondragleave = (event: DragEvent) => {
    event.preventDefault();
    localDragDepth = Math.max(0, localDragDepth - 1);
    if (!localDragDepth) setLocalDropDragging(false);
  };
  localDropZone.ondrop = (event: DragEvent) => {
    event.preventDefault();
    localDragDepth = 0;
    setLocalDropDragging(false);
    if (localUploadBusy) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    void uploadLocalFiles(files).catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  };

  $("inherit-project-files").onclick = () => {
    const object = chosenObject();
    if (!object) {
      notice("Wybierz nabór przed dziedziczeniem plików.", true);
      return;
    }
    void inheritProjectFiles(object).catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  };

  $("download-all-files").onclick = () => {
    const object = chosenObject();
    if (!object) {
      notice("Wybierz projekt lub nabór przed pobieraniem plików.", true);
      return;
    }
    void downloadAllObjectFiles(object).catch((error: unknown) => {
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

  await consumePendingShortcutToggle().catch((error: unknown) => {
    notice(error instanceof Error ? error.message : String(error), true);
  });

  const observer = new MutationObserver(queueRender);
  observer.observe($("connection"), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener("burbot:active-object-changed", queueRender);
  window.addEventListener("burbot:workspace-state-changed", (event) => {
    const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail?.state;
    if (next) state = next;
    queueRender();
  });

  browser.tabs.onActivated.addListener(() => {
    void reconnectFileMode().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : String(error), true);
    });
  });

  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== activePageTabId) return;
    if (
      !change.url &&
      change.status !== "loading" &&
      change.status !== "complete"
    ) return;
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
