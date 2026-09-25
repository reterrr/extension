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
    /changes\[OBJECT_VIEW_STORAGE_KEY\][\s\S]*?refreshState\(\)/,
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
    /if \(!view \|\| !objectInView\(view, message\.objectId\)\)[\s\S]*?addToObjectView\(message\.objectId\)[\s\S]*?const focusComesFromPage = Number\.isInteger\(message\.tabId\)[\s\S]*?chooseObject\(message\.objectId, focusComesFromPage\)/,
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


test("View adoption refreshes the working draft before normalizing a newly created object", () => {
  const workspace = source("src/sidepanel/workspace.js");

  assert.match(
    workspace,
    /changes\[OBJECT_VIEW_STORAGE_KEY\][\s\S]*?const rawView = changes\[OBJECT_VIEW_STORAGE_KEY\]\.newValue[\s\S]*?data\("GET"\)[\s\S]*?normalizeObjectView\(rawView, db\.objects\)/,
  );
});


test("sidepanel feature modules use the canonical active object contract", () => {
  const workspace = source("src/sidepanel/workspace.js");
  const geography = source("src/sidepanel/geographyUi.ts");
  const files = source("src/sidepanel/fileSourcesUi.ts");
  const selectors = source("src/sidepanel/selectorHighlightsUi.ts");
  const reconnect = source("src/sidepanel/objectReconnectUi.ts");

  assert.match(
    workspace,
    /workspace\.dataset\.activeObjectId = next[\s\S]*?burbot:active-object-changed/,
  );

  for (const moduleSource of [geography, files, selectors]) {
    assert.equal(moduleSource.includes("object-options"), false);
    assert.match(
      moduleSource,
      /document\.getElementById\("workspace"\)\?\.dataset\.activeObjectId/,
    );
  }

  assert.match(
    geography,
    /observer\.observe\(\$\("workspace"\),[\s\S]*?data-active-object-id/,
  );
  assert.match(
    files,
    /observer\.observe\(\$\("workspace"\),[\s\S]*?data-active-object-id/,
  );
  assert.match(selectors, /burbot:active-object-changed/);
  assert.match(reconnect, /burbot:active-object-changed/);
});


test("opening an existing Active View object is navigation-only", () => {
  const workspace = source("src/sidepanel/workspace.js");
  const manager = source("src/sidepanel/ViewManagerPanel.tsx");

  assert.match(
    manager,
    /op: "FOCUS",[\s\S]*?windowId: currentWindow\.id,[\s\S]*?objectId,[\s\S]*?\}/,
  );
  assert.match(
    workspace,
    /const focusComesFromPage = Number\.isInteger\(message\.tabId\)[\s\S]*?chooseObject\(message\.objectId, focusComesFromPage\)/,
  );
  assert.match(
    workspace,
    /focusComesFromPage &&[\s\S]*?\(!port \|\| tabId !== message\.tabId\)[\s\S]*?await connect\(\)/,
  );
  assert.equal(
    workspace.includes("chooseObject(message.objectId, true);"),
    false,
    "Active View navigation must not auto-select a missing field",
  );
});

test("workspace render failures are contained instead of blanking the panel", () => {
  const workspace = source("src/sidepanel/workspace.js");

  assert.match(workspace, /function renderWorkspace\(\)/);
  assert.match(
    workspace,
    /function render\(\)[\s\S]*?try \{[\s\S]*?renderWorkspace\(\)[\s\S]*?catch \(error\)[\s\S]*?renderFailure\(error\)/,
  );
  assert.match(
    workspace,
    /function renderFailure\(error\)[\s\S]*?Nie udało się wyświetlić szczegółów tego obiektu/,
  );
});

test("React sidepanel has a visible crash recovery boundary", () => {
  const main = source("src/sidepanel/main.tsx");
  const boundary = source("src/sidepanel/SidepanelErrorBoundary.tsx");

  assert.match(
    main,
    /<SidepanelErrorBoundary>[\s\S]*?<App \/>[\s\S]*?<\/SidepanelErrorBoundary>/,
  );
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Odśwież Burbot/);
  assert.match(boundary, /Dane nie zostały usunięte/);
});


test("files replace the predefined document catalog in the workspace", () => {
  const app = source("src/sidepanel/App.tsx");
  const workspace = source("src/sidepanel/workspace.js");
  const files = source("src/sidepanel/fileSourcesUi.ts");
  const background = source("src/background/index.ts");

  assert.equal(app.includes('id="documents-panel"'), false);
  assert.equal(app.includes('id="documents-section"'), false);
  assert.equal(workspace.includes("renderDocuments(object)"), false);

  for (const label of [
    "Rodzaj",
    "Cel",
    "Zawiera pola?",
    "Przeznaczenie",
    "Wymagalność dla klienta",
    "Podpis",
    "Sposób dostarczenia",
  ]) {
    assert.ok(files.includes(label), `missing file classification label: ${label}`);
  }

  assert.match(files, /UPDATE_FILE_SOURCE/);
  assert.match(background, /message\.op === "UPDATE_FILE_SOURCE"/);
  assert.match(files, /Do oznaczenia/);
});

test("file display name comes from the actual PDF filename", () => {
  const remote = source("src/shared/sources/remoteFile.ts");

  assert.match(remote, /name: decodedFileName\(url\)\.slice\(0, 500\)/);
  assert.equal(remote.includes("cleanHint || decodedFileName"), false);
});


test("Import Review colors are derived from concrete evidence entries", () => {
  const review = source("src/sidepanel/ImportReviewPanel.tsx");
  const palette = source("src/shared/selectorPalette.ts");

  assert.equal(
    review.includes("evidenceColorKey(view, field.field)"),
    false,
    "the whole ImportReviewView must never be passed as an evidence color key",
  );
  assert.match(
    review,
    /const color = evidence\[0\][\s\S]*?selectorColor\(evidenceColorKey\(evidence\[0\]\)\)/,
  );
  assert.match(
    palette,
    /const text = String\(value \?\? ""\)[\s\S]*?text\.length/,
  );
});


test("workspace advertises supported file extensions and keeps value extraction PDF-only", () => {
  const app = source("src/sidepanel/App.tsx");
  const files = source("src/sidepanel/fileSourcesUi.ts");

  for (const extension of [".doc", ".docx", ".pdf", ".xlsx", ".png", ".jpg", ".jpeg"]) {
    assert.ok(app.includes(extension), `missing supported file extension: ${extension}`);
  }
  assert.match(files, /source\.fileType === "PDF"[\s\S]*?Wydziel wartości/);
});


test("File Add Mode is persistent and has Ctrl+Alt+F toggle", () => {
  const files = source("src/sidepanel/fileSourcesUi.ts");
  const picker = source("src/content/picker.ts");
  const background = source("src/background/index.ts");
  const manifest = JSON.parse(source("manifest.json"));

  assert.equal(
    manifest.commands?.["toggle-file-add-mode"]?.suggested_key?.default,
    "Ctrl+Alt+F",
  );
  assert.match(
    background,
    /browser\.commands\.onCommand\.addListener[\s\S]*?toggle-file-add-mode[\s\S]*?BURBOT_TOGGLE_FILE_MODE/,
  );

  assert.match(files, /let fileModeEnabled = false/);
  assert.match(
    files,
    /async function toggleFileMode\(\)[\s\S]*?fileModeEnabled[\s\S]*?disableFileMode[\s\S]*?enableFileMode/,
  );
  assert.match(
    files,
    /Dodano plik:[\s\S]*?File Add Mode nadal jest aktywny/,
  );
  assert.match(
    files,
    /browser\.tabs\.onActivated\.addListener[\s\S]*?reconnectFileMode/,
  );
  assert.match(
    files,
    /change\.status !== "loading"[\s\S]*?change\.status !== "complete"/,
  );

  const fileCaptureBlock = picker.match(
    /if \(filePicking\) \{[\s\S]*?send\(\{ event: "FILE_CAPTURE", file \}\);[\s\S]*?return;/,
  )?.[0] ?? "";
  assert.ok(fileCaptureBlock.includes('send({ event: "FILE_CAPTURE", file });'));
  assert.equal(
    fileCaptureBlock.includes("stop();"),
    false,
    "capturing a file must not stop persistent File Add Mode",
  );
});


test("File Add Mode internal restart does not emit a false exit and attached files have quick delete", () => {
  const picker = source("src/content/picker.ts");
  const files = source("src/sidepanel/fileSourcesUi.ts");
  const styles = source("src/sidepanel/fileSourceStyles.ts");

  assert.match(
    picker,
    /function stop\(notifyMode = true\)[\s\S]*?if \(notifyMode && wasInteractive\)[\s\S]*?MODE/,
  );
  assert.match(
    picker,
    /function start\(fileMode: boolean\)[\s\S]*?stop\(false\)[\s\S]*?picking = true/,
  );
  assert.match(
    picker,
    /if \(filePicking\)[\s\S]*?isRemoteSupportedFileUrl\(link\.href\)[\s\S]*?#2f7659/,
  );

  assert.match(files, /file-source-quick-remove/);
  assert.match(files, /async function removeFileSource/);
  assert.match(files, /REMOVE_FILE_SOURCE/);
  assert.match(styles, /\.file-source-quick-remove/);
});
