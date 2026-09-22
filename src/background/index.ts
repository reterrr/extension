import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import { commitState, loadState, publishUiState } from "../shared/api/storage";
import {
  clearActiveDraft,
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import { discardObjectChanges } from "../shared/commits/discardObject";
import { commitSessionView } from "../shared/commits/session";
import { createCapturedExtractionInput } from "../shared/extraction/rules";
import { discardStaleImportedEvidence } from "../shared/import/evidence";
import { importDocumentIntoState } from "../shared/import/format";
import {
  markStagedImportObjectsCommitted,
  returnAllStagedImportObjectsToView,
  returnStagedImportObjectToView,
} from "../shared/import/review";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import { isPickerSelectionResponse } from "../shared/messaging/picker";
import {
  assignPdfRuleIntoState,
  type AssignPdfRuleMessage,
} from "../shared/pdf/assignPdfRule";
import { createRemotePdfSourceCandidate } from "../shared/sources/remoteFile";
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

async function broadcast(message: Record<string, unknown>): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}

async function focus(windowId: number, value: FocusPayload): Promise<void> {
  await browser.storage.session.set({ [focusKey(windowId)]: value });
  await broadcast({ type: "BURBOT_FOCUS", windowId, ...value });
}

async function notifyCommitChanged(): Promise<void> {
  await broadcast({ type: "BURBOT_COMMIT_CHANGED" });
}

async function workspaceState(): Promise<LegacyStorageState> {
  const draft = await readActiveDraft();
  if (draft) return draft.workingState;
  return loadState();
}

async function requireDraft(): Promise<DraftCommit> {
  const draft = await readActiveDraft();
  if (!draft) {
    throw new Error('Start with "New commit" before changing objects.');
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
    const file = createRemotePdfSourceCandidate(
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
      throw new Error("This PDF source is already attached to the object.");
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
    const draft = await requireDraft();
    const candidate = await captured;
    const next = await createObjectInDraft(
      draft,
      objectType,
      selectionText,
      sourceUrl,
      candidate,
    );
    const object = next.objects[next.objects.length - 1];
    await focus(windowId, {
      objectId: object.id,
      tabId,
      stamp: crypto.randomUUID(),
      note:
        object.creationNote ??
        "Object staged in the active commit. Choose the next field to capture.",
    });
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

      if (message.op === "ENSURE") {
        const existing = await readActiveDraft();
        if (existing) return commitSessionView(existing);
        const baseState = await loadState();
        const now = new Date().toISOString();
        const draft: DraftCommit = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          baseRevision: baseState.revision,
          baseState: cloneState(baseState),
          workingState: cloneState(baseState),
        };
        await writeActiveDraft(draft);
        await publishUiState(draft.workingState);
        await notifyCommitChanged();
        return commitSessionView(draft);
      }

      if (message.op === "NEW") {
        if (await readActiveDraft()) {
          throw new Error("A commit is already in progress.");
        }
        const baseState = await loadState();
        const now = new Date().toISOString();
        const draft: DraftCommit = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          baseRevision: baseState.revision,
          baseState: cloneState(baseState),
          workingState: cloneState(baseState),
        };
        await writeActiveDraft(draft);
        await publishUiState(draft.workingState);
        await notifyCommitChanged();
        return commitSessionView(draft);
      }

      if (message.op === "COMMIT") {
        const draft = await requireDraft();
        if (JSON.stringify(draft.baseState) === JSON.stringify(draft.workingState)) {
          throw new Error("There are no staged changes to commit.");
        }
        const committed = await commitState(draft.baseRevision, draft.workingState);
        await clearActiveDraft();

        try {
          const now = new Date().toISOString();
          const review = await readImportReview();
          if (review && markStagedImportObjectsCommitted(review, now) > 0) {
            await writeImportReview(review);
            await broadcast({ type: "BURBOT_IMPORT_REVIEW_CHANGED" });
          }
        } catch (cause) {
          console.warn(
            "SQLite commit succeeded, but import review status could not be finalized.",
            cause,
          );
        }

        await notifyCommitChanged();
        return { session: commitSessionView(null), state: committed };
      }

      if (message.op === "DISCARD_OBJECT") {
        if (typeof message.objectId !== "string" || !message.objectId) {
          throw new Error("Object id is required.");
        }
        const draft = await requireDraft();
        const now = new Date().toISOString();
        const next = discardObjectChanges(draft, message.objectId, now);
        await writeActiveDraft(next);
        await publishUiState(next.workingState);

        const review = await readImportReview();
        if (
          review &&
          returnStagedImportObjectToView(review, message.objectId, now)
        ) {
          await writeImportReview(review);
          await broadcast({ type: "BURBOT_IMPORT_REVIEW_CHANGED" });
        }

        await notifyCommitChanged();
        return commitSessionView(next);
      }

      if (message.op === "DISCARD") {
        await requireDraft();
        const now = new Date().toISOString();
        const review = await readImportReview();
        if (review && returnAllStagedImportObjectsToView(review, now) > 0) {
          await writeImportReview(review);
          await broadcast({ type: "BURBOT_IMPORT_REVIEW_CHANGED" });
        }
        await clearActiveDraft();
        const committed = await loadState();
        await publishUiState(committed);
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
        const draft = await requireDraft();
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
        await focus(message.windowId, {
          objectId: object.id,
          tabId,
          stamp: crypto.randomUUID(),
          note: "New object staged in this commit.",
        });
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

    const draft = await requireDraft();
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
