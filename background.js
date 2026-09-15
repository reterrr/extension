(() => {
  const KEY = "burbot:v1";
  let queue = Promise.resolve();

  async function load() {
    const saved = (await browser.storage.local.get(KEY))[KEY];

    if (saved &&
        (saved.version !== 1 ||
         !Array.isArray(saved.objects) ||
         !Array.isArray(saved.rules)))
      throw Error("Unsupported stored data format.");

    return saved || BurbotCore.empty();
  }

  browser.action.onClicked.addListener(tab => {
    browser.sidebarAction.open()
      .then(() => browser.runtime.sendMessage({
        type: "BURBOT_CONNECT",
        windowId: tab.windowId
      }))
      .catch(() => {});
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab ||
        !sender.url?.startsWith(browser.runtime.getURL("")) ||
        message?.type !== "BURBOT_DATA")
      return undefined;

    const task = queue.then(async () => {
      const state = await load();
      if (message.op === "GET") return state;

      const next = BurbotCore.mutate(
        state,
        message,
        () => crypto.randomUUID(),
        new Date().toISOString()
      );

      await browser.storage.local.set({[KEY]: next});
      return next;
    });

    queue = task.catch(() => {});

    return task.then(
      value => ({ok: true, value}),
      error => ({ok: false, error: error.message})
    );
  });
})();
