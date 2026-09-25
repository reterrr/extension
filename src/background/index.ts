import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import {
  STORAGE_KEY,
  commitState,
  loadState,
  publishUiState,
} from "../shared/api/storage";
import {
  clearActiveDraft,
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import { commitSessionView } from "../shared/commits/session";
import {
  applyStagedObjects,
  changedObjectIds,
  discardViewObject,
  hasViewChanges,
  missingReferences,
  rebaseCommittedObjects,
  stageObject,
  unstageObject,
} from "../shared/commits/staging";
import { createCapturedExtractionInput } from "../shared/extraction/rules";
import {
  isFileClientRequirement,
  isFilePurpose,
  isFileSignatureRequirement,
} from "../shared/fileMetadata";
import { discardStaleImportedEvidence } from "../shared/import/evidence";
import { importDocumentIntoState } from "../shared/import/format";
import { isPickerSelectionResponse } from "../shared/messaging/picker";
import {
  IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY,
  buildImportedEvidenceAnchorRequests,
  buildStoredSelectorHighlights,
  importedEvidenceLocatorKeys,
} from "../shared/selectorHighlights.js";
import {
  OBJECT_VIEW_STORAGE_KEY,
  addObjectToView,
} from "../shared/search/objectView.js";
import {
  assignPdfRuleIntoState,
  type AssignPdfRuleMessage,
} from "../shared/pdf/assignPdfRule";
import { createRemoteFileSourceCandidate } from "../shared/sources/remoteFile";
import type { DraftCommit } from "../shared/types/commit";
import type { FocusPayload } from "../shared/types/domain";
import type { CapturedExtractionInput } from "../shared/types/extraction";
import type { LegacyStorageState } from "../shared/types/legacy-storage";

const CREATE_TYPES = ["project", "recruitment", "operator"] as const;
type CreateObjectType = (typeof CREATE_TYPES)[number];

const ALLOWED_WRITES = new Set<string>([
  "IMPORT",
  "ASSIGN",
  "ASSIGN_PDF",
  "EDIT",
  "APPLY",
  "DELETE",
  "ADD_GEOGRAPHY",
  "REMOVE_GEOGRAPHY",
  "ADD_FILE_SOURCE",
  "UPDATE_FILE_SOURCE",
  "REMOVE_FILE_SOURCE",
  "ADD_OPERATOR_CONTACT",
  "REMOVE_OPERATOR_CONTACT",
  "ADD_FUNDING",
  "REMOVE_FUNDING",
  "ADD_FIELD_EVIDENCE",
  "REMOVE_FIELD_EVIDENCE",
]);

interface SelectionContextInfo {
  frameId?: number;
  selectionText?: string;
  frameUrl?: string;
  pageUrl?: string;
}

interface SelectionTab {
  id?: number;
  windowId?: number;
  url?: string;
}

const focusKey = (windowId: number) => `burbot:focus:${windowId}`;
let queue: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCreateObjectType(value: string): value is CreateObjectType {
  return CREATE_TYPES.some((objectType) => objectType === value);
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const task = queue.then(work);
  queue = task.catch(() => undefined);
  return task;
}

function cloneState(state: LegacyStorageState): LegacyStorageState {
  return JSON.parse(JSON.stringify(state)) as LegacyStorageState;
}
function validateCommittedReferences(state: LegacyStorageState): void {
  const missing = missingReferences(
    state,
    BurbotSchema as Record<
      string,
      { fields?: Record<string, { type?: string; label?: string }> }
    >,
  );
  if (!missing.length) return;

  const first = missing[0];
  const object = state.objects.find((entry) => entry.id === first.objectId);
  const definition = BurbotSchema[object?.type ?? ""]?.fields?.[first.field];
  throw new Error(
    `Nie można wykonać commita: „${object ? BurbotCore.displayName(object) : first.objectId}” wskazuje przez pole „${definition?.label ?? first.field}” na obiekt, który pozostaje tylko w View. Dodaj powiązany obiekt do Commit albo usuń tę zmianę.`,
  );
}


async function broadcast(message: Record<string, unknown>): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}

