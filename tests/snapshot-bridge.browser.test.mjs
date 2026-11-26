import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { launch, until } from "./firefox.cjs";

const token = "t".repeat(43);
const visualVersion = "visual-html-1";
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
          `<!doctype html><title>Archived Firefox page</title><link rel="stylesheet" href="/archive-fixture/site.css"><h1 id="headline" style="padding-left:7px">Archived Firefox page</h1><p id="font">A</p><img id="fixture-image" src="/archive-fixture/pixel.png"><a href="/archive-fixture/live">Live only</a>`,
        ],
      ],
      [
        "site.css",
        [
          "text/css",
          '@import "nested.css"; #headline{background-image:url(pixel.png)} @font-face{font-family:ArchiveTest;src:url(letter.woff) format("woff")} #font{font-family:ArchiveTest}',
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
