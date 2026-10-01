import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { chromium } from "playwright";

test("durable drafts reuse their base and runtime updates reach both panels once", async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve(import.meta.dirname, ".."),
      contents: `
      export * from "./src/shared/commits/draftStore.ts";
      export * from "./src/shared/storage/workspaceEvents.ts";
      export { publishUiState } from "./src/shared/api/storage.ts";
    `,
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "WorkspaceTest",
    logLevel: "silent",
  });
  const browser = await chromium.launch({
    executablePath: process.env.BURBOT_CHROMIUM || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://burbot.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body></body></html>",
    }),
  );
  const pages = [];
  await context.exposeBinding(
    "sendRuntimeMessage",
    async ({ page }, message) => {
      // WebExtension messages go to other extension contexts, not their sender.
      for (const peer of pages)
        if (peer !== page)
          await peer.evaluate(
            (message) => window.deliverRuntime(message),
            message,
          );
      return { ok: true };
    },
  );
  await context.addInitScript({
    content: `
    const listeners = new Set();
    window.events = [];
    window.writes = [];
    window.browser = {
      runtime: { sendMessage: (message) => window.sendRuntimeMessage(message),
        onMessage: { addListener: (listener) => listeners.add(listener) } },
      storage: { local: { set: () => { throw new Error("Live updates must not write storage.local"); } } },
    };
    window.deliverRuntime = (message) => { for (const listener of listeners) listener(message); };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      window.writes.push(key);
      return put.call(this, value, key);
    };
    window.addEventListener("burbot:workspace-state-changed", (event) => window.events.push(event.detail));
    ${bundle.outputFiles[0].text}
    window.WorkspaceTest = WorkspaceTest;
    WorkspaceTest.initWorkspaceEvents();
    WorkspaceTest.initWorkspaceEvents();
  `,
  });
  for (let i = 0; i < 2; i++) {
    const page = await context.newPage();
    await page.goto("https://burbot.test/panel");
    pages.push(page);
  }
  const [writer, reader] = pages;
  await writer.evaluate(async () => {
    const base = {
      version: 1,
      revision: 7,
      rules: [],
      objects: [{ id: "p", type: "project", values: { name: "Było" } }],
      importSources: [
        { id: "s", snapshot: { text: "Regulamin ".repeat(100_000) } },
      ],
    };
    window.draft = {
      id: "d",
      createdAt: "now",
      updatedAt: "now",
      baseRevision: 7,
      baseState: base,
      workingState: structuredClone(base),
      stagedObjectIds: [],
    };
    await WorkspaceTest.writeActiveDraft(window.draft);
    window.draft.workingState.objects[0].values.name = "Pierwsza zmiana";
    await WorkspaceTest.writeActiveDraft(window.draft);
    await WorkspaceTest.publishUiState(window.draft.workingState);
    window.draft.workingState.objects[0].values.name = "Druga zmiana";
    await WorkspaceTest.writeActiveDraft(window.draft);
    await WorkspaceTest.publishUiState(window.draft.workingState);
  });
  for (const page of pages) {
    assert.deepEqual(
      await page.evaluate(() => window.events.map((event) => event.revision)),
      [7, 7],
    );
    assert.equal(
      await page.evaluate(
        () => window.events.at(-1).state.objects[0].values.name,
      ),
      "Druga zmiana",
    );
  }
  assert.equal(
    await writer.evaluate(
      () => window.writes.filter((key) => key.startsWith("base:")).length,
    ),
    1,
  );
  await reader.evaluate(() => {
    const previous = window.events.at(-1);
    window.deliverRuntime({
      type: WorkspaceTest.WORKSPACE_STATE_MESSAGE,
      updateId: previous.updateId,
      state: previous.state,
    });
  });
  assert.equal(await reader.evaluate(() => window.events.length), 2);
  await reader.reload();
  assert.deepEqual(
    await reader.evaluate(async () => {
      const d = await WorkspaceTest.readActiveDraft();
      return [
        d.baseState.objects[0].values.name,
        d.workingState.objects[0].values.name,
        d.workingState.revision,
      ];
    }),
    ["Było", "Druga zmiana", 7],
  );
  await writer.evaluate(async () => {
    const invalid = structuredClone(window.draft);
    invalid.baseRevision = 8;
    invalid.baseState.revision = 8;
    invalid.workingState.invalid = () => {}; // IDB structured clone must reject atomically.
    try {
      await WorkspaceTest.writeActiveDraft(invalid);
      throw new Error("Unexpected success");
    } catch (error) {
      if (error.name !== "DataCloneError") throw error;
    }
  });
  assert.equal(
    await reader.evaluate(
      async () => (await WorkspaceTest.readActiveDraft()).baseRevision,
    ),
    7,
  );
  await writer.evaluate(async () => {
    window.draft.baseRevision = 8;
    window.draft.baseState = structuredClone(window.draft.workingState);
    window.draft.baseState.revision = 8;
    await WorkspaceTest.writeActiveDraft(window.draft);
  });
  assert.equal(
    await reader.evaluate(
      async () =>
        (await WorkspaceTest.readActiveDraft()).baseState.objects[0].values
          .name,
    ),
    "Druga zmiana",
  );
  const keys = await writer.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("burbot-commits", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const keys = await new Promise((resolve) => {
      const r = db.transaction("drafts").objectStore("drafts").getAllKeys();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return keys;
  });
  assert.deepEqual(keys.sort(), ["active", "active-base", 'base:["d",8]']);
  // Compatibility with a draft saved by an earlier extension version.
  await writer.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("burbot-commits", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").clear();
      tx.objectStore("drafts").put(window.draft, "active");
      tx.oncomplete = resolve;
    });
    db.close();
    const restored = await WorkspaceTest.readActiveDraft();
    await WorkspaceTest.writeActiveDraft(restored);
  });
  assert.equal(
    await reader.evaluate(
      async () => (await WorkspaceTest.readActiveDraft()).baseRevision,
    ),
    8,
  );
  await writer.evaluate(() => WorkspaceTest.clearActiveDraft());
  assert.equal(
    await reader.evaluate(() => WorkspaceTest.readActiveDraft()),
    null,
  );
});
