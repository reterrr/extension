import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { launch, until } from "./firefox.cjs";

const local = "http://127.0.0.1:8765";
const api = "/api/v1/extension-sync";
const settingsKey = "burbotBackendSynchronization";

async function request(origin, path, { body, method, token } = {}) {
  const response = await fetch(origin + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function startDb(file) {
  const service = spawn(process.execPath, ["scripts/db-server.mjs"], {
    env: { ...process.env, BURBOT_DB_PORT: "8765", BURBOT_DB_PATH: file },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  service.stderr.on("data", (chunk) => (errors += chunk.toString()));
  try {
    await until(
      async () => (await request(local, "/info")).path === file,
      "disposable SQLite service",
    );
    return async () => {
      if (service.exitCode !== null) return;
      const ended = once(service, "exit");
      service.kill("SIGTERM");
      await ended;
    };
  } catch (error) {
    service.kill("SIGTERM");
    throw new Error(errors || error.message);
  }
}

async function fixtureProxy(t, upstream) {
  const history = [];
  const control = { offline: false, dropCreate: false, dropCommit: false };
  const server = createServer(async (req, res) => {
    if (req.url === "/fixture")
      return res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(
          "<h1>Automatic project</h1><p id='independent'>Independent project</p>",
        );
    if (!req.url.startsWith(api + "/")) return res.writeHead(404).end();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const payload = bytes.length ? JSON.parse(bytes) : null;
    const entry = { path: req.url.slice(api.length), payload };
    history.push(entry);
    if (control.offline) {
      entry.offline = true;
      return res
        .writeHead(503, { "Content-Type": "application/json" })
        .end('{"detail":{"code":"BACKEND_UNAVAILABLE"}}');
    }
    try {
      const response = await fetch(upstream + req.url, {
        method: req.method,
        headers: {
          Authorization: req.headers.authorization,
          "Content-Type": "application/json",
        },
        body: bytes.length ? bytes : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      const content = await response.text();
      entry.status = response.status;
      entry.result = JSON.parse(content);
      if (response.ok && control.dropCreate && payload?.action === "create") {
        control.dropCreate = false;
        entry.dropped = true;
        return res.writeHead(503).end();
      }
      if (response.ok && control.dropCommit && entry.path === "/commits") {
        control.dropCommit = false;
        entry.dropped = true;
        return res.writeHead(503).end();
      }
      res
        .writeHead(response.status, { "Content-Type": "application/json" })
        .end(content);
    } catch {
      res.writeHead(503).end();
    }
  });
  const ready = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await ready;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  return {
    control,
    history,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}

async function probeDb(file, statement, ...args) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare(statement).all(...args);
  } finally {
    db.close();
  }
}

function summary() {
  return request(local, "/backend-sync/continuous");
}

async function send(options, type, op, args = {}) {
  const message = JSON.stringify({ type, op, ...args });
  await options(`(() => {
    globalThis.__syncTestReply = null;
    browser.runtime.sendMessage(${message}).then(
      (result) => { globalThis.__syncTestReply = result; },
      (error) => { globalThis.__syncTestReply = { ok: false, error: error.message }; },
    );
    return true;
  })()`);
  const result = await until(() => options("globalThis.__syncTestReply"), op);
  assert.equal(result.ok, true, result.error);
  return result.value;
}

async function optionsPage(firefox) {
  const url = await firefox.storage('browser.runtime.getURL("options.html")');
  await firefox.storage(
    `browser.tabs.create({ url: ${JSON.stringify(url)}, active: true })`,
  );
  return (expression) => firefox.webView(url, expression);
}

async function approvedCommit(page) {
  const view = await send(page, "BURBOT_COMMIT", "REVIEW_ALL", {
    decision: "save",
  });
  const expectedReview = view.objects.flatMap(({ reviewItems }) =>
    (reviewItems ?? [])
      .filter(({ selection }) => selection === "save")
      .map(({ id, fingerprint }) => ({ id, fingerprint })),
  );
  return send(page, "BURBOT_COMMIT", "COMMIT", { expectedReview });
}

async function editNote(page, objectId, value) {
  const state = await send(page, "BURBOT_DATA", "GET");
  return send(page, "BURBOT_DATA", "EDIT", {
    objectId,
    expectedRevision: state.revision,
    field: "notes",
    value,
  });
}

test(
  "Firefox automatically delivers approved SQLite commits to PostgreSQL across interruption",
  {
    timeout: 150_000,
    skip:
      !process.env.BURBOT_TEST_SYNC_ORIGIN ||
      !process.env.BURBOT_TEST_SYNC_TOKEN,
  },
  async (t) => {
    const upstream = process.env.BURBOT_TEST_SYNC_ORIGIN;
    const token = process.env.BURBOT_TEST_SYNC_TOKEN;
    const schema = await request(upstream, api + "/schema", { token });
    const remote = (path, body) =>
      request(upstream, api + path, { token, body });
    const preview = (identity) =>
      remote("/objects/resolve", {
        workspaceUuid: schema.workspaceUuid,
        identity,
        action: "preview",
      });
    const folder = await mkdtemp(join(tmpdir(), "burbot-continuous-firefox-"));
    const file = join(folder, "workspace.sqlite");
    const profile = join(folder, "firefox");
    let stopDb;
    let firefox;
    t.after(async () => {
      await firefox?.close().catch(() => undefined);
      await stopDb?.();
      await rm(folder, { recursive: true, force: true });
    });
    stopDb = await startDb(file);
    const existing = {
      id: randomUUID(),
      type: "project",
      values: { name: "Existing local project" },
    };
    await request(local, "/state", {
      method: "PUT",
      body: {
        version: 1,
        revision: 0,
        objects: [existing],
        rules: [],
      },
    });

    const { control, history, origin } = await fixtureProxy(t, upstream);
    firefox = await launch({ sourceDir: resolve("dist"), profileDir: profile });
    await firefox.storage(
      `browser.storage.local.set(${JSON.stringify({
        [settingsKey]: { origin, token, syncApprovedCommits: false },
      })})`,
    );
    let options = await optionsPage(firefox);
    const toggle = `[...document.querySelectorAll("label")].find(
    (label) => label.textContent.trim() === "Continuous Backend Sync"
  )?.querySelector("input")`;
    await until(
      () => options(`Boolean((${toggle}) && !(${toggle}).disabled)`),
      "Firefox continuous sync toggle",
    );
    await options(`((${toggle}).click(), true)`);
    await until(
      async () => (await summary()).mode,
      "continuous mode saved in SQLite",
    );
    assert.equal((await summary()).pending, 0);
    assert.equal(
      (await preview({ localObjectId: existing.id, localType: "project" }))
        .businessObjectId,
      null,
    );

    const stagedImport = await send(options, "BURBOT_DATA", "IMPORT", {
      expectedRevision: 0,
      document: {
        version: 1,
        offset_unit: "unicode_codepoint",
        sources: [],
        objects: [
          {
            key: "staged-import",
            type: "project",
            data: { name: "Staged import only" },
          },
        ],
      },
    });
    const imported = stagedImport.objects.find(
      (object) => object.values.name === "Staged import only",
    );
    assert.ok(imported);
    await send(options, "BURBOT_COMMIT", "STAGE_OBJECT", {
      objectId: imported.id,
    });
    assert.equal((await request(local, "/state")).objects.length, 1);
    assert.equal((await summary()).pending, 0);
    await send(options, "BURBOT_COMMIT", "DISCARD");

    await firefox.page.goto(origin + "/fixture");
    await firefox.page.bringToFront();
    const menuItems = await firefox.create("h1", "Projekt");
    assert.ok(menuItems.includes("Projekt"));
    const draft = await until(async () => {
      const state = await send(options, "BURBOT_DATA", "GET");
      return state.objects.find((obj) => obj.id !== existing.id);
    }, "new project in Firefox View");
    const identity = { localObjectId: draft.id, localType: "project" };
    assert.equal((await request(local, "/state")).objects.length, 1);
    assert.equal((await summary()).pending, 0);
    assert.equal(
      history.some(
        (entry) => entry.payload?.identity?.localObjectId === draft.id,
      ),
      false,
    );

    control.offline = true;
    const first = await approvedCommit(options);
    assert.equal(first.state.objects.length, 2);
    await editNote(options, draft.id, "First offline change");
    await approvedCommit(options);
    await editNote(options, draft.id, "Second offline change");
    const third = await approvedCommit(options);
    assert.equal(third.state.revision, 3);
    assert.equal((await summary()).pending, 1);
    await until(
      async () =>
        (await summary()).problems.some(
          (item) => item.code === "BACKEND_UNAVAILABLE",
        ),
      "offline backoff",
    );
    assert.equal(
      (
        await probeDb(
          file,
          "SELECT operation_id FROM backend_sync_operations WHERE identity_key IS NOT NULL AND work_kind='commit'",
        )
      ).length,
      3,
    );

    await firefox.close();
    firefox = undefined;
    await stopDb();
    stopDb = await startDb(file);
    assert.equal((await request(local, "/state")).revision, 3);
    control.offline = false;
    control.dropCreate = true;
    control.dropCommit = true;
    firefox = await launch({ sourceDir: resolve("dist"), profileDir: profile });
    assert.equal(
      await firefox.storage(
        `browser.storage.local.get(${JSON.stringify(settingsKey)}).then(row=>row[${JSON.stringify(settingsKey)}]?.origin)`,
      ),
      origin,
    );
    await until(
      async () => (await summary()).synced === 1,
      "automatic restart recovery",
      45_000,
    );
    const created = history.filter(
      (entry) => entry.payload?.action === "create" && entry.status === 200,
    );
    assert.equal(created.length, 1);
    assert.equal(created[0].dropped, true);
    let current = await preview(identity);
    assert.equal(current.businessObjectId, created[0].result.businessObjectId);
    assert.equal(current.objectFields.name.value, "Automatic project");
    assert.equal(current.objectFields.notes.value, "Second offline change");
    const commits = history.filter(
      (entry) => entry.path === "/commits" && entry.status === 200,
    );
    const lost = commits.find((entry) => entry.dropped);
    assert.ok(lost);
    const replay = commits.find(
      (entry) =>
        entry !== lost &&
        entry.payload.operationId === lost.payload.operationId,
    );
    assert.deepEqual(replay.payload, lost.payload);
    assert.deepEqual(replay.result, lost.result);
    assert.deepEqual(
      commits
        .at(-1)
        .payload.changes[0].fields.map((field) => field.persistentKey),
      ["notes"],
    );

    options = await optionsPage(firefox);
    await editNote(options, draft.id, "An ordinary bound update");
    await approvedCommit(options);
    current = await until(async () => {
      const object = await preview(identity);
      return (
        object.objectFields.notes.value === "An ordinary bound update" && object
      );
    }, "bound canonical value updated");
    await until(
      async () => (await summary()).synced === 1,
      "local acknowledgement recorded",
    );

    const slot = current.objectFields.notes;
    await remote("/commits", {
      workspaceUuid: schema.workspaceUuid,
      operationId: randomUUID(),
      schemaRevisionId: schema.revisionId,
      changes: [
        {
          identity,
          businessObjectId: current.businessObjectId,
          fields: [
            {
              persistentKey: "notes",
              expectedValueId: slot.valueId,
              fieldVersionId: slot.fieldVersionId,
              businessObjectFieldId: slot.businessObjectFieldId,
              value: "Concurrent server update",
            },
          ],
        },
      ],
    });
    const head = await send(options, "BURBOT_DATA", "GET");
    await send(options, "BURBOT_DATA", "EDIT", {
      objectId: draft.id,
      expectedRevision: head.revision,
      field: "status",
      value: "AKTYWNY",
    });
    await approvedCommit(options);
    await until(async () => {
      const result = await preview(identity);
      return (
        result.objectFields.status.value === "AKTYWNY" &&
        (await summary()).synced === 1
      );
    }, "unrelated field update after a server edit");
    await editNote(options, draft.id, "Local conflicting update");
    await approvedCommit(options);
    await firefox.page.goto(origin + "/fixture");
    await firefox.page.bringToFront();
    await firefox.create("#independent", "Projekt");
    const independent = await until(async () => {
      const state = await send(options, "BURBOT_DATA", "GET");
      return state.objects.find(
        (obj) => obj.values.name === "Independent project",
      );
    }, "independent Project in View");
    await approvedCommit(options);
    await until(async () => {
      const status = await summary();
      return status.synced === 1 && status.conflicts === 1;
    }, "conflicted object isolated from independent Project");
    assert.equal(
      (await preview({ localObjectId: independent.id, localType: "project" }))
        .objectFields.name.value,
      "Independent project",
    );
    assert.equal(
      (await preview(identity)).objectFields.notes.value,
      "Concurrent server update",
    );
    assert.ok(
      (await summary()).problems.some(
        (item) => item.code === "CANONICAL_VALUE_CHANGED",
      ),
    );
  },
);

test(
  "Firefox discovers the historical Nabór and resumes its approved document after one identity review",
  {
    timeout: 120_000,
    skip:
      !process.env.BURBOT_TEST_SYNC_ORIGIN ||
      !process.env.BURBOT_TEST_SYNC_TOKEN,
  },
  async (t) => {
    const upstream = process.env.BURBOT_TEST_SYNC_ORIGIN;
    const token = process.env.BURBOT_TEST_SYNC_TOKEN;
    const schema = await request(upstream, api + "/schema", { token });
    const resolveBinding = (identity, action = "preview") =>
      request(upstream, api + "/objects/resolve", {
        token,
        body: { workspaceUuid: schema.workspaceUuid, identity, action },
      });
    const project = {
      id: randomUUID(),
      type: "project",
      values: { name: "Historical Project" },
    };
    const recruitment = {
      id: randomUUID(),
      type: "recruitment",
      label: "Nabór BUR-I/2.3/2026",
      values: { external_number: "BUR-I/2.3/2026", project_id: project.id },
    };
    const parent = {
      localObjectId: recruitment.id,
      localType: recruitment.type,
    };
    const projectIdentity = {
      localObjectId: project.id,
      localType: project.type,
    };
    const persistedProject = await resolveBinding(projectIdentity, "create");
    const folder = await mkdtemp(join(tmpdir(), "burbot-reconcile-firefox-"));
    const file = join(folder, "workspace.sqlite");
    const stopDb = await startDb(file);
    let firefox;
    t.after(async () => {
      await firefox?.close().catch(() => undefined);
      await stopDb();
      await rm(folder, { recursive: true, force: true });
    });
    await request(local, "/state/commit", {
      body: {
        expectedRevision: 0,
        reviewedObjectIds: [project.id, recruitment.id],
        state: {
          version: 1,
          revision: 1,
          objects: [project, recruitment],
          rules: [],
        },
      },
    });
    assert.equal((await summary()).mode, null);
    const proxy = await fixtureProxy(t, upstream);
    firefox = await launch({
      sourceDir: resolve("dist"),
      profileDir: join(folder, "profile"),
    });
    await firefox.storage(
      `browser.storage.local.set(${JSON.stringify({
        [settingsKey]: {
          origin: proxy.origin,
          token,
          syncApprovedCommits: false,
        },
      })})`,
    );
    const options = await optionsPage(firefox);
    const button = (text) =>
      `[...document.querySelectorAll("button")].find(button => button.textContent.trim() === ${JSON.stringify(text)})`;
    const click = (text) =>
      until(
        () =>
          options(
            `(() => { const control = ${button(text)}; if (!control || control.disabled) return false; control.click(); return true; })()`,
          ),
        text,
      );
    await until(
      () =>
        options(
          `Boolean((${button("Start reconciliation")}) && !(${button("Start reconciliation")}).disabled)`,
        ),
      "initial reconciliation control",
    );
    await click("Start reconciliation");
    await until(async () => {
      const { reconciliation } = await summary();
      return reconciliation.identityReview === 1 && reconciliation.bound === 1;
    }, "one historical identity review and one recovered binding");
    const locallyCached = await request(local, "/backend-sync");
    assert.ok(
      locallyCached.bindings.some(
        (binding) =>
          binding.businessObjectId === persistedProject.businessObjectId,
      ),
    );
    assert.equal((await resolveBinding(parent)).businessObjectId, null);

    const state = await send(options, "BURBOT_DATA", "GET");
    const drafted = await send(
      options,
      "BURBOT_DATA",
      "ADD_DOCUMENT_REQUIREMENT",
      {
        objectId: recruitment.id,
        expectedRevision: state.revision,
      },
    );
    const [document] = drafted.documentRequirements;
    const documentLabel = "Otwiera w nowej karcie.docx";
    await send(options, "BURBOT_DATA", "UPDATE_DOCUMENT_REQUIREMENT", {
      objectId: recruitment.id,
      documentId: document.id,
      expectedRevision: drafted.revision,
      values: { label: documentLabel },
    });
    const approved = await approvedCommit(options);
    assert.equal(
      approved.state.documentRequirements?.[0]?.label,
      documentLabel,
    );
    const isWaiting = (item) =>
      item.identity.target?.id === document.id &&
      item.label.endsWith(documentLabel) &&
      item.status === "WAITING_DEPENDENCY" &&
      item.dependencies?.some(
        (dependency) =>
          dependency.identity?.localObjectId === recruitment.id &&
          dependency.upstreamCode === "IDENTITY_REVIEW_REQUIRED",
      );
    await until(
      async () => (await summary()).problems.some(isWaiting),
      "document waiting for the historical parent",
    ).catch(async (error) => {
      throw new Error(error.message + " " + JSON.stringify(await summary()), {
        cause: error,
      });
    });
    assert.equal(
      proxy.history.filter((entry) => entry.payload?.action === "create")
        .length,
      0,
    );
    assert.equal(
      proxy.history.filter((entry) => entry.path === "/commits").length,
      0,
    );
    await click("Review identities");
    const number = recruitment.values.external_number;
    await until(
      () =>
        options(
          `[...document.querySelectorAll('section[aria-label="Initial reconciliation"] .ui-sync-record')].some(row => row.textContent.includes(${JSON.stringify(number)}))`,
        ),
      "historical Nabór review",
    );
    await options(`(() => {
      window.confirm = () => true;
      const row = [...document.querySelectorAll('section[aria-label="Initial reconciliation"] .ui-sync-record')].find(row => row.textContent.includes(${JSON.stringify(number)}));
      row.querySelector('input[type="checkbox"]').click();
      return true;
    })()`);
    await click("Confirm selected identities");
    await until(
      async () => (await summary()).synced === 1,
      "automatic document continuation",
      35_000,
    );
    const recruitmentBinding = await resolveBinding(parent);
    const documentBinding = await resolveBinding({
      ...parent,
      target: { kind: "document", id: document.id },
    });
    assert.ok(recruitmentBinding.businessObjectId);
    assert.equal(recruitmentBinding.objectFields.external_number.value, null);
    assert.equal(
      documentBinding.objectFields.recruitment_owner.value,
      recruitmentBinding.businessObjectId,
    );
    assert.equal(documentBinding.objectFields.label.value, documentLabel);
    assert.deepEqual(
      proxy.history
        .filter((entry) => entry.payload?.action === "create")
        .map(
          ({ payload }) =>
            payload.identity.target?.kind ?? payload.identity.localType,
        ),
      ["recruitment", "document"],
    );

    await click("Review values");
    await until(
      () =>
        options(
          `[...document.querySelectorAll('section[aria-label="Initial reconciliation"] .ui-sync-record')].some(row => row.textContent.includes(${JSON.stringify(number)}))`,
        ),
      "historical value review",
    );
    await options(`(() => {
      const row = [...document.querySelectorAll('section[aria-label="Initial reconciliation"] .ui-sync-record')].find(row => row.textContent.includes(${JSON.stringify(number)}));
      row.querySelector('input[type="checkbox"]').click();
      return true;
    })()`);
    await click("Compare selected values for review");
    await until(
      () =>
        options(
          "document.getElementById('historical-value-preview')?.textContent.includes('BUR-I/2.3/2026')",
        ),
      "historical canonical comparison",
    );
    await click("Confirm server synchronization");
    await until(
      async () =>
        (await resolveBinding(parent)).objectFields.external_number.value ===
        "BUR-I/2.3/2026",
      "explicitly reviewed historical values",
    );
    assert.equal(
      (await resolveBinding(parent)).objectFields.project_id.value,
      persistedProject.businessObjectId,
    );
  },
);