async function focus(windowId: number, value: FocusPayload): Promise<void> {
  await browser.storage.session.set({ [focusKey(windowId)]: value });
  await broadcast({ type: "BURBOT_FOCUS", windowId, ...value });
}

async function addObjectToActiveView(
  objectId: string,
  state: LegacyStorageState,
): Promise<void> {
  const stored = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
  const next = addObjectToView(
    stored[OBJECT_VIEW_STORAGE_KEY],
    objectId,
    state.objects,
  );
  await browser.storage.session.set({
    [OBJECT_VIEW_STORAGE_KEY]: next,
  });
}

async function focusCreatedObject(
  windowId: number,
  tabId: number,
  objectId: string,
  state: LegacyStorageState,
  note: string,
): Promise<void> {
  await addObjectToActiveView(objectId, state);
  await focus(windowId, {
    objectId,
    tabId,
    stamp: crypto.randomUUID(),
    note,
  });
}

async function notifyCommitChanged(): Promise<void> {
  await broadcast({ type: "BURBOT_COMMIT_CHANGED" });
}

let selectorHighlightState: LegacyStorageState | null = null;
let selectorHighlightSyncQueued = false;

type EvidenceLocatorRecord = {
  pageUrl: string;
  selector: string;
  selectorFallbacks?: string[];
  quote?: { exact: string; prefix: string; suffix: string };
  resolvedAt: string;
};

type EvidenceLocatorCache = Record<string, EvidenceLocatorRecord>;
type ResolvedEvidenceLocator = EvidenceLocatorRecord & { key: string };

let evidenceLocatorCache: EvidenceLocatorCache | null = null;
const evidenceLocatorSyncByTab = new Map<number, Promise<EvidenceLocatorCache>>();

async function readEvidenceLocatorCache(): Promise<EvidenceLocatorCache> {
  if (evidenceLocatorCache) return evidenceLocatorCache;
  const stored = await browser.storage.local.get(
    IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY,
  );
  const value = stored[IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY];
  evidenceLocatorCache =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as EvidenceLocatorCache)
      : {};
  return evidenceLocatorCache;
}

async function writeEvidenceLocatorCache(
  cache: EvidenceLocatorCache,
): Promise<void> {
  evidenceLocatorCache = cache;
  await browser.storage.local.set({
    [IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY]: cache,
  });
}

async function requestEvidenceLocators(
  tabId: number,
  items: unknown[],
): Promise<ResolvedEvidenceLocator[]> {
  const send = async () =>
    (await browser.tabs.sendMessage(tabId, {
      type: "BURBOT_MATERIALIZE_IMPORT_EVIDENCE",
      items,
    })) as {
      ok?: boolean;
      locators?: ResolvedEvidenceLocator[];
    };

  let response;
  try {
    response = await send();
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["evidence-locator.js"],
    });
    response = await send();
  }

  return response?.ok && Array.isArray(response.locators)
    ? response.locators
    : [];
}

