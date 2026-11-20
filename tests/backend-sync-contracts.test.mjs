import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import Database from "better-sqlite3";
import { build } from "esbuild";

const exec = promisify(execFile);
const workspaceUuid = "5cb57a1d-5dd7-4c22-bf16-d6c6071bbb4a";
const origin = "http://127.0.0.1:18033";
const BIG_ID = "9007199254741339";
const identity = { localObjectId: "PR_DOL_004", localType: "project" };
const record = {
  id: identity.localObjectId,
  type: "project",
  values: { status: "PLANOWANY" },
};
const initial = { version: 1, revision: 5, objects: [record], rules: [] };

const statusField = {
  localKey: "status",
  key: "status",
  persistentKey: "status",
  label: "Status projektu",
  businessEntityFieldId: "9007199254741066",
  fieldVersionId: "19",
  definition: { type: "enum", enum_values: ["PLANOWANY", "AKTYWNY"] },
  aliases: { ACTIVE: "AKTYWNY" },
};
const registry = {
  workspaceUuid,
  businessModelId: "1",
  name: "Burbot PSF/BUR",
  revisionId: "15",
  aliases: {
    nabor: { entity: "recruitment", fields: { title: "external_number" } },
  },
  permissions: { create: true, bindExisting: true, commit: true },
  sources: [],
  entities: [
    {
      localType: "project",
      key: "Project",
      label: "Projekt",
      businessEntityId: "9",
      entityVersionId: "16",
      fields: [statusField],
    },
  ],
};
const bound = {
  identity,
  status: "SYNCED",
  businessModelId: "1",
  schemaRevisionId: "15",
  businessEntityId: "9",
  businessObjectId: BIG_ID,
  objectFields: {
    status: {
      businessEntityFieldId: statusField.businessEntityFieldId,
      businessObjectFieldId: "9007199254742000",
      fieldVersionId: "19",
      valueId: "9007199254742500",
      value: "PLANOWANY",
      collectionRevision: null,
    },
  },
};

async function load(file) {
  const result = await build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const text = result.outputFiles[0].text + "\n// " + crypto.randomUUID();
  return import(
    "data:text/javascript;base64," + Buffer.from(text).toString("base64")
  );
}

test("schema manifest is generated from all current ordinary and legacy definitions", async () => {
  await import("../src/shared/domain/schema.js");
  const manifest = JSON.parse(
    (await exec(process.execPath, ["scripts/export-business-schema.mjs"]))
      .stdout,
  );
  for (const kind of ["project", "recruitment", "operator"]) {
    const current = globalThis.BurbotSchema[kind].fields;
    const found = manifest.entities.find((entity) => entity.localType === kind);
    for (const key of Object.getOwnPropertyNames(current)) {
      const field = found.fields.find((row) => row.key === key);
      assert.equal(field.persistentKey, key);
      assert.equal(field.type, current[key].type);
      assert.deepEqual(field.options, current[key].options);
    }
  }
  assert.equal(manifest.aliases.nabor.entity, "recruitment");
  assert.equal(
    manifest.entities
      .find((e) => e.localType === "funding")
      .fields.find((f) => f.key === "max_amount_pln").type,
    "money",
  );
  assert.equal(
    manifest.entities
      .find((e) => e.localType === "document")
      .fields.find((f) => f.key === "source_file_source_ids").cardinality,
    "many",
  );
});

test("resolver uses persistent field keys and current versions while preserving bigint IDs", async () => {
  const implementation = await load("src/shared/backend-sync/resolve.ts");
  const state = {
    workspaceUuid,
    registry,
    backendOrigin: origin,
    bindings: [bound],
    operations: [],
    selectors: [],
  };
  const resolved = implementation.resolveBusinessField(
    state,
    identity,
    "status",
  );
  assert.equal(resolved.field.businessObjectId, BIG_ID);
  assert.equal(resolved.field.businessObjectFieldId, "9007199254742000");
  assert.equal(
    implementation.resolveBusinessField(state, identity, "Status projektu")
      .status,
    "UNRESOLVED",
  );
  const newer = structuredClone(state);
  newer.registry.revisionId = "18";
  newer.registry.entities[0].fields[0].key = "server_status";
  newer.registry.entities[0].fields[0].fieldVersionId = "22";
  assert.equal(
    implementation.resolveBusinessField(newer, identity, "status").field
      .fieldVersionId,
    "22",
  );
  const final = {
    ...initial,
    revision: 6,
    objects: [{ ...record, values: { status: "ACTIVE" } }],
  };
  const plan = implementation.makeCommitPreview(state, initial, final);
  assert.equal(plan.operation.request.changes[0].fields[0].value, "AKTYWNY");
  assert.equal(
    plan.operation.request.changes[0].fields[0].expectedValueId,
    bound.objectFields.status.valueId,
  );
  const outdated = implementation.makeCommitPreview(newer, initial, final);
  assert.equal(outdated.operation.request, null);
  assert.equal(
    outdated.operation.skipped[0].reason,
    "BINDING_REFRESH_REQUIRED",
  );
});

