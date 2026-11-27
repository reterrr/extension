import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { launch, until } from "./firefox.cjs";

const token = "t".repeat(43);
const visualVersion = "visual-html-1";
const fullVersion = "full-resource-1";
const queue = "/monitoring/agents/snapshot-commands/";
const sourceUrl = "http://example.org/archive-fixture/page";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQyZgEAAHSAR9ziBBNAAAAAElFTkSuQmCC",
  "base64",
);
// An original fixture font containing a single triangular A glyph.
const font = Buffer.from(
  "d09GRgABAAAAAAJ8AAoAAAAAAugAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABZAAAAC4AAABgRSFENWNtYXAAAAGcAAAAKQAAADQADACUZ2x5ZgAAAdAAAAAaAAAAGgItOSVoZWFkAAAA9AAAADYAAAA2L8qKzmhoZWEAAAEsAAAAHwAAACQFegGwaG10eAAAAZQAAAAGAAAABgJ2AABsb2NhAAAByAAAAAYAAAAGAA0AAG1heHAAAAFMAAAAFgAAACAABAAFbmFtZQAAAewAAAB+AAAA2NoANQtwb3N0AAACbAAAAA8AAAAmACgAAAABAAAAAQAA8vwc8V8PPPUAAwPoAAAAAOcuI5kAAAAA5y4jmQAeAAACOgK8AAAAAwACAAAAAAAAeJxjYGRgYFb4b8HAwBTBIMcgx2TFABRBAYwAOz0CMAB4nGNgZGBgYGJgZgDRIBYaAAAA+QAKAAB4nGNgZopgnMDAysDCQBgwInPsgQBIOTI4Miv8t2BgYFZgOIGmXoGBAQDBXwTcAAACWAAAAB4AAHicY2BgYGJgYGAGYhEgyQimWRgUgDQLEIL4jv//Q8j/B8B8BgBSlwadAAAAAAAAAAANAAAAAQAeAAACOgK8AAIAADMBAR4BDgEOArz9RAAAeJxVij0Kg0AQRt/qosSENIJYiaewF3IC8QIiiwpW60+ZsztrtthM8c2bNx+Q8UXhRvG6001EKteP48DrgBOe5PJV+iGmpPIc8abxHAdeB5xQ8GntOC+nqXuz7Z2ZjnWwXjlDi2VkZuHEUNNLbux0sicOVgZp/Ld85wI8/hoEAAB4nGNgYsAPQPIqAACeACkA",
  "base64",
);

async function install(t) {
  const firefox = await launch({ sourceDir: resolve("dist") });
  t.after(firefox.close);
  return firefox;
}

function configure(firefox, settings) {
  return firefox.storage(
    `browser.storage.local.set(${JSON.stringify({
      burbotMonitoringSettings: settings,
    })})`,
  );
}

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((ready) => server.close(ready));
  });
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, port };
}

const json = (res, body) =>
  res
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(body));

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function command() {
  return {
    commandId: randomUUID(),
    targetAgentId: randomUUID(),
    action: "open_snapshot",
    state: "claimed",
    sourceId: 57,
    snapshotId: 264,
    capturedAt: "2026-11-24T09:00:00Z",
    expiresAt: new Date(Date.now() + 70_000).toISOString(),
    sourceUrl,
    selectorContext: {
      extractionRunId: 31,
      selectorUuid: randomUUID(),
      selectorVersionUuid: randomUUID(),
    },
  };
}

function artifact(res, bytes, { format, wrongDigest = false } = {}) {
  res
    .writeHead(200, {
      "Content-Type": "application/octet-stream",
      "X-Burbot-Snapshot-Mime": "text/html",
      "X-Burbot-Snapshot-Size": bytes.length,
      "X-Burbot-Snapshot-SHA256": wrongDigest ? "0".repeat(64) : digest(bytes),
      ...(format && { "X-Burbot-Snapshot-Format": format }),
    })
    .end(bytes);
}