async function materializeImportedEvidenceForTab(
  tabId: number,
  pageUrl: string,
  state: LegacyStorageState,
): Promise<EvidenceLocatorCache> {
  const running = evidenceLocatorSyncByTab.get(tabId);
  if (running) return running;

  const task = (async () => {
    const cache = { ...(await readEvidenceLocatorCache()) };
    const liveKeys = importedEvidenceLocatorKeys(state);
    let changed = false;
    for (const key of Object.keys(cache)) {
      if (!liveKeys.has(key)) {
        delete cache[key];
        changed = true;
      }
    }

    const requests = buildImportedEvidenceAnchorRequests(
      state,
      pageUrl,
      cache,
    );
    if (!requests.length) {
      if (changed) await writeEvidenceLocatorCache(cache);
      return cache;
    }

    let resolved: ResolvedEvidenceLocator[] = [];
    try {
      resolved = await requestEvidenceLocators(tabId, requests);
    } catch {
      if (changed) await writeEvidenceLocatorCache(cache);
      return cache;
    }

    const resolvedByKey = new Map(
      resolved.map((locator) => [String(locator.key), locator]),
    );

    for (const request of requests) {
      const key = String(request.key);
      const locator = resolvedByKey.get(key);
      if (locator) {
        const { key: _key, ...stored } = locator;
        const previous = cache[key];
        if (JSON.stringify(previous) !== JSON.stringify(stored)) {
          cache[key] = stored;
          changed = true;
        }
      } else if (cache[key]) {
        // A cached locator that no longer resolves should not force a broken
        // selector. Remove it so quote evidence can act as the fallback until
        // the page can be materialized again.
        delete cache[key];
        changed = true;
      }
    }

    if (changed) await writeEvidenceLocatorCache(cache);
    return cache;
  })().finally(() => {
    evidenceLocatorSyncByTab.delete(tabId);
  });

  evidenceLocatorSyncByTab.set(tabId, task);
  return task;
}

function isHttpPage(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function sendSelectorHighlights(
  tabId: number,
  pageUrl: string,
  state: LegacyStorageState,
): Promise<void> {
  const locatorCache = await materializeImportedEvidenceForTab(
    tabId,
    pageUrl,
    state,
  );
  const highlights = buildStoredSelectorHighlights(
    state,
    pageUrl,
    locatorCache,
  );

  try {
    await browser.tabs.sendMessage(tabId, {
      type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS",
      highlights,
    });
    return;
  } catch {
    // The runtime is injected lazily on ordinary webpages.
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["selector-highlights.js"],
    });
    await browser.tabs.sendMessage(tabId, {
      type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS",
      highlights,
    });
  } catch {
    // Navigation/restricted tabs can disappear between query and injection.
  }
}

async function syncSelectorHighlightsForTab(
  tabId: number,
  pageUrl?: string,
  state = selectorHighlightState,
): Promise<void> {
  if (!state) return;
  let url = pageUrl;
  if (!url) {
    try {
      url = (await browser.tabs.get(tabId)).url;
    } catch {
      return;
    }
  }
  if (!isHttpPage(url)) return;
  await sendSelectorHighlights(tabId, url, state);
}

async function syncSelectorHighlightsForAllTabs(
  state = selectorHighlightState,
): Promise<void> {
  if (!state) return;
  const tabs = await browser.tabs.query({});
  const eligible = tabs.filter(
    (tab) => tab.id !== undefined && isHttpPage(tab.url),
  );
  await Promise.allSettled(
    eligible.map((tab) =>
      sendSelectorHighlights(tab.id as number, tab.url as string, state),
    ),
  );
}

function queueSelectorHighlightSync(state?: LegacyStorageState): void {
  if (state) selectorHighlightState = state;
  if (selectorHighlightSyncQueued) return;
  selectorHighlightSyncQueued = true;
  queueMicrotask(() => {
    selectorHighlightSyncQueued = false;
    void syncSelectorHighlightsForAllTabs().catch(() => undefined);
  });
}

async function workspaceState(): Promise<LegacyStorageState> {
  const draft = await readActiveDraft();
  if (draft) return draft.workingState;
  return loadState();
}

async function ensureDraft(): Promise<DraftCommit> {
  const existing = await readActiveDraft();
  if (existing) return existing;

  const baseState = await loadState();
  const now = new Date().toISOString();
  const draft: DraftCommit = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    baseRevision: baseState.revision,
    baseState: cloneState(baseState),
    workingState: cloneState(baseState),
    stagedObjectIds: [],
  };
  await writeActiveDraft(draft);
  await publishUiState(draft.workingState);
  await notifyCommitChanged();
  return draft;
}