async function ephemeralPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startStateService(port, file) {
  const processImpl = spawn(process.execPath, ["scripts/db-server.mjs"], {
    env: { ...process.env, BURBOT_DB_PORT: String(port), BURBOT_DB_PATH: file },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  processImpl.on("error", (error) => {
    logs += String(error);
  });
  for (const output of [processImpl.stdout, processImpl.stderr])
    output.on("data", (chunk) => {
      logs += chunk.toString();
    });
  const local = "http://127.0.0.1:" + port;
  for (let i = 0; i < 70; i++) {
    try {
      if ((await fetch(local + "/health")).ok) return processImpl;
    } catch {
      if (processImpl.exitCode != null) break;
    }
    await delay(30);
  }
  processImpl.kill();
  throw new Error("SQLite test service did not start. " + logs);
}

async function stop(impl) {
  if (impl?.exitCode === null) {
    const exited = once(impl, "exit");
    impl.kill("SIGTERM");
    await exited;
  }
}

test("SQLite migration preserves IDs and staged sync survives offline restart", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "burbot-sync-"));
  const file = join(folder, "workspace.sqlite");
  const sql = await readFile("scripts/db/schema.sql", "utf8");
  const old = new Database(file);
  old.exec(sql.split("-- Workspace namespaces")[0]);
  old.pragma("user_version=14");
  old
    .prepare(
      "INSERT INTO workspace_state (id,revision,state_json,updated_at) VALUES (1,?,?,?)",
    )
    .run(initial.revision, JSON.stringify(initial), new Date().toISOString());
  old.close();
  const port = await ephemeralPort();
  let service = await startStateService(port, file);
  t.after(async () => {
    await stop(service);
    await rm(folder, { recursive: true, force: true });
  });
  const url = "http://127.0.0.1:" + port;
  const fromLocal = async (path, value) => {
    const result = await fetch(
      url + path,
      value === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
          },
    );
    assert.ok(result.ok, await result.clone().text());
    return result.json();
  };
  assert.equal((await fromLocal("/info")).schemaVersion, 15);
  assert.deepEqual(await fromLocal("/state"), initial);
  const { workspaceUuid: generated } = await fromLocal("/backend-sync");
  assert.match(generated, /^[0-9a-f-]{36}$/);
  await fromLocal("/backend-sync/registry", { origin, registry });
  await fromLocal("/backend-sync/binding", { workspaceUuid, object: bound });

  const { makeCommitPreview } = await load(
    "src/shared/backend-sync/resolve.ts",
  );
  const final = {
    ...initial,
    revision: 6,
    objects: [{ ...record, values: { status: "AKTYWNY" } }],
  };
  const prepared = makeCommitPreview(
    await fromLocal("/backend-sync"),
    initial,
    final,
  );
  await fromLocal("/state/commit", {
    expectedRevision: 5,
    state: final,
    operation: prepared.operation,
  });
  assert.equal(
    (await fromLocal("/backend-sync")).operations[0].status,
    "PENDING",
  );

  await stop(service);
  service = await startStateService(port, file);
  const fresh = await fromLocal("/backend-sync");
  assert.equal(fresh.workspaceUuid, workspaceUuid);
  assert.equal(fresh.bindings[0].businessObjectId, BIG_ID);
  assert.deepEqual(await fromLocal("/state"), final);
  const { operationId } = prepared.operation;
  await fromLocal("/backend-sync/finish", {
    workspaceUuid,
    operationId,
    status: "SYNC_ERROR",
    result: { code: "BACKEND_UNAVAILABLE" },
  });
  const retry = await fromLocal("/backend-sync");
  assert.deepEqual(retry.operations[0].request, prepared.operation.request);
  assert.equal(retry.operations[0].status, "SYNC_ERROR");

  await fromLocal("/backend-sync/finish", {
    workspaceUuid,
    operationId,
    status: "CONFLICT",
    result: { code: "CANONICAL_VALUE_CHANGED", object: bound },
  });
  assert.equal(
    (await fromLocal("/backend-sync")).operations[0].status,
    "CONFLICT",
  );
  assert.deepEqual(await fromLocal("/state"), final);

  const another = structuredClone(prepared.operation);
  another.workspaceUuid = crypto.randomUUID();
  const failed = await fetch(url + "/state/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevision: 6,
      state: { ...final, revision: 7 },
      operation: another,
    }),
  });
  assert.equal(failed.status, 409);
  assert.deepEqual(await fromLocal("/state"), final);
});