function archives(firefox) {
  return firefox.chrome(`Array.from(win.gBrowser.tabs, tab => tab.linkedBrowser.currentURI.spec)
    .filter(url => url.startsWith('blob:null/'))`);
}

async function openedArchive(firefox) {
  return until(
    async () => {
      const [url] = await archives(firefox);
      if (!url) return;
      const title = await firefox.webView(
        url,
        "document.querySelector('h1')?.textContent",
      );
      return title === "Archived Firefox page" && url;
    },
    "archive DOM in Firefox DevTools",
    15_000,
  );
}

async function assertIsolated(firefox, url) {
  assert.equal(
    await firefox.chrome(`Array.from(win.gBrowser.tabs).some(tab =>
    tab.linkedBrowser.currentURI.spec === ${JSON.stringify(url)} &&
    tab.linkedBrowser.contentPrincipal.isNullPrincipal)`),
    true,
  );
  assert.deepEqual(
    await firefox.webView(
      url,
      `({
      top: window === top,
      frames: document.querySelectorAll("iframe").length,
      scripts: document.scripts.length,
      extensionAPI: typeof globalThis.browser?.runtime,
    })`,
    ),
    { top: true, frames: 0, scripts: 0, extensionAPI: "undefined" },
  );
}

test(
  "Firefox opens legacy evidence as a native document and replays a lost ACK without another tab",
  { timeout: 90_000 },
  async (t) => {
    const replies = [];
    let next = command();
    let downloads = 0;
    let mode = "legacy";
    const escapedRequests = [];
    const { origin } = await listen(t, async (req, res) => {
      if (!req.url.startsWith(queue)) {
        if (req.url.startsWith("/unexpected")) escapedRequests.push(req.url);
        return res.writeHead(404).end();
      }
      if (req.headers.authorization !== `Bearer ${token}`)
        return res.writeHead(401).end();
      if (req.url === queue + "claim")
        return next ? json(res, next) : res.writeHead(204).end();
      if (req.url.endsWith("/artifact")) {
        assert.equal(req.headers["x-burbot-snapshot-accept"], visualVersion);
        downloads++;
        if (mode === "missing")
          return res.writeHead(404, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              detail: { code: "SNAPSHOT_ARTIFACT_NOT_FOUND" },
            }),
          );
        if (mode === "timeout") return;
        const unexpected = `http://${req.headers.host}/unexpected`;
        return artifact(
          res,
          Buffer.from(`<!doctype html><title>Legacy capture</title>
        <meta http-equiv="refresh" content="0;url=${unexpected}/redirect">
        <link rel="stylesheet" href="${unexpected}/style">
        <h1 id="archived">Archived Firefox page</h1><img src="${unexpected}/image">
        <iframe src="${unexpected}/frame"></iframe><a href="${unexpected}/link">Original link</a>
        <form action="${unexpected}/form"><input value="fixture-password"></form>
        <script>document.body.dataset.executed = "yes"</script>`),
          { wrongDigest: mode === "invalid" },
        );
      }
      if (req.url.endsWith("/ack")) {
        replies.push(JSON.parse(await body(req)));
        if (replies.length === 1) return res.destroy();
        next = undefined;
        return json(res, {});
      }
      res.writeHead(404).end();
    });
    const firefox = await install(t);
    await configure(firefox, {
      enabled: true,
      apiOrigin: origin,
      storageOrigin: origin,
      agentToken: token,
      allowedOrigins: ["https://example.org"],
    });
    const url = await openedArchive(firefox);
    await assertIsolated(firefox, url);
    assert.equal(
      await firefox.webView(
        url,
        `document.querySelectorAll('script, iframe, img[src], a[href], form[action]').length`,
      ),
      0,
    );
    assert.equal(
      await firefox.webView(url, `document.body.getAttribute('data-executed')`),
      null,
    );
    await until(() => replies.length >= 2, "replayed acknowledgement", 15_000);
    assert.deepEqual(replies, [{ state: "opened" }, { state: "opened" }]);
    assert.equal(downloads, 1);
    for (const [failure, errorCode] of [
      ["invalid", "SNAPSHOT_INTEGRITY_MISMATCH"],
      ["missing", "SNAPSHOT_ARTIFACT_NOT_FOUND"],
      ["timeout", "BACKEND_TIMEOUT"],
    ]) {
      mode = failure;
      next = command();
      await until(
        () => replies.some((reply) => reply.errorCode === errorCode),
        errorCode,
        25_000,
      );
      assert.deepEqual(
        replies.find((reply) => reply.errorCode === errorCode),
        { state: "failed", errorCode },
      );
      assert.deepEqual(await archives(firefox), [url]);
    }
    assert.deepEqual(escapedRequests, []);
  },
);

