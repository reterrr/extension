const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const { coreContext, event, candidate, clone, root } = require("./helpers.cjs");
function harness({ initial, failCapture = false } = {}) {
  let state = initial;
  const session = {},
    menus = [],
    messages = [],
    trace = [];
  const browser = {
    storage: {
      local: {
        get: async () => (state ? { "burbot:v1": clone(state) } : {}),
        set: async (value) => {
          state = clone(value["burbot:v1"]);
        },
      },
      session: {
        get: async (key) => ({ [key]: session[key] }),
        set: async (value) => Object.assign(session, value),
      },
    },
    runtime: {
      id: "test",
      getURL: () => "moz-extension://test/",
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      sendMessage: async (message) => {
        messages.push(message);
      },
    },
    contextMenus: {
      onClicked: event(),
      removeAll: async () => {
        menus.length = 0;
      },
      create: (entry) => menus.push(entry),
    },
    sidebarAction: {
      open: () => {
        trace.push("open");
        return Promise.resolve();
      },
    },
    scripting: {
      executeScript: async () => {
        trace.push("inject");
        if (failCapture) throw Error("Restricted page");
      },
    },
    tabs: {
      sendMessage: async (id) => {
        const c = candidate(id === 2 ? "WUP" : "Generator");
        return {
          ok: true,
          value: {
            pageUrl: c.pageUrl,
            selector: c.selector,
            options: [
              { label: "Selected text", raw: c.raw, extraction: c.extraction },
            ],
          },
        };
      },
    },
    action: { onClicked: event() },
  };
  const ctx = coreContext({ browser });
  vm.runInContext(
    fs.readFileSync(path.join(root, "background.js"), "utf8"),
    ctx,
  );
  const sender = { id: "test", url: "moz-extension://test/sidebar.html" };
  const data = (message) =>
    browser.runtime.onMessage.listeners[0](
      { type: "BURBOT_DATA", ...message },
      sender,
    );
  const click = (type = "project", id = 1, windowId = 10) =>
    browser.contextMenus.onClicked.emit(
      {
        menuItemId: "burbot-create-" + type,
        selectionText: id === 2 ? "WUP" : "Generator",
        pageUrl: "https://example.org/project",
        frameId: 0,
      },
      { id, windowId, url: "https://example.org/project" },
    );
  return {
    browser,
    menus,
    messages,
    trace,
    session,
    data,
    click,
    get state() {
      return state;
    },
  };
}
test("registers a selection-only parent with Project, Recruitment and Operator children", async () => {
  const h = harness();
  h.browser.runtime.onInstalled.emit();
  await new Promise(setImmediate);
  assert.equal(h.menus[0].title, "Create Burbot object");
  assert.equal(h.menus[0].contexts[0], "selection");
  assert.equal(
    h.menus
      .slice(1)
      .map((m) => m.title)
      .join(","),
    "Project,Recruitment,Operator",
  );
});
test("opens sidebar before asynchronous work and retains durable focus for a cold sidebar", async () => {
  const h = harness();
  h.click();
  const result = await h.data({ op: "GET" });
  assert.equal(h.trace[0], "open");
  assert.equal(result.value.objects[0].values.name, "Generator");
  const focus = await h.data({ op: "GET_FOCUS", windowId: 10 });
  assert.equal(focus.value.objectId, result.value.objects[0].id);
  assert.equal(focus.value.tabId, 1);
  assert.equal(h.messages.at(-1).type, "BURBOT_FOCUS");
});
test("concurrent creations serialize without losing either object and target their own windows", async () => {
  const h = harness();
  h.click("project", 1, 10);
  h.click("operator", 2, 20);
  await h.data({ op: "GET" });
  assert.equal(h.state.objects.length, 2);
  assert.equal(h.state.revision, 2);
  assert.notEqual(
    h.session["burbot:focus:10"].objectId,
    h.session["burbot:focus:20"].objectId,
  );
});
test("sidebar cannot manually create an object or impersonate a context-menu creation", async () => {
  const h = harness();
  for (const op of ["CREATE", "CREATE_FROM_SELECTION"])
    assert.equal(
      (await h.data({ op, objectType: "project", initialValue: "Bad" })).ok,
      false,
    );
  assert.equal(h.state, undefined);
});
test("missing page access creates the selected value and source without a fabricated rule", async () => {
  const h = harness({ failCapture: true });
  h.click("recruitment");
  await h.data({ op: "GET" });
  assert.equal(h.state.objects[0].values.external_number, "Generator");
  assert.equal(h.state.rules.length, 0);
  assert.ok(h.session["burbot:focus:10"].note);
});
test("read-only load preserves the complete original local snapshot", async () => {
  const initial = {
    version: 1,
    revision: 0,
    objects: [],
    rules: [],
    unknown: { keep: true },
  };
  const h = harness({ initial });
  const result = await h.data({ op: "GET" });
  assert.deepEqual(result.value, initial);
  assert.equal(h.state, initial);
});
