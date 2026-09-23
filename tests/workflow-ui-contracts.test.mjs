import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function source(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

test("workspace DOM has no legacy second View manager", () => {
  const app = source("src/sidepanel/App.tsx");

  for (const marker of [
    'id="switcher"',
    'id="active-object-view"',
    'id="stage-object"',
    'id="remove-object-from-view"',
    'id="export-object-view"',
    'id="clear-object-view"',
  ]) {
    assert.equal(
      app.includes(marker),
      false,
      `legacy View control must not be mounted: ${marker}`,
    );
  }
});

test("workspace runtime does not bind removed legacy View controls", () => {
  const workspace = source("src/sidepanel/workspace.js");

  for (const marker of [
    'renderSwitcher();',
    '$("export-object-view").onclick',
    '$("clear-object-view").onclick',
    '$("stage-object").onclick',
    '$("remove-object-from-view").onclick',
    '$("switcher").open',
  ]) {
    assert.equal(
      workspace.includes(marker),
      false,
      `workspace must not depend on removed View control: ${marker}`,
    );
  }
});

test("first workspace write can create the hidden working draft automatically", () => {
  const background = source("src/background/index.ts");

  assert.match(
    background,
    /async function ensureDraft\(\): Promise<DraftCommit>/,
  );
  assert.match(
    background,
    /if \(message\.type !== "BURBOT_DATA"\)[\s\S]*?const draft = await ensureDraft\(\);/,
  );
});


test("View storage listener normalizes against the latest workspace state", () => {
  const manager = source("src/sidepanel/ViewManagerPanel.tsx");

  assert.match(
    manager,
    /const stateRef = useRef<LegacyStorageState>\(EMPTY_STATE\)/,
  );
  assert.match(
    manager,
    /async function refreshView\(nextState = stateRef\.current\)/,
  );
  assert.match(
    manager,
    /changes\[OBJECT_VIEW_STORAGE_KEY\][\s\S]*?refreshView\(stateRef\.current\)/,
  );
  assert.match(
    manager,
    /function applyState\(nextState: LegacyStorageState\)[\s\S]*?stateRef\.current = nextState[\s\S]*?setState\(nextState\)/,
  );
});


test("newly created objects are added to Active View and focused", () => {
  const background = source("src/background/index.ts");
  const workspace = source("src/sidepanel/workspace.js");

  assert.match(
    background,
    /async function addObjectToActiveView\([\s\S]*?addObjectToView\(/,
  );
  assert.match(
    background,
    /async function focusCreatedObject\([\s\S]*?addObjectToActiveView\(objectId, state\)[\s\S]*?await focus\(/,
  );
  assert.match(
    background,
    /browser\.contextMenus\.onClicked\.addListener[\s\S]*?const draft = await ensureDraft\(\)[\s\S]*?focusCreatedObject\(/,
  );
  assert.match(
    background,
    /message\.op === "CREATE_OBJECT"[\s\S]*?focusCreatedObject\(/,
  );
  assert.match(
    workspace,
    /if \(!view \|\| !objectInView\(view, message\.objectId\)\)[\s\S]*?addToObjectView\(message\.objectId\)[\s\S]*?chooseObject\(message\.objectId, true\)/,
  );
});


test("Active View exposes its export action", () => {
  const manager = source("src/sidepanel/ViewManagerPanel.tsx");

  assert.match(manager, /createAiViewExport/);
  assert.match(manager, /aiViewExportFilename/);
  assert.match(manager, />\s*Eksport View\s*</);
});

test("object action popover is anchored inside the header", () => {
  const styles = source("src/sidepanel/styles.css");
  const redesign = source("src/sidepanel/workspaceRedesignStyles.ts");

  assert.match(
    styles,
    /\.header-actions \{[\s\S]*?position: absolute;[\s\S]*?right: 0;/,
  );
  assert.match(
    styles,
    /#more \.popover \{[\s\S]*?right: 0;[\s\S]*?left: auto;/,
  );
  assert.match(
    redesign,
    /\.header-actions \{[\s\S]*?right: 7px;/,
  );
});


test("manual plus in View adds and activates the object", () => {
  const manager = source("src/sidepanel/ViewManagerPanel.tsx");

  assert.match(
    manager,
    /inView\s*\?\s*remove\(object\.id\)\s*:\s*openObject\(object\.id\)/,
  );
  assert.match(
    manager,
    /Kliknij \+, aby dodać do View i od razu otworzyć obiekt/,
  );
});


test("optional enum clear remains saveable in the editor", () => {
  const workspace = source("src/sidepanel/workspace.js");

  assert.match(
    workspace,
    /definition\.allowEmpty === true[\s\S]*?String\(draft \?\? ""\)\.trim\(\) === ""/,
  );
  assert.match(
    workspace,
    /clearingOptionalValue[\s\S]*?\$\("save"\)\.disabled = busy;/,
  );
  assert.match(
    workspace,
    /clearingOptionalValue[\s\S]*?capture && !clearingOptionalValue \? "ASSIGN" : "EDIT"/,
  );
});
