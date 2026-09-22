import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let moduleUnderTest;
let sessionStore;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-ui-session-"));
  await build({
    absWorkingDir: root,
    entryPoints: { uiSessionState: "src/sidepanel/uiSessionState.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  sessionStore = new Map();
  globalThis.browser = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStore.get(key) };
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) {
            sessionStore.set(key, structuredClone(value));
          }
        },
      },
    },
  };

  moduleUnderTest = await import(
    pathToFileURL(join(outputDir, "uiSessionState.js")).href
  );
});

after(async () => {
  delete globalThis.browser;
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("UI state normalization is conservative and session-scoped", () => {
  const normalized = moduleUnderTest.normalizeSidepanelUiState({
    mode: "review",
    scroll: { workspace: -10, review: 420.5 },
    workspace: {
      objectId: "project-1",
      focusStamp: "focus-1",
      active: {
        objectId: "project-1",
        field: "status",
        target: { kind: "funding", id: "funding-1" },
      },
      expanded: ["funding:1", "funding:1", 42],
      fieldSections: { Dane: true, Broken: "yes" },
      fundingSize: "Mikro",
      captureCollapsed: true,
      panels: { "funding-panel": true, bad: "yes" },
      geography: {
        role: "WYKLUCZA",
        type: "POWIAT",
        query: "tarnogórski",
        addOpen: true,
      },
      switcher: {
        query: "status:AKTYWNY",
        type: "project",
        scrollTop: 85,
      },
    },
  });

  assert.equal(normalized.mode, "import");
  assert.deepEqual(normalized.scroll, {
    commit: 0,
    view: 0,
    import: 420.5,
  });
  assert.equal(normalized.workspace.objectId, "project-1");
  assert.equal(normalized.workspace.focusStamp, "focus-1");
  assert.deepEqual(normalized.workspace.expanded, ["funding:1"]);
  assert.deepEqual(normalized.workspace.fieldSections, { Dane: true });
  assert.deepEqual(normalized.workspace.panels, { "funding-panel": true });
  assert.deepEqual(normalized.workspace.geography, {
    role: "WYKLUCZA",
    type: "POWIAT",
    query: "tarnogórski",
    addOpen: true,
  });
  assert.equal(normalized.workspace.captureCollapsed, true);
  assert.equal(normalized.workspace.switcher.query, "status:AKTYWNY");
  assert.equal(normalized.workspace.switcher.scrollTop, 85);
});

test("independent UI patches merge instead of clobbering remembered state", async () => {
  await moduleUnderTest.patchSidepanelUiState(7, {
    mode: "commit",
    scroll: { view: 310 },
    workspace: {
      objectId: "recruitment-1",
      focusStamp: "focus-7",
      active: {
        objectId: "recruitment-1",
        field: "status",
      },
      expanded: ["funding:abc"],
      switcher: {
        query: "woj:/^śląskie$/i",
        type: "project",
        scrollTop: 144,
      },
    },
  });

  await moduleUnderTest.patchSidepanelUiState(7, {
    scroll: { import: 912 },
    workspace: {
      fieldSections: { Terminy: false },
      panels: { "geography-panel": true },
      geography: {
        role: "OBEJMUJE",
        type: "MIASTO_NA_PRAWACH_POWIATU",
        query: "Katowice",
        addOpen: true,
      },
      fundingSize: "Mikro",
      captureCollapsed: true,
    },
  });

  const state = await moduleUnderTest.readSidepanelUiState(7);
  assert.equal(state.mode, "commit");
  assert.deepEqual(state.scroll, { commit: 0, view: 310, import: 912 });
  assert.equal(state.workspace.objectId, "recruitment-1");
  assert.equal(state.workspace.focusStamp, "focus-7");
  assert.equal(state.workspace.active.field, "status");
  assert.deepEqual(state.workspace.expanded, ["funding:abc"]);
  assert.equal(state.workspace.fieldSections.Terminy, false);
  assert.equal(state.workspace.panels["geography-panel"], true);
  assert.deepEqual(state.workspace.geography, {
    role: "OBEJMUJE",
    type: "MIASTO_NA_PRAWACH_POWIATU",
    query: "Katowice",
    addOpen: true,
  });
  assert.equal(state.workspace.fundingSize, "Mikro");
  assert.equal(state.workspace.captureCollapsed, true);
  assert.equal(state.workspace.switcher.query, "woj:/^śląskie$/i");
  assert.equal(state.workspace.switcher.type, "project");
  assert.equal(state.workspace.switcher.scrollTop, 144);
});

test("clearing the active field does not erase other workspace preferences", async () => {
  await moduleUnderTest.patchSidepanelUiState(7, {
    workspace: {
      active: null,
      captureCollapsed: false,
    },
  });

  const state = await moduleUnderTest.readSidepanelUiState(7);
  assert.equal(state.workspace.active, null);
  assert.equal(state.workspace.captureCollapsed, false);
  assert.equal(state.workspace.objectId, "recruitment-1");
  assert.equal(state.workspace.panels["geography-panel"], true);
});


test("legacy workspace mode migrates to the View tab", () => {
  const normalized = moduleUnderTest.normalizeSidepanelUiState({
    mode: "workspace",
    scroll: { workspace: 125, review: 33 },
  });
  assert.equal(normalized.mode, "view");
  assert.deepEqual(normalized.scroll, {
    commit: 0,
    view: 125,
    import: 33,
  });
});
