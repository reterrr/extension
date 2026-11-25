import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const config = {
  enabled: true,
  apiOrigin: "http://127.0.0.1:8000",
  storageOrigin: "http://127.0.0.1:9000",
  agentToken: "t".repeat(43),
  allowedOrigins: ["https://example.org"],
};
const settingsKey = "burbotMonitoringSettings";
const statusKey = "burbotMonitoringStatus";
const outboxKey = "burbotMonitoringOutbox";
const pageUrl = "https://example.org/monitoring";

async function load(entry) {
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
  });
  const source = bundle.outputFiles[0].text + "\n// " + crypto.randomUUID();
  return await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
}

function event() {
  const listeners = new Set();
  return {
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
    emit: (...args) => Array.from(listeners, (f) => f(...args)),
  };
}

async function until(predicate) {
  for (let i = 0; i < 120; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("The monitoring agent did not reach the expected state.");
}

test("named hosts, redirects and all returned DNS addresses must be allowed", async (t) => {
  const { publicAddress, approvalGuard } = await load(
    "src/background/monitoring-navigation.ts",
  );
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("No fetch needed to validate DNS"),
  );
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "100.64.0.7",
    "169.254.169.254",
    "172.20.1.1",
    "192.168.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:c0a8:0101::1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true);
  let addresses = ["8.8.8.8", "169.254.169.254"];
  globalThis.browser = { dns: { resolve: async () => ({ addresses }) } };
  t.after(() => {
    delete globalThis.browser;
  });
  const allowed = approvalGuard(new Set(config.allowedOrigins));
  assert.equal(await allowed(pageUrl), false);
  addresses = ["2606:4700:4700::1111"];
  assert.equal(await allowed(pageUrl), true);
  for (const target of [
    "http://example.org",
    "https://127.0.0.1",
    "https://intranet.local",
    "https://user@example.org",
    "https://elsewhere.org",
    "https://example.org/#access_token=abc",
  ]) {
    assert.equal(await allowed(target), false, target);
  }
});

test("monitoring closes its tab and removes the container after capture, timeout, cancellation and failure", async (t) => {
  const { acquire } = await load("src/background/monitoring-navigation.ts");
  const job = {
    jobId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    sourceId: 57,
    url: pageUrl,
    allowedOrigins: config.allowedOrigins,
    representation: "rendered_dom",
    selectors: [],
  };
  const artifact = { pageUrl };
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) =>
    originalTimeout(ms === 40_000 ? 30 : ms),
  );
  t.after(() => delete globalThis.browser);

  const cases = [
    [artifact, {}, null, ["remove tab 1", "context removed"]],
    [null, {}, "CAPTURE_FAILED", ["remove tab 1", "context removed"]],
    [
      artifact,
      { stall: true },
      "PAGE_TIMEOUT",
      ["remove tab 1", "context removed"],
    ],
    [artifact, {}, "CANCELLED", ["remove tab 1", "context removed"]],
    [
      artifact,
      { closeFirst: true },
      "NAVIGATION_FAILED",
      ["remove tab 1", "context removed"],
    ],
    [artifact, { contextGone: true }, null, ["remove tab 1"]],
  ];
  for (const [capture, navigation, errorCode, expectedEvents] of cases) {
    const storage = {};
    const controller = new AbortController();
    const events = [];
    globalThis.browser = browserStub(
      storage,
      capture,
      () => {
        if (errorCode === "CANCELLED") controller.abort();
      },
      { ...navigation, events },
    );
    if (errorCode)
      await assert.rejects(acquire(job, config, controller.signal), {
        code: errorCode,
      });
    else assert.equal(await acquire(job, config, controller.signal), artifact);
    assert.deepEqual(events, expectedEvents);
    assert.deepEqual(storage, {});
    assert.deepEqual(
      (await browser.tabs.query({})).map((tab) => tab.id),
      [40, 41],
    );
  }
});

