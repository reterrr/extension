import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const bundle = await build({
  absWorkingDir: resolve(import.meta.dirname, ".."),
  entryPoints: ["src/background/activeTabHighlights.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { createActiveTabHighlightSync } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

async function settle() {
  for (let i = 0; i < 10; i++)
    await new Promise((resolve) => setImmediate(resolve));
}

function fixture() {
  const calls = { queries: [], reads: 0, syncs: [], cleared: [] };
  const tabs = new Map([
    [1, { id: 11, url: "https://one.test" }],
    [2, { id: 22, url: "https://two.test" }],
  ]);
  const options = {
    async activeTab(windowId) {
      calls.queries.push(windowId);
      return tabs.get(windowId);
    },
    async state() {
      calls.reads++;
      return { revision: calls.reads };
    },
    async sync(id, url, state, current) {
      if (current()) calls.syncs.push({ id, url, state });
    },
    async clear(id) {
      calls.cleared.push(id);
    },
  };
  return { tabs, options, calls };
}

test("closed workspace does no tab queries or state reads; only its active tab is synced", async () => {
  const { options, calls } = fixture();
  const sync = createActiveTabHighlightSync(options);
  sync.request();
  sync.request();
  await settle();
  assert.deepEqual(calls, { queries: [], reads: 0, syncs: [], cleared: [] });
  const close = sync.watch(1);
  await settle();
  assert.deepEqual(calls.queries, [1]);
  assert.deepEqual(
    calls.syncs.map((item) => item.id),
    [11],
  );
  assert.equal(sync.hasWindow(2), false);
  close();
  await settle();
  assert.deepEqual(calls.cleared, [11]);
  const reads = calls.reads;
  sync.request();
  await settle();
  assert.equal(calls.reads, reads);
});

test("activation clears the previous page and coalesces edits onto the new active tab", async () => {
  const { options, calls, tabs } = fixture();
  const sync = createActiveTabHighlightSync(options);
  sync.watch(1);
  await settle();
  tabs.set(1, { id: 12, url: "https://next.test" });
  for (let i = 0; i < 50; i++) sync.request();
  await settle();
  assert.deepEqual(calls.cleared, [11]);
  assert.deepEqual(
    calls.syncs.map((item) => item.id),
    [11, 12],
  );
  tabs.set(1, { id: 13, url: "about:config" });
  sync.request();
  await settle();
  assert.deepEqual(calls.cleared, [11, 12]);
  assert.equal(calls.reads, 2);
});

test("late async work is cancelled on activation and on closing the last panel", async () => {
  const { options, calls, tabs } = fixture();
  let release;
  let blocked = true;
  options.sync = async (id, url, state, current) => {
    if (blocked) {
      blocked = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    if (current()) calls.syncs.push({ id, url, state });
  };
  const sync = createActiveTabHighlightSync(options);
  const close = sync.watch(1);
  await settle();
  tabs.set(1, { id: 12, url: "https://next.test" });
  sync.request();
  release();
  await settle();
  assert.deepEqual(
    calls.syncs.map((item) => item.id),
    [12],
  );
  assert.deepEqual(calls.cleared, [11]);
  close();
  await settle();
  assert.deepEqual(calls.cleared, [11, 12]);
});

test("several panels share a window; another window is independent", async () => {
  const { options, calls } = fixture();
  const sync = createActiveTabHighlightSync(options);
  const first = sync.watch(1);
  const second = sync.watch(1);
  const other = sync.watch(2);
  await settle();
  assert.deepEqual(calls.queries.sort(), [1, 2]);
  first();
  first();
  await settle();
  assert.equal(sync.hasWindow(1), true);
  assert.deepEqual(calls.cleared, []);
  second();
  await settle();
  assert.deepEqual(calls.cleared, [11]);
  assert.equal(sync.hasWindow(2), true);
  other();
  await settle();
  assert.deepEqual(calls.cleared, [11, 22]);
});

test("actual background never injects into idle, unrelated or empty-highlight tabs", async () => {
  const background = await build({
    absWorkingDir: resolve(import.meta.dirname, ".."),
    entryPoints: ["src/background/index.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    logLevel: "silent",
  });
  const event = () => {
    const listeners = [];
    return {
      addListener: (fn) => listeners.push(fn),
      emit: (...args) => Promise.all(listeners.map((fn) => fn(...args))),
    };
  };
  const queries = [],
    injections = [],
    messages = [];
  let activeId = 11;
  const sender = {
    id: "burbot@test",
    url: "moz-extension://test/sidepanel.html",
  };
  const browser = {
    runtime: {
      id: sender.id,
      getURL: (path) => "moz-extension://test/" + path,
      onConnect: event(),
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      query: async (query) => {
        queries.push(structuredClone(query));
        assert.deepEqual(Object.keys(query).sort(), ["active", "windowId"]);
        assert.equal(query.active, true);
        return [
          {
            id: activeId,
            windowId: 1,
            active: true,
            url: activeId === 11 ? "https://one.test" : "https://other.test",
          },
        ];
      },
      sendMessage: async (id, message) => {
        messages.push({ id, message: structuredClone(message) });
        if (!injections.some((entry) => entry.target.tabId === id))
          throw new Error("No receiver");
        return { ok: true };
      },
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: event(),
    },
    contextMenus: { onClicked: event() },
    action: { onClicked: event() },
    commands: { onCommand: event() },
    scripting: {
      executeScript: async (input) => {
        injections.push(structuredClone(input));
        return [];
      },
    },
  };
  runInNewContext(background.outputFiles[0].text, {
    browser,
    console,
    URL,
    crypto,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    indexedDB: {
      open() {
        throw new Error("Unexpected draft read");
      },
    },
  });
  const state = {
    version: 1,
    revision: 1,
    objects: [{ id: "p", type: "project", values: { name: "P" } }],
    rules: [],
  };
  const publish = () =>
    browser.runtime.onMessage.emit(
      {
        type: "BURBOT_WORKSPACE_STATE_CHANGED",
        updateId: crypto.randomUUID(),
        state,
      },
      sender,
    );
  await publish();
  await settle();
  assert.deepEqual(queries, []);
  const port = {
    name: "burbot-workspace",
    sender,
    onMessage: event(),
    onDisconnect: event(),
  };
  await browser.runtime.onConnect.emit(port);
  await port.onMessage.emit({ windowId: 1 });
  await settle();
  assert.deepEqual(
    injections,
    [],
    "an empty projection must not install a runtime",
  );
  const count = queries.length;
  await browser.tabs.onUpdated.emit(
    99,
    { status: "complete" },
    { id: 99, windowId: 1, active: false, url: "https://idle.test" },
  );
  await browser.tabs.onActivated.emit({ tabId: 88, windowId: 2 });
  await settle();
  assert.equal(queries.length, count);
  state.rules.push({
    id: "r",
    objectId: "p",
    field: "name",
    pageUrl: "https://one.test",
    selector: "#title",
    extraction: { type: "text" },
  });
  await publish();
  await settle();
  assert.deepEqual(injections, [
    { target: { tabId: 11 }, files: ["selector-highlights.js"] },
  ]);
  activeId = 12;
  await browser.tabs.onActivated.emit({ tabId: 12, windowId: 1 });
  await settle();
  assert.equal(
    injections.length,
    1,
    "a new tab without matching evidence stays untouched",
  );
  assert.ok(
    messages.some(
      ({ id, message }) =>
        id === 11 &&
        message.type === "BURBOT_SHOW_SELECTOR_HIGHLIGHTS" &&
        message.highlights.length === 0,
    ),
  );
  await port.onDisconnect.emit();
  await settle();
  const closedCount = queries.length;
  await publish();
  await settle();
  assert.equal(queries.length, closedCount);
});