async function requireDraft(): Promise<DraftCommit> {
  const draft = await readActiveDraft();
  if (!draft) {
    throw new Error('Uruchom View przed zmianą obiektów.');
  }
  return draft;
}

async function saveDraftState(
  draft: DraftCommit,
  state: LegacyStorageState,
): Promise<LegacyStorageState> {
  draft.workingState = state;
  draft.updatedAt = new Date().toISOString();
  await writeActiveDraft(draft);
  await publishUiState(state);
  queueSelectorHighlightSync(state);
  await notifyCommitChanged();
  return state;
}

function mutateFileSource(
  original: LegacyStorageState,
  message: Record<string, unknown>,
  now: string,
): LegacyStorageState {
  if (message.expectedRevision !== original.revision) {
    throw new Error(
      "Data changed in another panel. Review the refreshed values and retry.",
    );
  }
  if (typeof message.objectId !== "string") throw new Error("Choose an object.");

  const state = cloneState(original);
  const object = state.objects.find((entry) => entry.id === message.objectId);
  if (!object) throw new Error("Choose an object.");

  if (message.op === "ADD_FILE_SOURCE") {
    if (!isRecord(message.file)) throw new Error("Invalid file source.");
    const file = createRemoteFileSourceCandidate(
      String(message.file.url ?? ""),
      String(message.file.sourcePageUrl ?? ""),
      typeof message.file.name === "string" ? message.file.name : undefined,
    );
    const sources = (state.fileSources ||= []);
    if (
      sources.some(
        (source) => source.objectId === object.id && source.url === file.url,
      )
    ) {
      throw new Error("This file source is already attached to the object.");
    }
    sources.push({
      id: crypto.randomUUID(),
      objectId: object.id,
      fileType: file.fileType,
      url: file.url,
      name: file.name,
      sourcePageUrl: file.sourcePageUrl,
      addedAt: now,
    });
  } else if (message.op === "UPDATE_FILE_SOURCE") {
    if (typeof message.sourceId !== "string") {
      throw new Error("Source id is required.");
    }
    const source = (state.fileSources ?? []).find(
      (entry) =>
        entry.id === message.sourceId &&
        entry.objectId === object.id,
    );
    if (!source) throw new Error("File source not found.");
    if (!isRecord(message.metadata)) {
      throw new Error("Invalid file metadata.");
    }

    const mutableSource = source as unknown as Record<string, unknown>;
    const changedFields = new Set<string>();

    const setOptionalText = (
      field: "display_name" | "intended_use",
      maxLength = 5000,
    ) => {
      if (!Object.prototype.hasOwnProperty.call(message.metadata, field)) return;
      const raw = message.metadata[field];
      const next =
        raw === undefined || raw === null || String(raw).trim() === ""
          ? undefined
          : String(raw).replace(/\s+/g, " ").trim();
      if (next !== undefined && next.length > maxLength) {
        throw new Error(`File metadata field ${field} is too long.`);
      }
      const previous =
        typeof mutableSource[field] === "string"
          ? String(mutableSource[field])
          : undefined;
      if (previous !== next) changedFields.add(field);
      if (next === undefined) delete mutableSource[field];
      else mutableSource[field] = next;
    };

    const setOptionalEnum = (
      field: "purpose" | "client_requirement" | "signature_requirement",
      validator: (value: unknown) => boolean,
    ) => {
      if (!Object.prototype.hasOwnProperty.call(message.metadata, field)) return;
      const raw = message.metadata[field];
      const next =
        raw === undefined || raw === null || String(raw).trim() === ""
          ? undefined
          : String(raw).trim();
      const previous =
        typeof mutableSource[field] === "string"
          ? String(mutableSource[field])
          : undefined;
      if (
        next !== undefined &&
        !validator(next) &&
        next !== previous
      ) {
        throw new Error(`Unsupported value for file metadata field ${field}: ${next}`);
      }
      if (previous !== next) changedFields.add(field);
      if (next === undefined) delete mutableSource[field];
      else mutableSource[field] = next;
    };

    setOptionalText("display_name", 500);
    setOptionalText("intended_use", 5000);
    setOptionalEnum("purpose", isFilePurpose);
    setOptionalEnum("client_requirement", isFileClientRequirement);
    setOptionalEnum("signature_requirement", isFileSignatureRequirement);

    const hasFields = message.metadata.has_fields;
    let nextHasFields: boolean | undefined;
    if (hasFields === undefined || hasFields === null || hasFields === "") {
      nextHasFields = undefined;
    } else if (typeof hasFields === "boolean") {
      nextHasFields = hasFields;
    } else {
      throw new Error("has_fields must be true, false or unset.");
    }
    if (source.has_fields !== nextHasFields) changedFields.add("has_fields");
    if (nextHasFields === undefined) delete source.has_fields;
    else source.has_fields = nextHasFields;

    if (changedFields.size) {
      state.importTargetEvidence = (state.importTargetEvidence ?? []).filter(
        (entry) =>
          !(
            entry.objectId === object.id &&
            entry.target?.kind === "file_source" &&
            String(entry.target.id) === source.id &&
            changedFields.has(entry.field)
          ),
      );
    }
  } else if (message.op === "REMOVE_FILE_SOURCE") {
    if (typeof message.sourceId !== "string") throw new Error("Source id is required.");
    const sourceId = message.sourceId;
    const before = state.fileSources?.length ?? 0;
    state.fileSources = (state.fileSources ?? []).filter(
      (source) => !(source.id === sourceId && source.objectId === object.id),
    );
    if (state.fileSources.length === before) throw new Error("File source not found.");

    state.rules = state.rules.filter(
      (rule) =>
        !(
          rule.objectId === object.id &&
          rule.extraction.type === "pdfText" &&
          rule.extraction.sourceId === sourceId
        ),
    );
    state.importTargetEvidence = (state.importTargetEvidence ?? []).filter(
      (entry) =>
        !(
          entry.objectId === object.id &&
          entry.target?.kind === "file_source" &&
          String(entry.target.id) === sourceId
        ),
    );
  } else {
    throw new Error("Unknown file source operation.");
  }

  object.updatedAt = now;
  state.revision++;
  return state;
}