test("monitoring recovery uses the persisted owner and retries partial cleanup", async (t) => {
  const {
    createMonitoringContext,
    createMonitoringTab,
    cleanupMonitoringContext,
  } = await load("src/background/monitoring-tabs.ts");
  const storage = {};
  const navigation = { events: [], failTabRemove: true };
  globalThis.browser = browserStub(storage, null, () => undefined, navigation);
  t.after(() => delete globalThis.browser);
  const { owner } = await createMonitoringContext(crypto.randomUUID());
  await createMonitoringTab(owner);
  await cleanupMonitoringContext(owner, true);
  assert.deepEqual(navigation.events, ["remove tab 1", "context removed"]);
  assert.equal(storage.burbotMonitoringContext[0].tabId, 1);
  navigation.failTabRemove = false;
  const { recoverContext } = await load("src/background/monitoring-tabs.ts");
  await recoverContext();
  assert.deepEqual(storage, {});
  assert.deepEqual(navigation.events, [
    "remove tab 1",
    "context removed",
    "remove tab 1",
  ]);
  assert.deepEqual(
    (await browser.tabs.query({})).map((tab) => tab.id),
    [40, 41],
  );
});

test("monitoring recovery preserves an unrelated tab even inside the temporary container", async (t) => {
  const { createMonitoringContext, createMonitoringTab, recoverContext } =
    await load("src/background/monitoring-tabs.ts");
  const storage = {};
  const events = [];
  globalThis.browser = browserStub(storage, null, () => undefined, {
    events,
    extraTabs: [
      { id: 40, url: "about:blank", cookieStoreId: "firefox-container-321" },
    ],
  });
  t.after(() => delete globalThis.browser);
  const { owner } = await createMonitoringContext(crypto.randomUUID());
  await createMonitoringTab(owner);
  await recoverContext();
  assert.deepEqual(events, ["remove tab 1"]);
  assert.equal((await browser.tabs.get(40)).url, "about:blank");
  assert.equal(storage.burbotMonitoringContext[0].name, owner.name);
});

test("capture signs exact sanitized DOM and executes the pinned CSS, XPath and TextQuote", async (t) => {
  t.mock.method(URLSearchParams.prototype, "keys", () => {
    throw new TypeError("Firefox content-script wrapper");
  });
  const dom = new JSDOM(
    `<html><head><script>secret-1</script></head><body>
    <p id="value">Nabór otwarty</p><span id="year">2026</span><aside data-burbot-selector-highlight>overlay</aside>
    <input type=password value="secret-2"><textarea>secret-3</textarea><a href="/?token=secret-4">link</a>
    <div contenteditable>secret-5</div><p data-auth="secret-6">Demo</p><!-- secret-7 -->
    </body></html>`,
    { url: pageUrl },
  );
  const onMessage = event();
  Object.assign(globalThis, {
    browser: { runtime: { id: "test-addon", onMessage } },
    document: dom.window.document,
    NodeFilter: dom.window.NodeFilter,
    MutationObserver: dom.window.MutationObserver,
  });
  t.after(() => {
    dom.window.close();
    for (const key of ["browser", "document", "NodeFilter", "MutationObserver"])
      delete globalThis[key];
  });
  await load("src/content/monitoring-capture.ts");
  const selectorUuid = crypto.randomUUID();
  const versionUuid = crypto.randomUUID();
  const loc = (kind, details, order = 0) => ({
    uuid: crypto.randomUUID(),
    kind,
    order,
    ...details,
  });
  const part = (locators, order = 0) => ({
    uuid: crypto.randomUUID(),
    order,
    extraction: { type: "text" },
    locators,
    ...(order > 0 ? { joinWith: " " } : {}),
  });
  const recipe = (parts, order) => ({
    uuid: crypto.randomUUID(),
    parts,
    order,
  });
  const definition = {
    uuid: versionUuid,
    selectorUuid,
    status: "active",
    versionNo: 1,
    createdAt: new Date().toISOString(),
    recipes: [
      recipe(
        [
          part([
            loc("css_path", { selector: "#value" }),
            loc("xpath", { expression: '//*[@id="value"]' }, 1),
            loc("text_quote", { quote: { exact: "Nabór otwarty" } }, 2),
          ]),
          part([loc("css_path", { selector: "#year" })], 1),
        ],
        0,
      ),
      recipe(
        [
          part([loc("css_path", { selector: "#value" })]),
          part([loc("css_path", { selector: "#year" })], 1),
        ],
        1,
      ),
    ],
  };
  const message = {
    type: "burbot:monitoring-capture",
    expectedOrigins: config.allowedOrigins,
    selectors: [
      {
        selectorUuid,
        versionUuid,
        versionNo: 1,
        definitionFingerprint: "a".repeat(64),
        definition,
      },
    ],
  };
  const [rejected] = onMessage.emit(message, { id: "other" });
  assert.equal(rejected, undefined);
  const [pending] = onMessage.emit(message, { id: "test-addon" });
  const capture = await pending;
  assert.ok(capture);
  assert.equal(capture.evaluations[0].result.rawValue, "Nabór otwarty 2026");
  const locators =
    capture.evaluations[0].result.recipeResults[0].partResults[0]
      .locatorResults;
  assert.deepEqual(
    locators.map((result) => result.status),
    ["success", "success", "success"],
  );
  assert.doesNotMatch(capture.html, /secret-[1-7]|overlay/);
  const { sha256 } = await load("src/shared/monitoring/contracts.ts");
  assert.equal(capture.contentSize, Buffer.byteLength(capture.html));
  assert.equal(
    capture.contentHash,
    await sha256(new TextEncoder().encode(capture.html)),
  );
  dom.window.document.querySelector("#value").textContent = "Nabór zamknięty";
  const changed = await onMessage.emit(message, { id: "test-addon" })[0];
  assert.notEqual(changed.contentHash, capture.contentHash);
  assert.equal(changed.structureHash, capture.structureHash);
});

