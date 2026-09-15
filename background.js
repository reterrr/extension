(() => {
  const KEY = "burbot:v1";
  const focusKey = (windowId) => "burbot:focus:" + windowId;
  let queue = Promise.resolve();
  function enqueue(work) {
    const task = queue.then(work);
    queue = task.catch(() => {});
    return task;
  }
  async function load() {
    const saved = (await browser.storage.local.get(KEY))[KEY];
    if (
      saved &&
      (saved.version !== 1 ||
        !Array.isArray(saved.objects) ||
        !Array.isArray(saved.rules))
    )
      throw Error("Unsupported stored data format.");
    return saved || BurbotCore.empty();
  }
  const broadcast = (message) =>
    browser.runtime.sendMessage(message).catch(() => {});
  async function focus(windowId, value) {
    await browser.storage.session.set({ [focusKey(windowId)]: value });
    await broadcast({ type: "BURBOT_FOCUS", windowId, ...value });
  }
  async function registerMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: "burbot-create",
      title: "Create Burbot object",
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
    for (const objectType of ["project", "recruitment", "operator"]) {
      browser.contextMenus.create({
        id: "burbot-create-" + objectType,
        parentId: "burbot-create",
        title: BurbotSchema[objectType].label,
        contexts: ["selection"],
      });
    }
  }
  browser.runtime.onInstalled.addListener(() => {
    void registerMenus().catch(console.error);
  });
  browser.runtime.onStartup.addListener(() => {
    void registerMenus().catch(console.error);
  });

  async function captureInitialSelection(info, tab) {
    // The current picker replays in the top document. Never manufacture an iframe rule.
    if (info.frameId && info.frameId !== 0) return null;
    let timer;
    const capture = (async () => {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["core.js", "picker.js"],
        injectImmediately: true,
      });
      const result = await browser.tabs.sendMessage(
        tab.id,
        { type: "BURBOT_SELECTION" },
        { frameId: 0 },
      );
      const option = result?.value?.options.find(
        (o) => o.extraction.type === "selection",
      );
      if (
        !option ||
        BurbotCore.clean(option.raw) !== BurbotCore.clean(info.selectionText)
      )
        return null;
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
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 2500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const objectType = String(info.menuItemId).replace(/^burbot-create-/, "");
    if (
      !["project", "recruitment", "operator"].includes(objectType) ||
      !tab?.id ||
      !BurbotCore.clean(info.selectionText)
    )
      return;
    // Firefox requires open() in the user-gesture call stack, before any await.
    const opening = browser.sidebarAction.open().catch(console.error);
    const captured = captureInitialSelection(info, tab);
    void enqueue(async () => {
      const candidate = await captured;
      const state = await load();
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
      await browser.storage.local.set({ [KEY]: next });
      const object = next.objects[next.objects.length - 1];
      await focus(tab.windowId, {
        objectId: object.id,
        tabId: tab.id,
        stamp: crypto.randomUUID(),
        note:
          object.creationNote ||
          "Object created. Choose the next field to capture.",
      });
      await opening;
    }).catch((error) => {
      void focus(tab.windowId, {
        error: error.message,
        stamp: crypto.randomUUID(),
      }).catch(console.error);
    });
  });

  browser.action.onClicked.addListener((tab) => {
    browser.sidebarAction
      .open()
      .then(() => broadcast({ type: "BURBOT_CONNECT", windowId: tab.windowId }))
      .catch(console.error);
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id !== browser.runtime.id ||
      sender.tab ||
      !sender.url?.startsWith(browser.runtime.getURL("")) ||
      message?.type !== "BURBOT_DATA"
    )
      return undefined;
    const task = enqueue(async () => {
      if (message.op === "GET_FOCUS")
        return (
          (await browser.storage.session.get(focusKey(message.windowId)))[
            focusKey(message.windowId)
          ] || null
        );
      const state = await load();
      if (message.op === "GET") return state;
      // Creation can only originate in the page's native selection menu.
      if (
        ![
          "ASSIGN",
          "EDIT",
          "APPLY",
          "DELETE",
          "ADD_FUNDING",
          "REMOVE_FUNDING",
        ].includes(message.op)
      )
        throw Error(
          "Create objects by selecting a name on the webpage and using its context menu.",
        );
      const next = BurbotCore.mutate(
        state,
        message,
        () => crypto.randomUUID(),
        new Date().toISOString(),
      );
      await browser.storage.local.set({ [KEY]: next });
      return next;
    });
    return task.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    );
  });
})();