async function grantCapture(firefox, port) {
  const permissions = {
    permissions: [
      "cookies",
      "webRequest",
      "webRequestBlocking",
      "webRequestFilterResponse",
    ],
    origins: ["http://*/*", "https://*/*"],
  };
  await firefox.chrome(`(() => {
    const prefs = Services.prefs;
    prefs.setBoolPref('privacy.userContext.enabled', true);
    prefs.setBoolPref('dom.security.https_first', false);
    prefs.setBoolPref('dom.security.https_only_mode', false);
    prefs.setIntPref('network.proxy.type', 1);
    prefs.setCharPref('network.proxy.http', '127.0.0.1');
    prefs.setIntPref('network.proxy.http_port', ${port});
    prefs.setCharPref('network.proxy.no_proxies_on', 'localhost,127.0.0.1');
    const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
    const policy = WebExtensionPolicy.getByID('burbot-picker@local.example');
    ExtensionPermissions.add(policy.id, ${JSON.stringify(permissions)}, policy.extension);
    return true;
  })()`);
  await until(
    () =>
      firefox.storage(
        `browser.permissions.contains(${JSON.stringify(permissions)})`,
      ),
    "capture permissions",
  );
}

function captureJob(withArchive) {
  return {
    jobId: randomUUID(),
    leaseId: randomUUID(),
    sourceId: 57,
    url: sourceUrl,
    allowedOrigins: [new URL(sourceUrl).origin],
    representation: "rendered_dom",
    selectors: [],
    comparisonVersion: "dom-comparison-1",
    navigation: { mode: "trusted", allowHttp: true },
    ...(withArchive && { visualArchiveVersion: visualVersion }),
  };
}