function browserStub(storage, capture, onNavigation, navigation = {}) {
  const context = { cookieStoreId: "firefox-container-321" };
  const onBefore = event();
  const onHeaders = event();
  const onUpdated = event();
  const onAlarm = event();
  const onRemoved = event();
  const extraTabs = navigation.extraTabs ?? [
    { id: 40, url: "about:blank", cookieStoreId: "firefox-default" },
    {
      id: 41,
      url: "moz-extension://fixture/snapshot-viewer.html",
      cookieStoreId: "firefox-default",
    },
  ];
  const owners = new Map();
  let identity;
  let tab;
  const removeTab = (id) => {
    if (tab?.id !== id) throw Error("Tab already closed");
    tab = undefined;
    onRemoved.emit(id);
  };
  return {
    alarms: { onAlarm, create() {}, clear() {} },
    runtime: {
      onStartup: event(),
      getURL: (path) => `moz-extension://fixture/${path}`,
    },
    sessions: {
      setTabValue: async (id, _key, owner) => owners.set(id, owner),
      getTabValue: async (id) => owners.get(id),
    },
    permissions: { contains: async () => true, onRemoved: event() },
    storage: {
      onChanged: event(),
      local: {
        get: async (keys) =>
          Object.fromEntries([keys].flat().map((key) => [key, storage[key]])),
        set: async (values) => Object.assign(storage, structuredClone(values)),
        remove: async (key) => {
          delete storage[key];
        },
      },
    },
    dns: { resolve: async () => ({ addresses: ["8.8.8.8"] }) },
    contextualIdentities: {
      create: async ({ name }) => (identity = { ...context, name }),
      query: async ({ name }) => (identity?.name === name ? [identity] : []),
      remove: async (id) => {
        assert.equal(id, context.cookieStoreId);
        navigation.events?.push("context removed");
        identity = undefined;
      },
    },
    webRequest: { onBeforeRequest: onBefore, onHeadersReceived: onHeaders },
    tabs: {
      onUpdated,
      onRemoved,
      create: async (options) => {
        assert.equal(options.active, false);
        assert.equal(options.cookieStoreId, context.cookieStoreId);
        assert.match(
          options.url,
          /^moz-extension:\/\/fixture\/monitoring-tab\.html#[0-9a-f-]+$/,
        );
        return (tab = { ...context, id: 1, url: options.url });
      },
      update: async (tabId, { url }) => {
        onNavigation();
        if (navigation.closeFirst) return removeTab(tabId);
        if (navigation.stall) return;
        const initial = { tabId, url, method: "GET", type: "main_frame" };
        if ((await onBefore.emit(initial)[0]).cancel) return;
        const [redirect] = onBefore.emit({
          tabId: -1,
          cookieStoreId: context.cookieStoreId,
          url: "http://127.0.0.1",
          method: "GET",
          type: "xmlhttprequest",
        });
        assert.equal((await redirect).cancel, true);
        for (const { cancel, ...request } of navigation.requests ?? []) {
          assert.equal(
            (await onBefore.emit({ ...initial, type: "script", ...request })[0])
              .cancel,
            cancel,
            request.url,
          );
        }
        const page = navigation.redirectTo ?? url;
        tab.url = page;
        if (navigation.redirectTo) {
          assert.equal(
            onHeaders.emit({ ...initial, statusCode: 302 })[0]?.cancel,
            undefined,
          );
          if ((await onBefore.emit({ ...initial, url: page })[0]).cancel)
            return;
        }
        const [headers] = onHeaders.emit({
          ...initial,
          url: page,
          statusCode: navigation.status ?? 200,
          responseHeaders: [
            {
              name: "Content-Type",
              value: navigation.contentType ?? "text/html",
            },
          ],
        });
        if (!headers?.cancel)
          onUpdated.emit(
            tabId,
            { url: page, status: "complete" },
            { url: page },
          );
      },
      query: async ({ cookieStoreId }) =>
        [tab, ...extraTabs].filter(
          (item) =>
            item && (!cookieStoreId || item.cookieStoreId === cookieStoreId),
        ),
      get: async (id) => {
        const result = [tab, ...extraTabs].find((item) => item?.id === id);
        if (!result) throw Error("Tab already closed");
        return result;
      },
      remove: async (id) => {
        navigation.events?.push(`remove tab ${id}`);
        if (navigation.failTabRemove)
          throw Error("Tab removal temporarily unavailable");
        removeTab(id);
      },
      sendMessage: async (_tabId, message) => {
        if (navigation.contextGone) identity = undefined;
        return typeof capture === "function" ? capture(message) : capture;
      },
    },
    scripting: {
      executeScript: async (arg) =>
        assert.deepEqual(arg.files, ["monitoring-capture.js"]),
    },
  };
}

