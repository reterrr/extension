import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import { loadState, saveState } from "../shared/api/storage";
import { createCapturedExtractionInput } from "../shared/extraction/rules";
import { discardStaleImportedEvidence } from "../shared/import/evidence";
import { importDocumentIntoState } from "../shared/import/format";
import { isPickerSelectionResponse } from "../shared/messaging/picker";
import { assignPdfRuleIntoState } from "../shared/pdf/assignPdfRule";
import type { FocusPayload } from "../shared/types/domain";
import type { CapturedExtractionInput } from "../shared/types/extraction";

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
  "ADD_FUNDING",
  "REMOVE_FUNDING",
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

async function broadcast(message: Record<string, unknown>): Promise<void> {
  await browser.runtime.sendMessage(message).catch(() => undefined);
}

async function focus(windowId: number, value: FocusPayload): Promise<void> {
  await browser.storage.session.set({ [focusKey(windowId)]: value });
  await broadcast({ type: "BURBOT_FOCUS", windowId, ...value });
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

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;

  const objectType = String(info.menuItemId).replace(/^burbot-create-/, "");
  const selectionText = info.selectionText;
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
    const candidate = await captured;
    const state = await loadState();
    const next = BurbotCore.mutate(
      state,
      {
        op: "CREATE_FROM_SELECTION",
        expectedRevision: state.revision,
        objectType,
        initialValue: selectionText,
        sourceUrl,
        candidate,
      },
      () => crypto.randomUUID(),
      new Date().toISOString(),
    );

    await saveState(next);
    const object = next.objects[next.objects.length - 1];
    await focus(windowId, {
      objectId: object.id,
      tabId,
      stamp: crypto.randomUUID(),
      note:
        object.creationNote ??
        "Object created. Choose the next field to capture.",
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
  if (
    sender.id !== browser.runtime.id ||
    sender.tab ||
    !sender.url?.startsWith(browser.runtime.getURL("")) ||
    !isRecord(message) ||
    message.type !== "BURBOT_DATA"
  ) {
    return undefined;
  }

  const task = enqueue(async () => {
    if (message.op === "GET_FOCUS") {
      if (typeof message.windowId !== "number") {
        throw new Error("Window id is required.");
      }

      const key = focusKey(message.windowId);
      return (await browser.storage.session.get(key))[key] ?? null;
    }

    const state = await loadState();
    if (message.op === "GET") return state;

    if (typeof message.op !== "string" || !ALLOWED_WRITES.has(message.op)) {
      throw new Error(
        "Create objects by selecting a name on the webpage and using its context menu.",
      );
    }

    const now = new Date().toISOString();
    let next;
    if (message.op === "IMPORT") {
      next = importDocumentIntoState(
        state,
        message.document,
        message.expectedRevision,
        () => crypto.randomUUID(),
        now,
      );
    } else if (message.op === "ASSIGN_PDF") {
      next = assignPdfRuleIntoState(
        state,
        message as never,
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
      discardStaleImportedEvidence(next, state, message);
    }
    await saveState(next);
    return next;
  });

  return task.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error: errorMessage(error) }),
  );
});