test(
  "Firefox records loaded CSS, images and fonts, and preserves evidence and open archives during cleanup",
  { timeout: 90_000 },
  async (t) => {
    const hits = [];
    const contents = new Map();
    const completions = [];
    const failures = [];
    const acknowledgements = [];
    let job = captureJob(true);
    let next;
    const files = new Map([
      [
        "page",
        [
          "text/html",
          `<!doctype html><title>Archived Firefox page</title><link rel="stylesheet" href="/archive-fixture/assets/site.css"><h1 id="headline" style="padding-left:7px">Archived Firefox page</h1><p id="font">A</p><img id="fixture-image" src="/archive-fixture/pixel.png"><a href="/archive-fixture/live">Live only</a>`,
        ],
      ],
      [
        "site.css",
        [
          "text/css",
          '@import "../nested.css"; #headline{background-image:url(../pixel.png)} @font-face{font-family:ArchiveTest;src:url(../letter.woff) format("woff")} #font{font-family:ArchiveTest}',
        ],
      ],
      ["nested.css", ["text/css", "#headline { color: rgb(18, 52, 86); }"]],
      ["pixel.png", ["image/png", png]],
      ["letter.woff", ["font/woff", font]],
    ]);
    const { origin, port } = await listen(t, async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      if (path.startsWith("/archive-fixture/")) {
        hits.push(path);
        const file = files.get(path.split("/").at(-1));
        if (!file) return res.writeHead(404).end();
        return res
          .writeHead(200, {
            "Content-Type": file[0],
            "Cache-Control": "no-store",
          })
          .end(file[1]);
      }
      if (req.method === "PUT" && path.startsWith("/uploads/")) {
        assert.equal(req.headers.authorization, undefined);
        contents.set(path.split("/").at(-1), await body(req));
        return res.writeHead(200).end();
      }
      if (req.headers.authorization !== `Bearer ${token}`)
        return res.writeHead(401).end();
      if (path === "/monitoring/jobs/claim") {
        const selected = job;
        job = undefined;
        return selected ? json(res, selected) : res.writeHead(204).end();
      }
      if (path.startsWith("/monitoring/jobs/")) {
        const action = path.split("/").at(-1);
        const payload = JSON.parse(await body(req));
        if (action === "uploads" || action === "archive-uploads") {
          const uploadIntentId = randomUUID();
          return json(res, {
            uploadIntentId,
            url: `${origin}/uploads/${uploadIntentId}`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          });
        }
        if (action === "complete") completions.push(payload);
        if (action === "fail") failures.push(payload.code);
        return json(res, {});
      }
      if (path === queue + "claim")
        return next ? json(res, next) : res.writeHead(204).end();
      if (path.startsWith(queue) && path.endsWith("/artifact")) {
        assert.equal(req.headers["x-burbot-snapshot-accept"], visualVersion);
        return artifact(
          res,
          contents.get(completions[0].visualArchiveUploadId),
          { format: visualVersion },
        );
      }
      if (path.startsWith(queue) && path.endsWith("/ack")) {
        acknowledgements.push(JSON.parse(await body(req)));
        next = undefined;
        return json(res, {});
      }
      res.writeHead(404).end();
    });
    const firefox = await install(t);
    await grantCapture(firefox, port);
    const settings = {
      enabled: true,
      mode: "trusted",
      allowedOrigins: [],
      apiOrigin: origin,
      storageOrigin: origin,
      agentToken: token,
    };
    await configure(firefox, settings);
    await until(
      () => completions.length || failures.length,
      "monitoring capture",
      30_000,
    );
    assert.deepEqual(failures, []);
    const first = completions[0];
    const evidence = contents.get(first.uploadIntentId);
    const visual = contents.get(first.visualArchiveUploadId);
    assert.ok(visual?.length);
    assert.equal(first.contentHash, digest(evidence));
    assert.doesNotMatch(evidence.toString(), /<style|data:image\//);
    assert.match(visual.toString(), /data:image\/png;base64/);
    // CSSOM may inline the stylesheet in place. Either representation must
    // retain the loaded font and its rules in the archived document.
    assert.match(
      visual.toString(),
      /data:font\/woff;base64,/,
      "the loaded font was saved in the archived CSS",
    );
    assert.match(visual.toString(), /@font-face/);
    assert.ok(hits.some((path) => path.endsWith("site.css")));
    assert.ok(hits.some((path) => path.endsWith("letter.woff")));
    const initialHits = [...hits];
    const selected = command();
    next = selected;
    const url = await openedArchive(firefox);
    await assertIsolated(firefox, url);
    await until(
      () =>
        firefox.webView(
          url,
          `[...document.fonts].some(face => face.family === 'ArchiveTest' && face.status === 'loaded') && document.getElementById('fixture-image').naturalWidth === 1`,
        ),
      "archived image and font",
    );
    const appearance = await firefox.webView(
      url,
      `(() => {
      const css = getComputedStyle(document.getElementById('headline'));
      return {
        color: css.color,
        padding: css.paddingLeft,
        background: css.backgroundImage,
      };
    })()`,
    );
    assert.equal(appearance.color, "rgb(18, 52, 86)");
    assert.equal(appearance.padding, "7px");
    assert.match(appearance.background, /data:image\/png;base64/);
    assert.deepEqual(hits, initialHits);
    await until(
      () => acknowledgements.length,
      "visual archive acknowledgement",
    );
    assert.deepEqual(acknowledgements, [{ state: "opened" }]);
    const owner = await firefox.storage(
      `browser.tabs.query({active:true,currentWindow:true}).then(([tab])=>browser.sessions.getTabValue(tab.id,'burbotSnapshotArchive'))`,
    );
    assert.deepEqual(owner.selectorContext, selected.selectorContext);
    assert.equal(owner.format, visualVersion);

    await configure(firefox, { ...settings, enabled: false });
    await until(
      () =>
        firefox.storage(
          `browser.storage.local.get('burbotMonitoringStatus').then(state=>state.burbotMonitoringStatus?.state==='disabled')`,
        ),
      "monitor paused",
    );
    job = captureJob(false);
    await configure(firefox, settings);
    await until(
      () => completions.length > 1 || failures.length,
      "canonical-only capture",
      30_000,
    );
    assert.deepEqual(failures, []);
    assert.equal(completions[1].visualArchiveUploadId, undefined);
    assert.equal(completions[1].contentHash, first.contentHash);
    assert.equal(completions[1].structureHash, first.structureHash);
    assert.deepEqual(completions[1].comparison, first.comparison);
    assert.deepEqual(contents.get(completions[1].uploadIntentId), evidence);
    assert.deepEqual(
      await firefox.storage(
        `browser.tabs.query({}).then(tabs=>tabs.filter(tab=>tab.cookieStoreId?.startsWith('firefox-container-')))`,
      ),
      [],
    );
    assert.deepEqual(await archives(firefox), [url]);
  },
);