test("one capture and PUT survive a lost completion response and background restart", async (t) => {
  const { sha256 } = await load("src/shared/monitoring/contracts.ts");
  const html = "<p>public evidence</p>";
  const bytes = new TextEncoder().encode(html);
  const capture = {
    html,
    contentHash: await sha256(bytes),
    contentSize: bytes.length,
    structureHash: "a".repeat(64),
    capturedAt: new Date().toISOString(),
    pageUrl,
    evaluations: [],
  };
  const job = {
    jobId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    sourceId: 1,
    url: pageUrl,
    allowedOrigins: config.allowedOrigins,
    representation: "rendered_dom",
    selectors: [],
  };
  const storage = { [settingsKey]: config };
  let navigations = 0;
  const nav = () => {
    navigations++;
  };
  globalThis.browser = browserStub(storage, capture, nav);
  t.after(() => {
    delete globalThis.browser;
  });
  const completions = [];
  let claims = 0,
    uploads = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (target.origin === config.storageOrigin) {
      uploads++;
      assert.equal(options.method, "PUT");
      assert.deepEqual(options.body, bytes);
      assert.deepEqual(options.headers, { "Content-Type": "text/html" });
      return new Response(null, { status: 200 });
    }
    assert.equal(options.headers.Authorization, "Bearer " + config.agentToken);
    if (target.pathname.endsWith("/claim")) {
      claims++;
      return claims === 1
        ? Response.json(job)
        : new Response(null, { status: 204 });
    }
    if (target.pathname.endsWith("/uploads")) {
      return Response.json({
        uploadIntentId: crypto.randomUUID(),
        url: config.storageOrigin + "/test/pending?X-Amz-Signature=signature",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (target.pathname.endsWith("/complete")) {
      completions.push(options.body);
      if (completions.length === 1)
        throw new TypeError("Connection closed after request");
    } else {
      assert.ok(target.pathname.endsWith("/heartbeat"), target.pathname);
    }
    return Response.json({});
  });
  const { installMonitoringAgent } = await load("src/background/monitoring.ts");
  installMonitoringAgent();
  await until(() => storage[statusKey]?.state === "error");
  assert.ok(storage[outboxKey]);
  assert.ok(!JSON.stringify(storage[outboxKey]).includes(html));
  globalThis.browser = browserStub(storage, capture, nav);
  installMonitoringAgent();
  await until(() => storage[statusKey]?.state === "idle");
  assert.equal(storage[outboxKey], undefined);
  assert.equal(navigations, 1);
  assert.equal(uploads, 1);
  assert.equal(completions.length, 2);
  assert.equal(completions[0], completions[1]);
});

test("an enabled agent waits for Firefox host access before claiming jobs", async (t) => {
  const storage = { [settingsKey]: config };
  const stub = browserStub(storage, null, () =>
    assert.fail("Navigation without permission"),
  );
  let checked;
  stub.permissions.contains = async (request) => {
    checked = request;
    return false;
  };
  globalThis.browser = stub;
  t.after(() => {
    delete globalThis.browser;
  });
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("Claim without host access"),
  );
  const { installMonitoringAgent } = await load("src/background/monitoring.ts");
  installMonitoringAgent();
  await until(() => storage[statusKey]?.state === "disabled");
  assert.deepEqual(checked.origins, ["http://*/*", "https://*/*"]);
});

