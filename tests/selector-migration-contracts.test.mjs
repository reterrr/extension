import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}
async function startService(path) {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/db-server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      BURBOT_DB_PATH: path,
      BURBOT_DB_PORT: String(port),
      BURBOT_DB_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`DB service startup timeout: ${stderr}`));
    }, 15000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`DB service exited ${code}: ${stderr}`));
    });
    child.stdout.on("data", (data) => {
      if (String(data).includes("Burbot DB service:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    },
  };
}
const getState = async (service) =>
  (await fetch(`${service.url}/state`)).json();
const putState = async (service, state) =>
  fetch(`${service.url}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });

test("existing v13 SQLite migrates atomically, survives service restart, and retains View/Commit behavior", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "burbot-selector-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "workspace.sqlite");
  const schema = (
    await readFile(join(root, "scripts/db/schema.sql"), "utf8")
  ).replace(
    /CREATE TABLE IF NOT EXISTS selectors[\s\S]*$/,
    "PRAGMA user_version = 13;",
  );
  const db = new Database(path);
  db.exec(schema);
  const original = {
    version: 1,
    revision: 7,
    objects: [
      {
        id: "R_42",
        type: "project",
        values: { name: "80%", status: "AKTYWNY" },
      },
    ],
    rules: [
      {
        id: "old-id-9",
        objectId: "R_42",
        field: "name",
        pageUrl: "https://example.test/",
        selector: "#funding",
        extraction: { type: "text", selectorFallbacks: [".funding"] },
        sampleValue: "80%",
        createdAt: "2026-11-17T10:00:00.000Z",
      },
    ],
  };
  db.prepare("INSERT INTO workspace_state VALUES (1, ?, ?, ?)").run(
    original.revision,
    JSON.stringify(original),
    "2026-11-17T10:00:00Z",
  );
  db.close();
  await build({
    absWorkingDir: root,
    entryPoints: {
      repository: "src/shared/selectors/repository.ts",
      staging: "src/shared/commits/staging.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: directory,
    logLevel: "silent",
  });
  const repository = await import(
    pathToFileURL(join(directory, "repository.js"))
  );
  const staging = await import(pathToFileURL(join(directory, "staging.js")));
  let service = await startService(path);
  t.after(() => service.stop());
  const migrated = await getState(service);
  assert.equal(migrated.revision, 7);
  assert.deepEqual(migrated.objects, original.objects);
  assert.equal(
    migrated.rules[0].selectorTree.selector.migration.legacyRuleId,
    "old-id-9",
  );
  const activeBefore = structuredClone(
    migrated.rules[0].selectorTree.versions[0],
  );
  const info = await (await fetch(`${service.url}/info`)).json();
  assert.equal(info.schemaVersion, 17);
  await service.stop();
  service = await startService(path);
  assert.deepEqual(await getState(service), migrated);

  // An older pending View can commit unchanged bare rules without losing the mapping.
  const oldView = structuredClone(original);
  oldView.revision++;
  assert.equal((await putState(service, oldView)).status, 200);
  assert.deepEqual(
    (await getState(service)).rules[0].selectorTree,
    migrated.rules[0].selectorTree,
  );

  const base = await getState(service);
  const working = repository.mutateSelectorState(
    base,
    {
      op: "SELECTOR_CREATE_DRAFT",
      objectId: "R_42",
      ruleId: "old-id-9",
      expectedRevision: base.revision,
    },
    "2026-11-17T11:00:00Z",
  );
  const draftVersion = working.rules[0].selectorTree.versions[1];
  draftVersion.recipes[0].parts[0].locators[0].selector = "#updated";
  const approved = repository.mutateSelectorState(
    working,
    {
      op: "SELECTOR_ACTIVATE_DRAFT",
      objectId: "R_42",
      ruleId: "old-id-9",
      versionUuid: draftVersion.uuid,
      expectedRevision: working.revision,
    },
    "2026-11-17T12:00:00Z",
  );
  // Creating/editing/approving in View has made no SQLite write.
  assert.deepEqual(await getState(service), base);
  assert.deepEqual(working.rules[0].selectorTree.versions[0], activeBefore);
  const draft = {
    baseState: base,
    workingState: approved,
    baseRevision: base.revision,
    stagedObjectIds: [],
  };
  assert.deepEqual(staging.applyStagedObjects(draft).rules, base.rules);
  draft.stagedObjectIds = ["R_42"];
  const committed = staging.applyStagedObjects(draft);
  committed.revision = base.revision + 1;
  assert.equal((await putState(service, committed)).status, 200);
  assert.equal(
    (await getState(service)).rules[0].selectorTree.versions[1].status,
    "active",
  );

  const invalid = structuredClone(committed);
  invalid.rules[0].selectorTree.versions[1].recipes[0].parts[0].locators[0].selector =
    "#silently-changed";
  invalid.objects[0].values.name = "Must roll back";
  const rejected = await putState(service, invalid);
  assert.equal(rejected.status, 500);
  assert.match((await rejected.json()).error, /immutable/);
  assert.deepEqual(await getState(service), committed);
  await service.stop();
  service = await startService(path);
  assert.deepEqual(await getState(service), committed);
  const inspection = new Database(path, { readonly: true });
  assert.equal(
    inspection.prepare("SELECT count(*) AS n FROM selector_versions").get().n,
    2,
  );
  assert.equal(
    inspection.prepare("SELECT count(*) AS n FROM selector_locators").get().n,
    4,
  );
  assert.equal(inspection.prepare("PRAGMA foreign_key_check").all().length, 0);
  inspection.close();

  const oldChangedView = structuredClone(original);
  oldChangedView.rules[0].selector = "#legacy-pending-edit";
  oldChangedView.revision = committed.revision + 1;
  assert.equal((await putState(service, oldChangedView)).status, 200);
  const withLegacyDraft = await getState(service);
  assert.deepEqual(
    withLegacyDraft.rules[0].selectorTree.versions.slice(0, 2),
    committed.rules[0].selectorTree.versions,
  );
  assert.equal(
    withLegacyDraft.rules[0].selectorTree.versions[2].status,
    "draft",
  );
  assert.equal(
    withLegacyDraft.rules[0].selectorTree.selector.activeVersionUuid,
    committed.rules[0].selectorTree.selector.activeVersionUuid,
  );
});
