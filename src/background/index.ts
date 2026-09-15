import "../shared/domain/schema.js";
import "../shared/domain/core.js";
import { loadState, saveState } from "../shared/api/storage";
import type { FocusPayload, ObjectType } from "../shared/types/domain";

const CREATE_TYPES = ["project", "recruitment", "operator"] as const;
const ALLOWED_WRITES = new Set([
  "ASSIGN",
  "EDIT",
  "APPLY",
  "DELETE",
  "ADD_FUNDING",
  "REMOVE_FUNDING",
]);

const focusKey = (windowId: number) => `burbot:focus:${windowId}`;
let queue: Promise<unknown> = Promise.resolve();

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

async function captureInitialSelection(info: any, tab: any): Promise<any | null> {
  if (info.frameId && info.frameId !== 0) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const capture = (async () => {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
      injectImmediately: true,
    } as any);

    const result = await browser.tabs.sendMessage(
      tab.id,
      { type: "BURBOT_SELECTION" },
      { frameId: 0 },
    );
    const option = result?.value?.options?.find(
      (entry: any) => entry.extraction?.type === "selection",
    );

    if (
      !option ||
      BurbotCore.clean(option.raw) !== BurbotCore.clean(info.selectionText)
    ) {
      return null;
    }

    const candidate = {
      pageUrl: result.value.pageUrl,
      selector: result.value.selector,
      ...option,
    };

    return candidate.pageUrl === (info.frameUrl || info.pageUrl || tab.url)
      ? candidate
      : null;
  })().catch(() => null);

  try {
    return await Promise.race([
      capture,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
  const objectType = String(info.menuItemId).replace(
    /^burbot-create-/,
    "",
  ) as ObjectType;

  if (
    !CREATE_TYPES.includes(objectType as (typeof CREATE_TYPES)[number]) ||
    !tab?.id ||
    !BurbotCore.clean(info.selectionText)
  ) {
    return;
  }

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
        initialValue: info.selectionText,
        sourceUrl: info.frameUrl || info.pageUrl || tab.url,
        candidate,
      },
      () => crypto.randomUUID(),
      new Date().toISOString(),
    );

    await saveState(next);
    const object = next.objects[next.objects.length - 1];
    await focus(tab.windowId, {
      objectId: object.id,
      tabId: tab.id,
      stamp: crypto.randomUUID(),
      note:
        object.creationNote ??
        "Object created. Choose the next field to capture.",
    });
    await opening;
  }).catch((error: Error) => {
    void focus(tab.windowId, {
      error: error.message,
      stamp: crypto.randomUUID(),
    }).catch(console.error);
  });
});

browser.action.onClicked.addListener((tab: any) => {
  void browser.sidebarAction
    .open()
    .then(() => broadcast({ type: "BURBOT_CONNECT", windowId: tab.windowId }))
    .catch(console.error);
});

browser.runtime.onMessage.addListener((message: any, sender: any) => {
  if (
    sender.id !== browser.runtime.id ||
    sender.tab ||
    !sender.url?.startsWith(browser.runtime.getURL("")) ||
    message?.type !== "BURBOT_DATA"
  ) {
    return undefined;
  }

  const task = enqueue(async () => {
    if (message.op === "GET_FOCUS") {
      return (
        (await browser.storage.session.get(focusKey(message.windowId)))[
          focusKey(message.windowId)
        ] ?? null
      );
    }

    const state = await loadState();
    if (message.op === "GET") return state;

    if (!ALLOWED_WRITES.has(message.op)) {
      throw new Error(
        "Create objects by selecting a name on the webpage and using its context menu.",
      );
    }

    const next = BurbotCore.mutate(
      state,
      message,
      () => crypto.randomUUID(),
      new Date().toISOString(),
    );
    await saveState(next);
    return next;
  });

  return task.then(
    (value) => ({ ok: true, value }),
    (error: Error) => ({ ok: false, error: error.message }),
  );
});
