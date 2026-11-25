import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { launch } from "./firefox.cjs";

const token = "t".repeat(43);
const queue = "/monitoring/agents/snapshot-commands/";

async function eventually(fn, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(60);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function install(t) {
  const firefox = await launch({ sourceDir: resolve("dist") });
  t.after(firefox.close);
  return firefox;
}

async function configure(
  firefox,
  apiOrigin,
  agentToken,
  storageOrigin = apiOrigin,
) {
  await firefox.storage(
    `browser.storage.local.set(${JSON.stringify({
      burbotMonitoringSettings: {
        enabled: true,
        apiOrigin,
        storageOrigin,
        agentToken,
        allowedOrigins: ["https://example.org"],
      },
    })})`,
  );
}

function snapshotTabs(firefox) {
  // Firefox's native tab list includes extension pages outside Playwright targets.
  return firefox.chrome(`Array.from(win.gBrowser.tabs, tab => tab.linkedBrowser.currentURI.spec)
    .filter(url => url.startsWith('moz-extension://') && url.includes('/snapshot-viewer.html#'))`);
}

function command() {
  return {
    commandId: randomUUID(),
    targetAgentId: randomUUID(),
    action: "open_snapshot",
    state: "claimed",
    sourceId: 57,
    snapshotId: 386,
    capturedAt: "2026-11-24T09:00:00Z",
    expiresAt: new Date(Date.now() + 70_000).toISOString(),
    sourceUrl: "https://example.org/archived",
    selector: {
      version: {
        uuid: randomUUID(),
        versionNo: 2,
        status: "superseded",
        recipes: [
          {
            parts: [
              {
                locators: [
                  { kind: "css_path", selector: "#archived h1" },
                  { kind: "xpath", expression: '//a[@href="/historical"]' },
                ],
              },
            ],
          },
        ],
      },
    },
    evaluation: {
      result: { status: "success", rawValue: "Recorded evaluation" },
    },
  };
}

test(
  "native Firefox renders the archive, verifies its digest and opens at most one tab per command",
  { timeout: 90_000 },
  async (t) => {
    const replies = [];
    const blockedRequests = [];
    let next;
    let artifactCount = 0;
    let loseAck = true;
    let artifactMode = "ok";
    let html;
    const server = createServer(async (request, response) => {
      const path = request.url;
      if (path.startsWith("/archived-resource")) {
        blockedRequests.push(path);
        response.writeHead(200).end();
      } else if (path.startsWith(queue)) {
        if (request.headers.authorization !== `Bearer ${token}`)
          return response.writeHead(401).end();
        if (path === queue + "claim") {
          if (!next) return response.writeHead(204).end();
          return response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify(next));
        }
        if (path.endsWith("/artifact")) {
          artifactCount++;
          if (artifactMode === "timeout") return; // The extension owns the bounded request deadline.
          if (artifactMode === "missing")
            return response
              .writeHead(404, { "Content-Type": "application/json" })
              .end(
                JSON.stringify({
                  detail: { code: "SNAPSHOT_ARTIFACT_NOT_FOUND" },
                }),
              );
          return response
            .writeHead(200, {
              "Content-Type": "application/octet-stream",
              "X-Burbot-Snapshot-Mime": "text/html",
              "X-Burbot-Snapshot-Size": Buffer.byteLength(html),
              "X-Burbot-Snapshot-SHA256":
                artifactMode === "invalid"
                  ? "0".repeat(64)
                  : createHash("sha256").update(html).digest("hex"),
            })
            .end(html);
        }
        if (path.endsWith("/ack")) {
          let body = "";
          for await (const chunk of request) body += chunk;
          replies.push(JSON.parse(body));
          if (loseAck) {
            loseAck = false;
            return response.destroy();
          }
          next = undefined;
          return response
            .writeHead(200, { "Content-Type": "application/json" })
            .end("{}");
        }
      }
      response.writeHead(404).end();
    });
    await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((ready) => server.close(ready));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${origin}/archived-resource-redirect">
  <link rel="stylesheet" href="${origin}/archived-resource-style"></head><body><main id="archived" data-capture="unchanged"><h1>Archived Firefox page</h1>
  <a href="/historical">Archived original link</a><img src="${origin}/archived-resource-image"><script>document.body.textContent = "Site script ran"</script>
  <iframe src="${origin}/archived-resource-frame"></iframe></main></body></html>\r\n`;
    const firefox = await install(t);
    next = command();
    await configure(firefox, origin, token);
    const url = await eventually(
      async () => (await snapshotTabs(firefox))[0],
      "extension-owned snapshot tab",
    );
    const inspect = (expression) => firefox.inView(url, expression);
    await eventually(
      () =>
        inspect(
          `document.getElementById('title').textContent === 'Snapshot #386'`,
        ),
      "snapshot payload in Firefox",
    );
    const frame = await inspect(`(() => {
      const frame = document.getElementById('archive');
      return { sandbox: frame.getAttribute('sandbox'), documentIsolated: frame.contentDocument === null, html: frame.srcdoc };
    })()`);
    assert.equal(frame.sandbox, "");
    assert.equal(frame.documentIsolated, true);
    assert.match(
      frame.html,
      /data-capture="unchanged"[^>]*><h1>Archived Firefox page/,
    );
    assert.doesNotMatch(
      frame.html,
      /archived-resource|href="\/historical"|Site script ran/,
    );
    assert.equal(
      await inspect(`document.getElementById('original').textContent`),
      html,
    );
    const local = await inspect(`(() => {
      document.querySelector('[data-panel="selector"]').click();
      document.querySelectorAll('.locator button').forEach(button => button.click());
      return { title: document.querySelector('#selector h2').textContent,
        counts: Array.from(document.querySelectorAll('.locator .result'), node => node.textContent),
        diagnostics: document.querySelector('#selector details pre').textContent };
    })()`);
    assert.equal(local.title, "SelectorTree · Version 2");
    assert.deepEqual(local.counts, ["1 match", "1 match"]);
    assert.match(local.diagnostics, /Recorded evaluation/);
    await eventually(
      () => replies.length >= 2,
      "retry of lost acknowledgement",
    );
    assert.deepEqual(replies, [{ state: "opened" }, { state: "opened" }]);
    assert.equal(artifactCount, 1);

    for (const [mode, error] of [
      ["invalid", "SNAPSHOT_INTEGRITY_MISMATCH"],
      ["missing", "SNAPSHOT_ARTIFACT_NOT_FOUND"],
      ["timeout", "BACKEND_TIMEOUT"],
    ]) {
      artifactMode = mode;
      next = command();
      await eventually(
        () => replies.some((reply) => reply.errorCode === error),
        `${mode} acknowledgement`,
        22_000,
      );
      assert.deepEqual(replyFor(error), { state: "failed", errorCode: error });
      assert.deepEqual(await snapshotTabs(firefox), [url]);
    }
    assert.deepEqual(blockedRequests, []);
    function replyFor(errorCode) {
      return replies.find((reply) => reply.errorCode === errorCode);
    }
  },
);

test(
  "live Studio delivery opens Source #57 / Snapshot #386 in native Firefox",
  {
    timeout: 60_000,
    skip: !process.env.BURBOT_SNAPSHOT_BRIDGE_STUDIO_ORIGIN,
  },
  async (t) => {
    const firefox = await install(t);
    const { context } = firefox;
    const {
      BURBOT_SNAPSHOT_BRIDGE_STUDIO_ORIGIN,
      BURBOT_SNAPSHOT_BRIDGE_AGENT_TOKEN,
      BURBOT_SNAPSHOT_BRIDGE_API_ORIGIN,
      BURBOT_SNAPSHOT_BRIDGE_STORAGE_ORIGIN,
    } = process.env;
    await configure(
      firefox,
      BURBOT_SNAPSHOT_BRIDGE_API_ORIGIN,
      BURBOT_SNAPSHOT_BRIDGE_AGENT_TOKEN,
      BURBOT_SNAPSHOT_BRIDGE_STORAGE_ORIGIN,
    );
    const studio = await context.newPage();
    await studio.goto(
      `${BURBOT_SNAPSHOT_BRIDGE_STUDIO_ORIGIN}/#/monitoring/sources/57/snapshots/386`,
    );
    await eventually(
      () =>
        studio.evaluate(async () => {
          const response = await fetch(
            "/backend/monitoring/sources/57/snapshot-agents",
          );
          return response.ok && (await response.json()).length === 1;
        }),
      "live Firefox agent presence",
    );
    await studio.getByRole("button", { name: "Open in Firefox" }).click();
    await studio
      .getByText("Opened in Firefox", { exact: true })
      .waitFor({ timeout: 20_000 });
    const tab = await eventually(
      async () => (await snapshotTabs(firefox))[0],
      "live archived snapshot tab",
    );
    const shown = await eventually(
      () =>
        firefox.inView(
          tab,
          `(() => {
      const frame = document.getElementById('archive');
      return frame.srcdoc && { html: frame.srcdoc, title: document.getElementById('title').textContent,
        capture: document.getElementById('capture').textContent };
    })()`,
        ),
      "rendered archive in the live tab",
    );
    assert.match(shown.html, /<h1>Archived Firefox page<\/h1>/);
    assert.equal(shown.title, "Snapshot #386");
    assert.match(shown.capture, /Source #57/);
  },
);
