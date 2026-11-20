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
  assert.equal((await fromLocal("/info")).schemaVersion, 16);
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

const page = "https://example.org/project";
const createdAt = "2026-11-17T10:00:00.000Z";

function localRule(id, pageUrl, rules = {}) {
  const uuid = crypto.randomUUID();
  const version = crypto.randomUUID();
  const objectId = rules.objectId ?? identity.localObjectId;
  const field = rules.field ?? "status";
  const target = {
    objectId,
    field,
    ...(rules.target && { target: rules.target }),
  };
  return {
    id,
    objectId,
    field,
    pageUrl,
    extraction: { type: "text" },
    createdAt,
    ...rules,
    selectorTree: {
      selector: {
        uuid,
        target,
        pageUrl,
        createdAt,
        activeVersionUuid: version,
      },
      versions: [
        {
          uuid: version,
          selectorUuid: uuid,
          versionNo: 1,
          status: "active",
          createdAt,
          reviewedAt: createdAt,
          reviewedBy: "local reviewer",
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
                      selector: "#status",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function importedSource(id, url, type = "HTML") {
  return {
    id,
    importKey: "key-" + id,
    url,
    type,
    importedAt: createdAt,
    snapshot: { text: "local-only" },
  };
}

test("discovery preserves query identity, Source provenance, and explicit URL choices", async () => {
  const { canonicalSourceUrl, discoverSources } = await load(
    "src/shared/backend-sync/sourceDiscovery.ts",
  );
  assert.equal(
    canonicalSourceUrl("HTTPS://EXAMPLE.org:443/a/../project#details"),
    page,
  );
  assert.equal(
    canonicalSourceUrl("https://faß.de/zażółć"),
    "https://xn--fa-hia.de/za%C5%BC%C3%B3%C5%82%C4%87",
  );
  assert.equal(
    canonicalSourceUrl("http://example.org:80/path//a%2fb?#section"),
    "http://example.org/path//a%2fb?",
  );
  for (const unsafe of [
    "file:///tmp/export.pdf",
    "https:///example.org",
    "https://@example.org/",
    "https://name:password@example.org/",
    "https://%65xample.org/",
    "http://127.0.0.1/path",
    "https://0x7f000001/",
    "http://intranet.local/",
    "https://example.org/path%zz",
    "https://example.org/?token",
    "https://example.org/?token=foo",
  ])
    assert.throws(() => canonicalSourceUrl(unsafe));

  const first = localRule("a", page + "#one");
  const second = localRule("b", page + "#two");
  second.selectorTree.selector.sourceUuid = "local-import";
  const third = localRule("c", page + "?year=2026");
  third.selectorEvaluations = [
    { uuid: "evaluation-1", pageUrl: page + "?year=2025" },
  ];
  const uuidOnly = localRule("d", "");
  uuidOnly.selectorTree.selector.sourceUuid = "key-local-import";
  const missing = localRule("e", "", { objectId: "unknown" });
  const state = {
    ...initial,
    rules: [first, second, third, uuidOnly, missing],
    importSources: [
      importedSource("local-import", page),
      importedSource("pdf", page + ".pdf", "PDF"),
      importedSource("docx", page + ".docx", "DOCX"),
    ],
    fileSources: [
      {
        id: "file-a",
        fileType: "PDF",
        url: page + ".pdf#section",
        sourcePageUrl: page,
      },
      {
        id: "file-b",
        fileType: "PDF",
        sourceImportKey: "key-pdf",
        sourcePageImportKey: "key-local-import",
      },
    ],
  };
  const original = structuredClone(state);
  const discovered = discoverSources(state);
  assert.deepEqual(discoverSources(state), discovered);
  assert.equal(discovered.pendingEvidence, 1);
  const byRule = (id) =>
    discovered.selectors.find(({ rule }) => rule.id === id);
  assert.deepEqual(byRule("a").sourceKeys, byRule("b").sourceKeys);
  assert.deepEqual(byRule("a").sourceKeys, byRule("d").sourceKeys);
  assert.equal(byRule("e").sourceKeys.length, 0);
  const html = discovered.sources.find((source) => source.url === page);
  assert.equal(html.selectorUuids.length, 3);
  assert.ok(html.provenance.includes("file-source-page:file-b"));
  assert.ok(
    html.localKeys.includes(JSON.stringify(["import", "local-import"])),
  );
  const pdf = discovered.sources.find((source) => source.url === page + ".pdf");
  assert.equal(pdf.type, "PDF");
  assert.deepEqual(pdf.selectorUuids, []);
  assert.ok(pdf.provenance.includes("file:file-b"));
  assert.equal(
    discovered.sources.find((source) => source.url === page + ".docx").issue,
    "UNSUPPORTED",
  );
  assert.equal(byRule("c").sourceKeys.length, 2);
  const corrected = discoverSources(state, {
    [third.selectorTree.selector.uuid]: page + "?year=2026#corrected",
  });
  const correction = corrected.selectors.find(({ rule }) => rule.id === "c");
  assert.equal(correction.sourceKeys.length, 1);
  assert.equal(
    corrected.sources.find((source) => source.key === correction.sourceKeys[0])
      .url,
    page + "?year=2026",
  );
  assert.deepEqual(state, original);
});

test("bulk preview is read-only and exact approved work resumes after SQLite and network interruption", async (t) => {
  const { discoverSources } = await load(
    "src/shared/backend-sync/sourceDiscovery.ts",
  );
  const { approveBulkPreview, makeBulkPreview } = await load(
    "src/shared/backend-sync/bulkPlanner.ts",
  );
  const { executeBulkJob } = await load(
    "src/shared/backend-sync/bulkExecutor.ts",
  );
  const { startBulkJob } = await load("src/shared/backend-sync/client.ts");
  const { createBackendSyncStore } =
    await import("../scripts/db/backend-sync.mjs");
  const folder = await mkdtemp(join(tmpdir(), "burbot-bulk-sync-"));
  const file = join(folder, "workspace.sqlite");
  const sql = await readFile("scripts/db/schema.sql", "utf8");
  const previous = new Database(file);
  previous.exec(sql.split("-- Bulk sync keeps approved operations")[0]);
  previous.pragma("user_version=15");
  const project = localRule("project", page + "#name");
  const localSourceId = crypto.randomUUID();
  project.selectorTree.selector.sourceUuid = localSourceId;
  const nestedTarget = { kind: "document", id: "doc-1" };
  const nested = localRule("nested", page + "#document", {
    target: nestedTarget,
  });
  const separate = localRule("separate", page + "?year=2026");
  const unresolved = localRule("unknown", page, { objectId: "not-bound" });
  const ambiguous = localRule("ambiguous", page);
  ambiguous.selectorTree.selector.pageUrl = page + "?year=2026";
  const conflict = localRule("conflict", page);
  const notSelected = localRule("not-selected", page);
  const nestedRegistry = {
    ...registry,
    entities: [
      ...registry.entities,
      {
        localType: "document",
        key: "DocumentRequirement",
        label: "Document",
        businessEntityId: "27",
        entityVersionId: "29",
        fields: [{ ...statusField, businessEntityFieldId: "30" }],
      },
    ],
  };
  const nestedBound = {
    ...bound,
    identity: { ...identity, target: nestedTarget },
    businessEntityId: "27",
    businessObjectId: "9007199254743099",
    objectFields: {
      status: {
        ...bound.objectFields.status,
        businessEntityFieldId: "30",
        businessObjectFieldId: "9007199254743002",
      },
    },
  };
  const state = {
    ...initial,
    objects: [
      {
        ...record,
        evidence: {
          status: [
            {
              sourceId: localSourceId,
              rawValue: "historic local literal",
              charStart: 1,
              charEnd: 2,
            },
          ],
        },
      },
    ],
    importSources: [importedSource(localSourceId, page)],
    documentRequirements: [
      {
        id: nestedTarget.id,
        objectId: identity.localObjectId,
        label: "Document",
      },
    ],
    rules: [
      project,
      nested,
      separate,
      unresolved,
      ambiguous,
      conflict,
      notSelected,
    ],
  };
  previous
    .prepare(
      "INSERT INTO workspace_state (id,revision,state_json,updated_at) VALUES (1,?,?,?)",
    )
    .run(state.revision, JSON.stringify(state), createdAt);
  const oldStore = createBackendSyncStore(previous);
  oldStore.registry({ origin, registry: nestedRegistry });
  oldStore.binding({ workspaceUuid, object: bound });
  oldStore.binding({ workspaceUuid, object: nestedBound });
  previous.close();

  const port = await ephemeralPort();
  let service = await startStateService(port, file);
  const actualFetch = globalThis.fetch;
  const localOrigin = "http://127.0.0.1:" + port;
  const fromLocal = async (path) =>
    (await actualFetch(localOrigin + path)).json();
  t.after(async () => {
    globalThis.fetch = actualFetch;
    await stop(service);
    await rm(folder, { recursive: true, force: true });
  });

  const created = new Map();
  const published = new Map();
  const requests = [];
  let dropSecondSource = true;
  let dropFirstSelector = true;
  const settings = {
    origin,
    token: "x".repeat(43),
    syncApprovedCommits: false,
  };
  const json = (result, status = 200) =>
    new Response(JSON.stringify(result), { status });
  globalThis.fetch = async (url, init) => {
    const api = new URL(url);
    if (api.origin === "http://127.0.0.1:8765")
      return actualFetch(localOrigin + api.pathname + api.search, init);
    if (api.origin !== origin) return actualFetch(url, init);
    const path = api.pathname.replace("/api/v1/extension-sync", "");
    const request = init?.body && JSON.parse(init.body);
    requests.push({ path, request });
    assert.equal(init.headers.Authorization, "Bearer " + settings.token);
    if (path === "/schema") return json(nestedRegistry);
    if (path === "/sources/preview" || path === "/sources/resolve") {
      const apply = path.endsWith("resolve");
      if (apply) {
        assert.equal(request.sources.length, 1);
        assert.equal(request.sources[0].allowGrantExisting, false);
      }
      const items = request.sources.map((source) => {
        if (apply && !created.has(source.url)) {
          assert.ok(source.allowCreate);
          created.set(
            source.url,
            String(BigInt(BIG_ID) + BigInt(created.size)),
          );
        }
        const sourceId = created.get(source.url);
        return {
          ...source,
          canonicalUrl: source.url,
          ...(sourceId
            ? { sourceId, status: apply ? "RESOLVED" : "EXISTING_SOURCE" }
            : { status: "SOURCE_MISSING", canCreate: true }),
        };
      });
      if (
        apply &&
        items[0].canonicalUrl.includes("year=") &&
        dropSecondSource
      ) {
        dropSecondSource = false;
        throw new TypeError("Network interrupted after Source registration");
      }
      return json({ items });
    }
    if (path === "/selectors/preview") {
      const items = request.selectors.map(
        ({ tree, identity: local, sourceUrl }) => {
          const selectorUuid = tree.selector.uuid;
          assert.equal(local.localObjectId, identity.localObjectId);
          assert.ok(sourceUrl.startsWith(page));
          if (selectorUuid === conflict.selectorTree.selector.uuid)
            return {
              selectorUuid,
              status: "SELECTOR_CONFLICT",
              reason: "SELECTOR_SERVER_TARGET_MISMATCH",
            };
          const slot = (local.target ? nestedBound : bound).objectFields.status;
          const binding = published.get(selectorUuid)?.binding;
          return {
            selectorUuid,
            businessObjectFieldId: slot.businessObjectFieldId,
            revision: binding?.revision ?? null,
            status: binding ? "ALREADY_SYNCED" : "SELECTOR_REVIEW_REQUIRED",
            binding,
          };
        },
      );
      return json({ schemaRevisionId: registry.revisionId, items });
    }
    if (path === "/selectors") {
      const selected = request.identity.target ? nestedBound : bound;
      const selectorUuid = request.tree.selector.uuid;
      assert.equal(request.sourceId, created.get(request.sourceUrl));
      assert.equal(request.expectedRevision, null);
      assert.equal(request.publishReviewed, true);
      assert.equal(request.expectedSchemaRevisionId, registry.revisionId);
      assert.equal(
        request.expectedBusinessObjectFieldId,
        selected.objectFields.status.businessObjectFieldId,
      );
      assert.ok(
        !published.has(selectorUuid),
        "Accepted selectors must be recovered with a preview",
      );
      const binding = {
        status: "SYNCED",
        selectorUuid,
        revision: "0",
        sourceId: request.sourceId,
        businessObjectId: selected.businessObjectId,
        field: selected.objectFields.status,
      };
      published.set(selectorUuid, { binding, tree: request.tree });
      if (
        selectorUuid === project.selectorTree.selector.uuid &&
        dropFirstSelector
      ) {
        dropFirstSelector = false;
        throw new TypeError("Network interrupted after selector acceptance");
      }
      return json(binding);
    }
    assert.fail("Unexpected remote write or read " + path);
  };

  assert.equal((await fromLocal("/info")).schemaVersion, 16);
  const sqliteState = await fromLocal("/state");
  const before = await fromLocal("/backend-sync");
  const discovery = discoverSources(sqliteState);
  const preview = await makeBulkPreview(settings, sqliteState, discovery);
  assert.deepEqual(await fromLocal("/backend-sync"), before);
  assert.deepEqual(await fromLocal("/backend-sync/bulk"), {
    jobs: [],
    sources: [],
  });
  assert.ok(
    requests.every(
      ({ path }) => path === "/schema" || path.endsWith("/preview"),
    ),
  );
  assert.equal(preview.sources.length, 2);
  assert.equal(preview.pendingEvidence, 1);
  assert.equal(preview.selectors.length, 4, JSON.stringify(preview.rows));
  assert.equal(
    preview.rows.filter((entry) => entry.status === "OBJECT_UNRESOLVED").length,
    1,
  );
  assert.equal(
    preview.rows.filter((entry) => entry.status === "SOURCE_AMBIGUOUS").length,
    1,
  );
  assert.equal(
    preview.rows.filter((entry) => entry.status === "SELECTOR_CONFLICT").length,
    1,
  );
  const keys = new Set([
    ...preview.sources.map(({ key }) => key),
    ...[project, nested, separate].map(
      (rule) => "selector:" + rule.selectorTree.selector.uuid,
    ),
  ]);
  assert.throws(() => approveBulkPreview(preview, keys, false), /reviewed/i);
  assert.throws(
    () =>
      approveBulkPreview(
        preview,
        new Set(["selector:" + project.selectorTree.selector.uuid]),
        true,
      ),
    /Source/i,
  );
  const approved = approveBulkPreview(preview, keys, true);
  await assert.rejects(
    startBulkJob({ ...approved, localRevision: approved.localRevision - 1 }),
    /workspace changed/,
  );
  const options = { sourceBatchSize: 1, selectorConcurrency: 1, retries: 0 };
  await startBulkJob(approved);
  await assert.rejects(
    executeBulkJob(settings, approved.operationId, {
      ...options,
      sourceBatchSize: 0,
    }),
    /batch size/,
  );
  const partial = await executeBulkJob(settings, approved.operationId, options);
  assert.equal(
    partial.progress.filter((item) => item.status === "SYNCED").length,
    2,
  );
  assert.equal(
    partial.progress.filter((item) => item.status === "SYNC_ERROR").length,
    2,
  );
  assert.equal(
    partial.progress.filter((item) => item.status === "BLOCKED").length,
    1,
  );
  assert.deepEqual(
    (await fromLocal("/backend-sync/bulk")).jobs.map(({ synced, failed }) => ({
      synced,
      failed,
    })),
    [{ synced: 2, failed: 3 }],
  );

  await stop(service);
  service = await startStateService(port, file);
  const persisted = await fromLocal(
    "/backend-sync/bulk?operationId=" + approved.operationId,
  );
  assert.deepEqual(persisted.progress, partial.progress);
  assert.deepEqual(persisted.tasks, approved.tasks);
  const completed = await executeBulkJob(
    settings,
    approved.operationId,
    options,
  );
  assert.ok(completed.progress.every(({ status }) => status === "SYNCED"));
  assert.deepEqual(await fromLocal("/state"), sqliteState);
  const saved = await fromLocal("/backend-sync");
  assert.deepEqual(saved.bindings, before.bindings);
  assert.deepEqual(saved.operations, []);
  assert.equal(
    saved.selectors.find(
      (item) => item.selectorUuid === nested.selectorTree.selector.uuid,
    ).businessObjectId,
    nestedBound.businessObjectId,
  );
  assert.equal(
    saved.selectors.find(
      (item) => item.selectorUuid === project.selectorTree.selector.uuid,
    ).sourceId,
    BIG_ID,
  );
  const sources = await fromLocal("/backend-sync/bulk");
  assert.ok(
    sources.sources.every((item) => typeof item.backendSourceId === "string"),
  );
  assert.equal(
    sources.sources.find(
      ({ localSourceKey }) =>
        localSourceKey === JSON.stringify(["import", localSourceId]),
    ).backendSourceId,
    BIG_ID,
  );
  assert.equal(
    sources.sources.find(({ canonicalUrl }) =>
      canonicalUrl.includes("year=2026"),
    ).backendSourceId,
    "9007199254741340",
  );
  for (const { selectorTree } of [project, nested, separate])
    assert.deepEqual(
      published.get(selectorTree.selector.uuid).tree,
      selectorTree,
    );
  assert.equal(published.size, 3);
  assert.equal(created.size, 2);
  assert.equal(requests.filter(({ path }) => path === "/selectors").length, 3);
  assert.equal(
    requests.filter(({ path }) => path === "/sources/resolve").length,
    3,
  );

  const requestCount = requests.length;
  assert.deepEqual(
    await executeBulkJob(settings, approved.operationId, options),
    completed,
  );
  assert.equal(requests.length, requestCount);
  const rerun = await makeBulkPreview(settings, sqliteState, discovery);
  assert.equal(
    rerun.rows.filter(
      ({ kind, status }) => kind === "selector" && status === "ALREADY_SYNCED",
    ).length,
    3,
  );
  const second = approveBulkPreview(rerun, keys, false);
  await startBulkJob(second);
  const confirmedAgain = await executeBulkJob(
    settings,
    second.operationId,
    options,
  );
  assert.ok(confirmedAgain.progress.every(({ status }) => status === "SYNCED"));
  assert.equal(published.size, 3);
  assert.equal(created.size, 2);
  assert.equal(requests.filter(({ path }) => path === "/selectors").length, 3);
});