test("trusted jobs follow public redirects, run pinned selectors and upload rendered evidence", async (t) => {
  const settings = {
    ...config,
    mode: "trusted",
    allowedOrigins: [],
    apiOrigin: "https://burbot.example.org",
  };
  const start = "http://catalog.example.org/list";
  const redirected = "https://publisher.example.net/rendered";
  const storage = { [settingsKey]: settings };
  const dom = new JSDOM(
    `<!doctype html><main></main><script>
      setTimeout(() => {
        document.querySelector('main').innerHTML = '<p id="listing">Applications open</p>';
      }, 100);
    </script>`,
    { url: redirected, runScripts: "dangerously" },
  );
  const onMessage = event();
  const stub = browserStub(
    storage,
    (message) => {
      assert.deepEqual(message.expectedOrigins, [new URL(redirected).origin]);
      assert.equal(message.allowHttp, true);
      return onMessage.emit(message, { id: "test-addon" })[0];
    },
    () => {},
    {
      redirectTo: redirected,
      requests: [
        { url: "https://cdn.example.net/public-script", cancel: false },
        { url: "https://mixed-dns.example.net/private", cancel: true },
        { url: settings.apiOrigin + "/monitoring", cancel: true },
        { url: redirected + "?access_token=secret", cancel: true },
        { url: redirected, method: "POST", cancel: true },
        {
          url: redirected,
          type: "main_frame",
          tabId: 2,
          cookieStoreId: "firefox-container-321",
          cancel: true,
        },
      ],
    },
  );
  stub.dns.resolve = async (host) => ({
    addresses:
      host === "mixed-dns.example.net" ? ["8.8.8.8", "10.0.0.2"] : ["8.8.8.8"],
  });
  Object.assign(stub.runtime, { id: "test-addon", onMessage });
  Object.assign(globalThis, {
    browser: stub,
    document: dom.window.document,
    NodeFilter: dom.window.NodeFilter,
    MutationObserver: dom.window.MutationObserver,
  });
  t.after(() => {
    dom.window.close();
    for (const key of ["browser", "document", "NodeFilter", "MutationObserver"])
      delete globalThis[key];
  });

  const selectorUuid = crypto.randomUUID();
  const versionUuid = crypto.randomUUID();
  const job = {
    jobId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    sourceId: 42,
    url: start,
    allowedOrigins: [new URL(start).origin],
    representation: "rendered_dom",
    navigation: { mode: "trusted", allowHttp: true },
    selectors: [
      {
        selectorUuid,
        versionUuid,
        versionNo: 1,
        definitionFingerprint: "a".repeat(64),
        definition: {
          uuid: versionUuid,
          selectorUuid,
          versionNo: 1,
          createdAt: new Date().toISOString(),
          status: "active",
          recipes: [
            {
              uuid: crypto.randomUUID(),
              order: 0,
              parts: [
                {
                  uuid: crypto.randomUUID(),
                  order: 0,
                  extraction: { type: "text" },
                  locators: [
                    {
                      uuid: crypto.randomUUID(),
                      order: 0,
                      kind: "css_path",
                      selector: "#listing",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
  let claims = 0;
  let uploaded;
  let completion;
  const intent = crypto.randomUUID();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    if (target.origin === settings.storageOrigin) {
      assert.equal(options.method, "PUT");
      assert.deepEqual(options.headers, { "Content-Type": "text/html" });
      uploaded = options.body;
      return new Response(null, { status: 200 });
    }
    assert.equal(target.origin, settings.apiOrigin);
    assert.equal(
      options.headers.Authorization,
      "Bearer " + settings.agentToken,
    );
    if (target.pathname.endsWith("/claim")) {
      assert.equal(target.searchParams.get("mode"), "trusted");
      return ++claims === 1
        ? Response.json(job)
        : new Response(null, { status: 204 });
    }
    if (target.pathname.endsWith("/uploads"))
      return Response.json({
        uploadIntentId: intent,
        url: settings.storageOrigin + "/test/pending?X-Amz-Signature=signature",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    if (target.pathname.endsWith("/complete"))
      completion = JSON.parse(options.body);
    else assert.ok(target.pathname.endsWith("/heartbeat"), target.pathname);
    return Response.json({});
  });
  await load("src/content/monitoring-capture.ts");
  const { installMonitoringAgent } = await load("src/background/monitoring.ts");
  installMonitoringAgent();
  await until(() => completion && storage[statusKey]?.state === "idle");
  const html = new TextDecoder().decode(uploaded);
  assert.match(html, /<p id="listing">Applications open<\/p>/);
  assert.doesNotMatch(html, /<script/);
  const { sha256 } = await load("src/shared/monitoring/contracts.ts");
  assert.equal(completion.contentHash, await sha256(uploaded));
  assert.match(completion.structureHash, /^[0-9a-f]{64}$/);
  assert.equal(completion.pageUrl, redirected);
  assert.equal(completion.uploadIntentId, intent);
  assert.equal(completion.evaluations[0].result.rawValue, "Applications open");
  assert.equal(
    completion.evaluations[0].result.selectorVersionUuid,
    versionUuid,
  );
  assert.equal(storage[outboxKey], undefined);
  stub.alarms.onAlarm.emit({ name: "burbot-monitoring" });
  await until(() => claims === 2 && storage[statusKey]?.state === "idle");
});

test("trusted navigation rejects mismatched jobs, private hops and non-HTML responses", async (t) => {
  const { acquire } = await load("src/background/monitoring-navigation.ts");
  const settings = { ...config, mode: "trusted", allowedOrigins: [] };
  const job = {
    url: pageUrl,
    allowedOrigins: [new URL(pageUrl).origin],
    navigation: { mode: "trusted", allowHttp: false },
    selectors: [],
  };
  t.after(() => {
    delete globalThis.browser;
  });
  const cases = [
    [{ ...job, allowedOrigins: ["*"] }, {}, "NAVIGATION_FAILED", 0],
    [{ ...job, navigation: undefined }, {}, "NAVIGATION_FAILED", 0],
    [job, { redirectTo: "http://example.net/page" }, "NAVIGATION_FAILED", 1],
    [
      job,
      { redirectTo: "https://internal.example.org" },
      "NAVIGATION_FAILED",
      1,
    ],
    [job, { status: 404 }, "HTTP_ERROR", 1],
    [job, { contentType: "application/pdf" }, "UNSUPPORTED_CONTENT_TYPE", 1],
  ];
  for (const [candidate, navigation, code, tabs] of cases) {
    let navigations = 0;
    const storage = {};
    globalThis.browser = browserStub(
      storage,
      () => assert.fail("Rejected page reached capture"),
      () => navigations++,
      navigation,
    );
    globalThis.browser.dns.resolve = async (host) => ({
      addresses:
        host === "internal.example.org" ? ["192.168.2.1"] : ["8.8.8.8"],
    });
    await assert.rejects(
      acquire(candidate, settings, new AbortController().signal),
      { code },
    );
    assert.equal(navigations, tabs);
    assert.deepEqual(storage, {});
    assert.deepEqual(
      globalThis.browser.webRequest.onBeforeRequest.emit({}),
      [],
    );
    assert.deepEqual(
      globalThis.browser.webRequest.onHeadersReceived.emit({}),
      [],
    );
  }
});
