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

function browserStub(storage, capture, onNavigation) {
  const context = { cookieStoreId: "firefox-container-321" };
  const onBefore = event();
  const onUpdated = event();
  const onAlarm = event();
  return {
    alarms: { onAlarm, create() {}, clear() {} },
    runtime: { onStartup: event() },
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
      create: async () => context,
      remove: async (id) => {
        assert.equal(id, context.cookieStoreId);
      },
    },
    webRequest: { onBeforeRequest: onBefore },
    tabs: {
      onUpdated,
      onRemoved: event(),
      create: async (options) => {
        assert.deepEqual(options, {
          active: false,
          url: "about:blank",
          cookieStoreId: context.cookieStoreId,
        });
        return { ...context, id: 1 };
      },
      update: async (tabId, { url }) => {
        onNavigation();
        const [guard] = onBefore.emit({
          tabId,
          url,
          method: "GET",
          type: "main_frame",
        });
        assert.equal((await guard).cancel, false);
        const [redirect] = onBefore.emit({
          tabId: -1,
          cookieStoreId: context.cookieStoreId,
          url: "http://127.0.0.1",
          method: "GET",
          type: "xmlhttprequest",
        });
        assert.equal((await redirect).cancel, true);
        onUpdated.emit(tabId, { url, status: "complete" }, { url });
      },
      get: async () => ({ url: pageUrl }),
      sendMessage: async () => capture,
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