test(
  "Firefox captures equivalent evidence in both modes and replays a full archive offline",
  { timeout: 120_000 },
  async (t) => {
    const pinned = {
      selectorUuid: randomUUID(),
      versionUuid: randomUUID(),
      versionNo: 1,
      definitionFingerprint: "a".repeat(64),
    };
    pinned.definition = {
      uuid: pinned.versionUuid,
      selectorUuid: pinned.selectorUuid,
      versionNo: 1,
      status: "active",
      createdAt: "2026-11-27T00:00:00Z",
      recipes: [
        {
          uuid: randomUUID(),
          order: 0,
          parts: [
            {
              uuid: randomUUID(),
              order: 0,
              extraction: { type: "text" },
              locators: [
                {
                  uuid: randomUUID(),
                  order: 0,
                  kind: "css_path",
                  selector: "#value",
                },
              ],
            },
          ],
        },
      ],
    };
    const jobFor = (snapshotMode) => ({
      ...captureJob(false),
      snapshotMode,
      selectors: [pinned],
      ...(snapshotMode === "full" && {
        fullArchive: {
          version: fullVersion,
          maxBytes: 8 * 1024 * 1024,
          maxResourceBytes: 1024 * 1024,
        },
      }),
    });
    let job = jobFor("minimal");
    let next;
    let rejectArchive = false;
    let interruptSeal = true;
    let sealInterrupted = false;
    const hits = [];
    const uploadHits = [];
    const completions = [];
    const failures = [];
    const reports = [];
    const acknowledgements = [];
    const pending = new Map();
    const stored = new Map();
    const sourceFixture = Buffer.from(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/archive-fixture/redirect.css">' +
        '<h1 id="headline" style="padding-left:7px">Archived Firefox page</h1>' +
        '<p id="value">Waiting</p><p class="font">A</p><div id="shadow"></div>' +
        '<picture><source media="(min-width: 600px)" srcset="/archive-fixture/pixel.png 1x, /archive-fixture/large.png 2x">' +
        '<img id="fixture-image" src="/archive-fixture/pixel.png"></picture>' +
        '<img src="/archive-fixture/pixel.png"><img id="svg" src="/archive-fixture/icon.svg">' +
        '<img src="/archive-fixture/missing.png"><img loading="lazy" src="/archive-fixture/lazy.png">' +
        '<img src="/archive-fixture/large.png">' +
        '<form action="/archive-fixture/escape"><input type="password" value="fixture-secret"></form>' +
        '<script>document.querySelector("#value").textContent = "Current value";' +
        'const root = document.querySelector("#shadow").attachShadow({mode: "open"});' +
        'const rules = new CSSStyleSheet(); rules.replaceSync("b{color:rgb(10,20,30)}");' +
        'root.adoptedStyleSheets = [rules]; root.innerHTML = "<b>Shadow text</b>";' +
        "globalThis.fixtureScript = true;</script>",
    );
    const files = new Map([
      ["page", ["text/html; charset=utf-8", sourceFixture]],
      [
        "site.css",
        [
          "text/css",
          Buffer.from(
            '@import url("./nested.css") screen; ' +
              '@font-face{font-family:ArchiveTest;src:url("./letter.woff")} ' +
              '@font-face{font-family:CrossTest;src:url("http://example.com/archive-fixture/cross.woff")} ' +
              ".font{font-family:ArchiveTest} #value{font-family:CrossTest}",
          ),
        ],
      ],
      [
        "nested.css",
        [
          "text/css",
          Buffer.from(
            '#headline{color:rgb(18,52,86);background-image:url("./pixel.png")}',
          ),
        ],
      ],
      ["letter.woff", ["font/woff", font]],
      ["cross.woff", ["font/woff", font]],
      ["pixel.png", ["image/png", png]],
      ["lazy.png", ["image/png", png]],
      [
        "large.png",
        ["image/png", Buffer.concat([png, Buffer.alloc(1024 * 1024)])],
      ],
      [
        "icon.svg",
        [
          "image/svg+xml",
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2"/><script>globalThis.bad=true</script></svg>',
          ),
        ],
      ],
    ]);
    const { origin, port } = await listen(t, async (req, res) => {
      const url = new URL(req.url, "http://" + req.headers.host);
      const path = url.pathname;
      if (path.startsWith("/archive-fixture/")) {
        hits.push(url.origin + path);
        if (path.endsWith("/redirect.css"))
          return res
            .writeHead(302, { Location: "/archive-fixture/site.css" })
            .end();
        const file = files.get(path.split("/").at(-1));
        if (!file) return res.writeHead(404).end();
        return res
          .writeHead(200, {
            "Content-Type": file[0],
            "Content-Length": file[1].length,
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          })
          .end(file[1]);
      }
      if (req.method === "PUT" && path.startsWith("/uploads/")) {
        assert.equal(req.headers.authorization, undefined);
        const id = path.split("/").at(-1);
        uploadHits.push(id);
        pending.set(id, await body(req));
        return res.writeHead(200).end();
      }
      if (req.headers.authorization !== "Bearer " + token)
        return res.writeHead(401).end();
      if (path === "/monitoring/jobs/claim") {
        const selected = job;
        job = undefined;
        return selected ? json(res, selected) : res.writeHead(204).end();
      }
      if (path.startsWith("/monitoring/jobs/")) {
        const payload = JSON.parse(await body(req));
        if (path.endsWith("/full-archive/uploads")) {
          if (rejectArchive) return res.writeHead(503).end();
          return stored.has(payload.sha256)
            ? json(res, { stored: true })
            : json(res, {
                stored: false,
                url: origin + "/uploads/" + payload.sha256,
              });
        }
        if (path.endsWith("/full-archive/seal")) {
          const bytes = pending.get(payload.sha256);
          assert.equal(bytes.length, payload.sizeBytes);
          assert.equal(digest(bytes), payload.sha256);
          stored.set(payload.sha256, bytes);
          if (interruptSeal) {
            interruptSeal = false;
            sealInterrupted = true;
            return; // Hold the acknowledgement until Firefox reloads the agent.
          }
          return json(res, { stored: true });
        }
        if (path.endsWith("/full-archive")) reports.push(payload);
        else if (path.endsWith("/uploads")) {
          const uploadIntentId = randomUUID();
          return json(res, {
            uploadIntentId,
            url: origin + "/uploads/" + uploadIntentId,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          });
        } else if (path.endsWith("/complete")) completions.push(payload);
        else if (path.endsWith("/fail")) failures.push(payload.code);
        return json(res, {});
      }
      if (path === queue + "claim")
        return next ? json(res, next) : res.writeHead(204).end();
      if (path.endsWith("/archive-manifest"))
        return artifact(res, Buffer.from(JSON.stringify(reports[0].manifest)));
      if (path.includes("/archive-objects/"))
        return artifact(res, stored.get(path.split("/").at(-1)));
      if (path.endsWith("/ack")) {
        acknowledgements.push(JSON.parse(await body(req)));
        next = undefined;
        return json(res, {});
      }
      return res.writeHead(404).end();
    });
    const firefox = await install(t);
    await grantCapture(firefox, port);
    const settings = {
      enabled: true,
      mode: "trusted",
      allowedOrigins: [],
      apiOrigin: origin,
      storageOrigin: origin,
      agentToken: token,
    };
    await configure(firefox, settings);
    await until(
      () => completions.length || failures.length,
      "minimal capture",
      25_000,
    );
    assert.deepEqual(failures, []);
    assert.deepEqual(reports, []);
    assert.equal(uploadHits.length, 1);
    assert.ok(hits.some((url) => url.endsWith("/site.css")));
    assert.ok(hits.some((url) => url.endsWith("/letter.woff")));
    assert.ok(hits.some((url) => url.endsWith("/large.png")));
    assert.equal(
      completions[0].evaluations[0].result.rawValue,
      "Current value",
    );

    async function captureAnother({ restart = false } = {}) {
      await configure(firefox, { ...settings, enabled: false });
      await until(
        () =>
          firefox.storage(
            "browser.storage.local.get('burbotMonitoringStatus').then(data=>data.burbotMonitoringStatus?.state==='disabled')",
          ),
        "monitor paused",
      );
      job = jobFor("full");
      const count = completions.length;
      await configure(firefox, settings);
      if (restart) {
        await until(
          () => sealInterrupted || failures.length,
          "archive seal in progress",
        );
        assert.equal(sealInterrupted, true);
        assert.ok(
          await firefox.storage(
            "browser.storage.local.get('burbotMonitoringOutbox').then(data=>data.burbotMonitoringOutbox?.fullArchive)",
          ),
        );
        await firefox.storage(
          "(setTimeout(() => browser.runtime.reload(), 300), true)",
        );
      }
      await until(
        () => completions.length > count || failures.length,
        "full capture",
        30_000,
      );
      assert.deepEqual(failures, []);
    }

    await captureAnother({ restart: true });
    assert.equal(reports.length, 1);
    const manifest = reports[0].manifest;
    assert.equal(manifest.archiveVersion, fullVersion);
    assert.equal(manifest.capturedAt, completions[1].capturedAt);
    const byUrl = (name) =>
      manifest.resources.find(({ originalUrl }) =>
        originalUrl.endsWith("/" + name),
      );
    assert.equal(
      byUrl("redirect.css").responseUrl,
      "http://example.org/archive-fixture/site.css",
    );
    assert.equal(byUrl("nested.css").status, "captured");
    assert.equal(byUrl("letter.woff").sha256, byUrl("cross.woff").sha256);
    assert.equal(byUrl("icon.svg").status, "captured");
    assert.equal(byUrl("missing.png").status, "missing");
    assert.equal(byUrl("large.png").status, "truncated");
    const markup = stored.get(manifest.document.sha256).toString();
    assert.doesNotMatch(
      markup,
      /fixture-secret|<script|data:image\/png;base64/,
    );
    assert.equal(
      uploadHits.filter((id) => id === manifest.document.sha256).length,
      1,
    );
    assert.equal(
      uploadHits.filter((id) => id === byUrl("letter.woff").sha256).length,
      1,
    );

    for (const key of [
      "contentHash",
      "structureHash",
      "comparison",
      "evaluations",
    ])
      assert.deepEqual(completions[0][key], completions[1][key]);
    assert.deepEqual(
      pending.get(completions[0].uploadIntentId),
      pending.get(completions[1].uploadIntentId),
    );

    const captureHits = [...hits];
    next = { ...command(), archiveVersion: fullVersion };
    const opened = await openedArchive(firefox);
    await assertIsolated(firefox, opened);
    await until(
      () =>
        firefox.webView(
          opened,
          '[...document.fonts].filter(font=>font.status==="loaded").length===2 && document.getElementById("fixture-image").naturalWidth===1 && document.getElementById("svg").naturalWidth===3',
        ),
      "offline images and both fonts",
    );
    const view = await firefox.webView(
      opened,
      '({color:getComputedStyle(document.querySelector("#headline")).color,background:getComputedStyle(document.querySelector("#headline")).backgroundImage,shadow:document.querySelector("#shadow").shadowRoot?.textContent,ran:globalThis.fixtureScript===true})',
    );
    assert.equal(view.color, "rgb(18, 52, 86)");
    assert.match(view.background, /data:image\/png;base64/);
    assert.match(view.shadow, /Shadow text/);
    assert.equal(view.ran, false);
    assert.deepEqual(hits, captureHits);
    await until(() => acknowledgements.length, "archive acknowledgement");
    assert.deepEqual(acknowledgements, [{ state: "opened" }]);

    rejectArchive = true;
    await captureAnother();
    assert.equal(reports[1].failure, "upload_failed");
    for (const key of [
      "contentHash",
      "structureHash",
      "comparison",
      "evaluations",
    ])
      assert.deepEqual(completions[2][key], completions[0][key]);
  },
);