async function registerMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: "burbot-create",
    title: "Create Burbot object",
    contexts: ["selection"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });

  for (const objectType of CREATE_TYPES) {
    browser.contextMenus.create({
      id: `burbot-create-${objectType}`,
      parentId: "burbot-create",
      title: BurbotSchema[objectType].label,
      contexts: ["selection"],
    });
  }
}

browser.runtime.onInstalled.addListener(() => void registerMenus().catch(console.error));
browser.runtime.onStartup.addListener(() => void registerMenus().catch(console.error));

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
  if (!next || !Array.isArray(next.objects) || !Array.isArray(next.rules)) return;
  queueSelectorHighlightSync(next);
});

browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" && !change.url) return;
  void syncSelectorHighlightsForTab(
    tabId,
    change.url ?? tab.url,
  ).catch(() => undefined);
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  void syncSelectorHighlightsForTab(tabId).catch(() => undefined);
});

void browser.storage.local
  .get(STORAGE_KEY)
  .then((stored) => {
    const next = stored[STORAGE_KEY] as LegacyStorageState | undefined;
    if (next && Array.isArray(next.objects) && Array.isArray(next.rules)) {
      queueSelectorHighlightSync(next);
    }
  })
  .catch(() => undefined);

async function captureInitialSelection(
  info: SelectionContextInfo,
  tab: SelectionTab,
): Promise<CapturedExtractionInput | null> {
  if (info.frameId && info.frameId !== 0) return null;
  if (tab.id === undefined) return null;

  const tabId = tab.id;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const capture = (async (): Promise<CapturedExtractionInput | null> => {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    const result: unknown = await browser.tabs.sendMessage(
      tabId,
      { type: "BURBOT_SELECTION" },
      { frameId: 0 },
    );

    if (!isPickerSelectionResponse(result) || !result.ok) return null;

    const option = result.value.options.find(
      (entry) => entry.extraction.type === "selection",
    );

    if (
      !option ||
      BurbotCore.clean(option.raw) !== BurbotCore.clean(info.selectionText)
    ) {
      return null;
    }

    const candidate = createCapturedExtractionInput(result.value, option);
    const expectedUrl = info.frameUrl ?? info.pageUrl ?? tab.url;
    return candidate.pageUrl === expectedUrl ? candidate : null;
  })().catch(() => null);

  try {
    return await Promise.race([
      capture,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2500);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function captureCurrentSelection(tabId: number): Promise<{
  text: string;
  candidate: CapturedExtractionInput;
  pageUrl: string;
} | null> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  const result: unknown = await browser.tabs.sendMessage(
    tabId,
    { type: "BURBOT_SELECTION" },
    { frameId: 0 },
  );
  if (!isPickerSelectionResponse(result) || !result.ok) return null;
  const option = result.value.options.find(
    (entry) => entry.extraction.type === "selection" && BurbotCore.clean(entry.raw),
  );
  if (!option) return null;
  const candidate = createCapturedExtractionInput(result.value, option);
  return {
    text: option.raw,
    candidate,
    pageUrl: candidate.pageUrl,
  };
}

async function createObjectInDraft(
  draft: DraftCommit,
  objectType: CreateObjectType,
  initialValue: string,
  sourceUrl: string,
  candidate: CapturedExtractionInput | null,
): Promise<LegacyStorageState> {
  const next = BurbotCore.mutate(
    draft.workingState,
    {
      op: "CREATE_FROM_SELECTION",
      expectedRevision: draft.workingState.revision,
      objectType,
      initialValue,
      sourceUrl,
      candidate,
    },
    () => crypto.randomUUID(),
    new Date().toISOString(),
  );
  return saveDraftState(draft, next);
}

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;

  const objectType = String(info.menuItemId).replace(/^burbot-create-/, "");
  const selectionText = info.selectionText ?? "";
  const sourceUrl = info.frameUrl ?? info.pageUrl ?? tab.url;

  if (
    !isCreateObjectType(objectType) ||
    tab.id === undefined ||
    tab.windowId === undefined ||
    !sourceUrl ||
    !BurbotCore.clean(selectionText)
  ) {
    return;
  }

  const tabId = tab.id;
  const windowId = tab.windowId;
  const opening = browser.sidebarAction.open().catch(console.error);
  const captured = captureInitialSelection(info, tab);

  void enqueue(async () => {
    const draft = await ensureDraft();
    const candidate = await captured;
    const next = await createObjectInDraft(
      draft,
      objectType,
      selectionText,
      sourceUrl,
      candidate,
    );
    const object = next.objects[next.objects.length - 1];
    await focusCreatedObject(
      windowId,
      tabId,
      object.id,
      next,
      object.creationNote ??
        "Obiekt został dodany do View i ustawiony jako aktywny. Uzupełnij dane, a potem dodaj go do Commit.",
    );
    await opening;
  }).catch((error: unknown) => {
    void focus(windowId, {
      error: errorMessage(error),
      stamp: crypto.randomUUID(),
    }).catch(console.error);
  });
});

browser.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined) return;

  void browser.sidebarAction
    .open()
    .then(() => broadcast({ type: "BURBOT_CONNECT", windowId: tab.windowId }))
    .catch(console.error);
});

browser.commands.onCommand.addListener((command) => {
  if (command !== "toggle-file-add-mode") return;

  // Call open() synchronously inside the command user gesture. Awaiting a tab
  // lookup first can cause Firefox to reject sidebarAction.open().
  const opening = browser.sidebarAction.open();

  void (async () => {
    await opening;
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || tab.windowId === undefined) return;

    // A newly-opened sidepanel initializes asynchronously. Repeat the same
    // stamped toggle briefly; the panel de-duplicates the stamp, while a panel
    // that was not listening to the first broadcast can still receive a retry.
    const stamp = crypto.randomUUID();
    await browser.storage.session.set({
      [`burbot:file-mode-toggle:${tab.windowId}`]: {
        stamp,
        createdAt: Date.now(),
      },
    });
    for (const delay of [0, 120, 400]) {
      if (delay) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      await broadcast({
        type: "BURBOT_TOGGLE_FILE_MODE",
        windowId: tab.windowId,
        stamp,
      });
    }
  })().catch(console.error);
});

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const extensionRoot = browser.runtime.getURL("");
  if (
    sender.id !== browser.runtime.id ||
    !sender.url?.startsWith(extensionRoot) ||
    !isRecord(message)
  ) {
    return undefined;
  }

  if (message.type === "BURBOT_COMMIT") {
    const task = enqueue(async () => {
      if (message.op === "GET") {
        return commitSessionView(await readActiveDraft());
      }

      if (message.op === "NEW") {
        if (await readActiveDraft()) {
          throw new Error("A working View is already active.");
        }
        return commitSessionView(await ensureDraft());
      }

      if (message.op === "STAGE_OBJECT") {
        const draft = await requireDraft();
        if (typeof message.objectId !== "string") {
          throw new Error("Object id is required.");
        }
        if (!changedObjectIds(draft).includes(message.objectId)) {
          throw new Error("Ten obiekt nie ma zmian do dodania do Commit.");
        }
        stageObject(draft, message.objectId);
        draft.updatedAt = new Date().toISOString();
        await writeActiveDraft(draft);
        await notifyCommitChanged();
        return commitSessionView(draft);
      }

      if (message.op === "UNSTAGE_OBJECT") {
        const draft = await requireDraft();
        if (typeof message.objectId !== "string") {
          throw new Error("Object id is required.");
        }
        unstageObject(draft, message.objectId);
        draft.updatedAt = new Date().toISOString();
        await writeActiveDraft(draft);
        await notifyCommitChanged();
        return commitSessionView(draft);
      }

      if (message.op === "DISCARD_OBJECT") {
        const draft = await requireDraft();
        if (typeof message.objectId !== "string") {
          throw new Error("Object id is required.");
        }
        discardViewObject(draft, message.objectId);
        draft.updatedAt = new Date().toISOString();
        await writeActiveDraft(draft);
        await publishUiState(draft.workingState);
        queueSelectorHighlightSync(draft.workingState);
        await notifyCommitChanged();
        return commitSessionView(draft);
      }

      if (message.op === "COMMIT") {
        const draft = await requireDraft();
        if (!(draft.stagedObjectIds ?? []).length) {
          throw new Error("Nie ma obiektów dodanych do commita.");
        }

        const stagedObjectIds = [...draft.stagedObjectIds];
        const candidate = applyStagedObjects(draft);
        validateCommittedReferences(candidate);
        const committed = await commitState(draft.baseRevision, candidate);

        rebaseCommittedObjects(draft, committed, stagedObjectIds);
        draft.baseRevision = committed.revision;
        draft.baseState = cloneState(committed);
        draft.stagedObjectIds = [];
        draft.updatedAt = new Date().toISOString();

        if (hasViewChanges(draft)) {
          await writeActiveDraft(draft);
          await publishUiState(draft.workingState);
          queueSelectorHighlightSync(draft.workingState);
          await notifyCommitChanged();
          return { session: commitSessionView(draft), state: committed };
        }

        await clearActiveDraft();
        await publishUiState(committed);
        queueSelectorHighlightSync(committed);
        await notifyCommitChanged();
        return { session: commitSessionView(null), state: committed };
      }

      if (message.op === "DISCARD") {
        await requireDraft();
        await clearActiveDraft();
        const committed = await loadState();
        await publishUiState(committed);
        queueSelectorHighlightSync(committed);
        await notifyCommitChanged();
        return { session: commitSessionView(null), state: committed };
      }

      if (message.op === "FOCUS") {
        if (typeof message.windowId !== "number" || typeof message.objectId !== "string") {
          throw new Error("Window and object are required.");
        }
        const state = await workspaceState();
        if (!state.objects.some((object) => object.id === message.objectId)) {
          throw new Error("Object not found in the active workspace.");
        }
        await focus(message.windowId, {
          objectId: message.objectId,
          stamp: crypto.randomUUID(),
        });
        return commitSessionView(await readActiveDraft());
      }

      if (message.op === "CREATE_OBJECT") {
        const objectType = String(message.objectType ?? "");
        if (!isCreateObjectType(objectType) || typeof message.windowId !== "number") {
          throw new Error("Choose a valid object type.");
        }
        const draft = await ensureDraft();
        const tabs = await browser.tabs.query({
          active: true,
          windowId: message.windowId,
        });
        const tab = tabs[0];
        if (
          !tab ||
          tab.id === undefined ||
          !tab.url ||
          (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))
        ) {
          throw new Error("Open a webpage and select the object name first.");
        }
        const tabId = tab.id;
        const selection = await captureCurrentSelection(tabId);
        if (!selection || !BurbotCore.clean(selection.text)) {
          throw new Error("Select the new object name on the webpage first.");
        }
        const next = await createObjectInDraft(
          draft,
          objectType,
          selection.text,
          selection.pageUrl,
          selection.candidate,
        );
        const object = next.objects[next.objects.length - 1];
        await focusCreatedObject(
          message.windowId,
          tabId,
          object.id,
          next,
          "Nowy obiekt został dodany do View i ustawiony jako aktywny. Dodaj go do Commit, gdy będzie gotowy.",
        );
        return commitSessionView(await readActiveDraft());
      }

      throw new Error("Unknown commit operation.");
    });

    return task.then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error: errorMessage(error) }),
    );
  }

  if (message.type !== "BURBOT_DATA") return undefined;

  const task = enqueue(async () => {
    if (message.op === "GET_FOCUS") {
      if (typeof message.windowId !== "number") {
        throw new Error("Window id is required.");
      }

      const key = focusKey(message.windowId);
      return (await browser.storage.session.get(key))[key] ?? null;
    }

    if (message.op === "GET") return workspaceState();

    if (typeof message.op !== "string" || !ALLOWED_WRITES.has(message.op)) {
      throw new Error(
        "Create objects by selecting a name on the webpage and using its context menu.",
      );
    }

    const draft = await ensureDraft();
    const state = draft.workingState;
    const now = new Date().toISOString();
    let next: LegacyStorageState;
    if (message.op === "IMPORT") {
      next = importDocumentIntoState(
        state,
        message.document,
        message.expectedRevision,
        () => crypto.randomUUID(),
        now,
      );
    } else if (
      message.op === "ADD_FILE_SOURCE" ||
      message.op === "UPDATE_FILE_SOURCE" ||
      message.op === "REMOVE_FILE_SOURCE"
    ) {
      next = mutateFileSource(state, message, now);
    } else if (message.op === "ASSIGN_PDF") {
      next = assignPdfRuleIntoState(
        state,
        message as unknown as AssignPdfRuleMessage,
        () => crypto.randomUUID(),
        now,
      );
    } else {
      next = BurbotCore.mutate(
        state,
        message,
        () => crypto.randomUUID(),
        now,
      );
      if (message.op === "DELETE" && typeof message.objectId === "string") {
        next.fileSources = (next.fileSources ?? []).filter(
          (source) => source.objectId !== message.objectId,
        );
      }
      discardStaleImportedEvidence(next, state, message);
    }
    return saveDraftState(draft, next);
  });

  return task.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error: errorMessage(error) }),
  );
});