test(
  "live Studio opens a stored capture as a native Firefox document",
  {
    timeout: 60_000,
    skip: !process.env.BURBOT_SNAPSHOT_BRIDGE_STUDIO_ORIGIN,
  },
  async (t) => {
    const firefox = await install(t);
    const sourceId = Number(process.env.BURBOT_SNAPSHOT_BRIDGE_SOURCE_ID ?? 57);
    const snapshotId = Number(
      process.env.BURBOT_SNAPSHOT_BRIDGE_SNAPSHOT_ID ?? 386,
    );
    const studioOrigin = process.env.BURBOT_SNAPSHOT_BRIDGE_STUDIO_ORIGIN;
    await configure(firefox, {
      enabled: true,
      allowedOrigins: ["https://example.org"],
      apiOrigin: process.env.BURBOT_SNAPSHOT_BRIDGE_API_ORIGIN,
      storageOrigin: process.env.BURBOT_SNAPSHOT_BRIDGE_STORAGE_ORIGIN,
      agentToken: process.env.BURBOT_SNAPSHOT_BRIDGE_AGENT_TOKEN,
    });
    const studio = await firefox.context.newPage();
    const review = `${studioOrigin}/#/monitoring/sources/${sourceId}`;
    await studio.goto(review);
    await until(
      () =>
        studio.evaluate(async (id) => {
          const response = await fetch(
            `/backend/monitoring/sources/${id}/snapshot-agents`,
          );
          return response.ok && (await response.json()).length === 1;
        }, sourceId),
      "live Firefox agent presence",
      15_000,
    );
    await studio
      .getByRole("button", {
        name: `Open snapshot #${snapshotId}`,
        exact: true,
      })
      .click();
    await studio
      .getByText("Opened in Firefox", { exact: true })
      .waitFor({ timeout: 20_000 });
    assert.equal(studio.url(), review);
    await assertIsolated(firefox, await openedArchive(firefox));
  },
);
