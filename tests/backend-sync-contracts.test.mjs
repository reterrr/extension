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
  assert.equal((await fromLocal("/info")).schemaVersion, 18);
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

  assert.equal((await fromLocal("/info")).schemaVersion, 18);
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

async function continuousFixture(
  t,
  { unlinked = false, state = initial } = {},
) {
  const folder = await mkdtemp(join(tmpdir(), "burbot-continuous-sqlite-"));
  const file = join(folder, "workspace.sqlite");
  const port = await ephemeralPort();
  let impl = await startStateService(port, file);
  t.after(async () => {
    await stop(impl);
    await rm(folder, { recursive: true, force: true });
  });
  const url = "http://127.0.0.1:" + port;
  async function call(
    path,
    value,
    method = value === undefined ? "GET" : "POST",
  ) {
    return fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  }
  async function local(path, value, method) {
    const response = await call(path, value, method);
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  await local("/state", state, "PUT");
  if (!unlinked) {
    await local("/backend-sync/registry", { origin, registry });
    await local("/backend-sync/continuous/configure", {
      origin,
      enabled: true,
    });
  }
  async function restart() {
    await stop(impl);
    impl = await startStateService(port, file);
  }
  return { file, url, call, local, restart };
}

test("continuous SQLite Commit and outbox roll back together, and pause retains work", async (t) => {
  const { file, call, local } = await continuousFixture(t);
  const path = "/backend-sync/continuous";
  assert.equal((await local(path)).pending, 0);
  const first = {
    id: "new-project",
    type: "project",
    label: "New Project",
    values: { status: "PLANOWANY" },
  };
  const second = {
    id: "other-project",
    type: "project",
    label: "Independent Project",
    values: { status: "AKTYWNY" },
  };
  const final = {
    ...initial,
    revision: 6,
    objects: [...initial.objects, first, second],
  };

  const db = new Database(file);
  t.after(() => db.close());
  db.exec(`CREATE TRIGGER test_outbox_failure BEFORE INSERT ON backend_sync_operations
    WHEN NEW.identity_key IS NOT NULL BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END;`);
  assert.equal(
    (await call("/state/commit", { expectedRevision: 5, state: final })).status,
    500,
  );
  assert.equal((await local("/state")).revision, 5);
  assert.equal((await local(path)).pending, 0);
  db.exec("DROP TRIGGER test_outbox_failure;");
  await local(path + "/configure", { origin, enabled: false });
  await local("/state/commit", { expectedRevision: 5, state: final });
  assert.equal((await local(path)).pending, 2);
  assert.equal(
    (await local(path + "/claim", { origin, manual: false })).job,
    null,
  );

  const { job: firstJob } = await local(path + "/claim", {
    origin,
    manual: true,
  });
  assert.equal(firstJob.intent.label, first.label);
  assert.equal(firstJob.intent.canCreate, true);
  assert.equal(
    (await local(path + "/claim", { origin, manual: true })).job,
    null,
  );
  await local(path + "/finish", {
    origin,
    workspaceUuid,
    leaseId: firstJob.leaseId,
    operationId: firstJob.intent.operationId,
    status: "CONFLICT",
    result: { code: "CANONICAL_VALUE_CHANGED" },
  });
  const { job: other } = await local(path + "/claim", { origin, manual: true });
  assert.equal(other.intent.label, second.label);
  assert.equal((await local(path)).conflicts, 1);
  assert.equal((await local("/backend-sync")).operations.length, 0);
});

test("continuous worker preserves schema conflicts and stops denied creations", async (t) => {
  const { url, local } = await continuousFixture(t);
  const path = "/backend-sync/continuous";
  const changed = {
    id: "queued-before-schema-change",
    type: "project",
    values: { status: "AKTYWNY" },
  };
  await local("/state/commit", {
    expectedRevision: 5,
    state: {
      ...initial,
      revision: 6,
      objects: [...initial.objects, changed],
    },
  });
  const newer = {
    ...registry,
    revisionId: "16",
    permissions: { ...registry.permissions, create: false },
  };
  await local("/backend-sync/registry", { origin, registry: newer });
  const created = {
    id: "creation-requires-permission",
    type: "project",
    values: { status: "AKTYWNY" },
  };
  await local("/state/commit", {
    expectedRevision: 6,
    state: {
      ...initial,
      revision: 7,
      objects: [...initial.objects, changed, created],
    },
  });

  const settings = {
    origin,
    token: "t".repeat(43),
    syncApprovedCommits: false,
  };
  const { syncContinuousBatch } = await load(
    "src/shared/backend-sync/continuous.ts",
  );
  const nativeFetch = globalThis.fetch;
  const requests = [];
  const cancellation = new AbortController();
  try {
    globalThis.fetch = (target, options) => {
      if (target.startsWith("http://127.0.0.1:8765/"))
        return nativeFetch(url + new URL(target).pathname, options);
      const payload = JSON.parse(options.body);
      requests.push(payload);
      return Promise.resolve(
        Response.json({
          identity: payload.identity,
          status: "LOCAL_ONLY",
          objectFields: {},
          businessObjectId: null,
          schemaRevisionId: newer.revisionId,
          businessEntityId: newer.entities.find(
            (entity) => entity.localType === "project",
          ).businessEntityId,
          businessModelId: newer.businessModelId,
        }),
      );
    };
    await syncContinuousBatch(settings, false, cancellation.signal);
    await syncContinuousBatch(settings, false, cancellation.signal);
  } finally {
    globalThis.fetch = nativeFetch;
  }
  assert.deepEqual(
    requests.map((payload) => [payload.identity.localObjectId, payload.action]),
    [
      [created.id, "preview"],
      [record.id, "preview"],
      [changed.id, "preview"],
    ],
  );
  const status = await local(path);
  assert.equal(status.conflicts, 1);
  assert.deepEqual(
    status.problems
      .filter(
        (item) =>
          item.code !== "IDENTITY_REVIEW_REQUIRED" &&
          item.code !== "WAITING_UPSTREAM_JOB",
      )
      .map(({ status, code }) => [status, code])
      .sort(),
    [
      ["BLOCKED", "CREATE_PERMISSION_REQUIRED"],
      ["CONFLICT", "SCHEMA_REVISION_CHANGED"],
    ],
  );
  assert.equal(status.reconciliation.identityReview, 3);
});

test(
  "continuous sync writes typed dependencies through real SQLite and PostgreSQL",
  {
    timeout: 60_000,
    skip:
      !process.env.BURBOT_TEST_SYNC_ORIGIN ||
      !process.env.BURBOT_TEST_SYNC_TOKEN,
  },
  async (t) => {
    const prefix = "/api/v1/extension-sync";
    const backend = process.env.BURBOT_TEST_SYNC_ORIGIN;
    const token = process.env.BURBOT_TEST_SYNC_TOKEN;
    const { url, local } = await continuousFixture(t, { unlinked: true });
    async function remote(path, payload) {
      const response = await fetch(backend + prefix + path, {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: payload && JSON.stringify(payload),
      });
      assert.ok(response.ok, path + " returned " + response.status);
      return response.json();
    }
    const schema = await remote("/schema");
    await local("/backend-sync/registry", {
      origin: backend,
      registry: schema,
    });
    const path = "/backend-sync/continuous";
    await local(path + "/configure", { origin: backend, enabled: true });

    const operator = {
      id: crypto.randomUUID(),
      type: "operator",
      values: { name: "Fixture Operator" },
    };
    const project = {
      id: crypto.randomUUID(),
      type: "project",
      values: { name: "Fixture Project", operator_id: operator.id },
    };
    const recruitment = {
      id: crypto.randomUUID(),
      type: "recruitment",
      values: {
        external_number: "FIX-" + crypto.randomUUID(),
        project_id: project.id,
        operator_id: operator.id,
      },
    };
    const category = {
      id: crypto.randomUUID(),
      objectId: recruitment.id,
      label: "Fixture training",
    };
    const funding = {
      id: crypto.randomUUID(),
      objectId: recruitment.id,
      company_size: "SMALL",
      variant_no: 1,
      max_amount_pln: 25000,
      service_category_id: category.id,
    };
    const geography = {
      id: crypto.randomUUID(),
      objectId: recruitment.id,
      operatorId: operator.id,
      type: "POLSKA",
      role: "OBEJMUJE",
      value: "Polska",
    };
    const assignment = {
      id: crypto.randomUUID(),
      objectId: project.id,
      operatorId: operator.id,
      operatorType: "GLOWNY",
    };
    const contact = {
      id: crypto.randomUUID(),
      objectId: operator.id,
      kind: "EMAIL",
      value: "fixture@example.org",
      variant_no: 1,
    };
    const file = {
      id: crypto.randomUUID(),
      objectId: recruitment.id,
      name: "Fixture.pdf",
      fileType: "PDF",
      url: "https://example.org/fixture.pdf",
      sourcePageUrl: "https://example.org",
      addedAt: new Date().toISOString(),
    };
    const document = {
      id: crypto.randomUUID(),
      objectId: recruitment.id,
      label: "Fixture requirement",
      requirement: "REQUIRED",
      purpose: "Application",
      source_file_source_ids: [file.id],
    };
    const missingSource = {
      ...file,
      id: crypto.randomUUID(),
      name: "File awaiting authorized Source",
      url: "https://example.org/another-fixture.pdf",
      source: "missing-import-source",
    };
    await local("/state/commit", {
      expectedRevision: 5,
      state: {
        ...initial,
        revision: 6,
        objects: [...initial.objects, recruitment, project, operator],
        operatorAssignments: [assignment],
        operatorContacts: [contact],
        financingRules: [funding],
        geographies: [geography],
        serviceCategories: [category],
        fileSources: [file, missingSource],
        documentRequirements: [document],
      },
    });

    const { syncContinuousBatch } = await load(
      "src/shared/backend-sync/continuous.ts",
    );
    const realFetch = globalThis.fetch;
    const settings = { origin: backend, token, syncApprovedCommits: false };
    const deadline = Date.now() + 35_000;
    try {
      globalThis.fetch = (target, options) =>
        target.startsWith("http://127.0.0.1:8765/")
          ? realFetch(url + new URL(target).pathname, options)
          : realFetch(target, options);
      let current;
      while (Date.now() < deadline) {
        const outcome = await syncContinuousBatch(
          settings,
          false,
          AbortSignal.timeout(20_000),
        );
        current = await local(path);
        if (current.synced === 10) break;
        assert.equal(current.conflicts, 0, JSON.stringify(current.problems));
        assert.ok(
          current.problems.every(
            (item) =>
              item.status !== "BLOCKED" ||
              item.identity.localObjectId === record.id,
          ),
          JSON.stringify(current.problems),
        );
        await delay(
          Math.max(40, Math.min(600, (outcome.retryAt ?? 0) - Date.now())),
        );
      }
      assert.equal(current.synced, 10, JSON.stringify(current.problems));
      assert.equal(current.pending, 1);
      assert.ok(
        current.problems.some((item) => item.code === "SOURCE_UNRESOLVED"),
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    const readObject = (object, kind, record) =>
      remote("/objects/resolve", {
        workspaceUuid: schema.workspaceUuid,
        action: "preview",
        identity: {
          localObjectId: object.id,
          localType: object.type,
          ...(record && { target: { kind, id: record.id } }),
        },
      });
    const [
      op,
      pr,
      rec,
      variant,
      area,
      service,
      row,
      physical,
      requirement,
      operatorLink,
    ] = await Promise.all([
      readObject(operator),
      readObject(project),
      readObject(recruitment),
      readObject(recruitment, "funding", funding),
      readObject(recruitment, "geography", geography),
      readObject(recruitment, "service_category", category),
      readObject(operator, "operator_contact", contact),
      readObject(recruitment, "file_source", file),
      readObject(recruitment, "document", document),
      readObject(project, "operator_assignment", assignment),
    ]);
    assert.equal(pr.objectFields.operator_id.value, op.businessObjectId);
    assert.equal(rec.objectFields.project_id.value, pr.businessObjectId);
    assert.equal(
      variant.objectFields.recruitment_owner.value,
      rec.businessObjectId,
    );
    assert.equal(
      variant.objectFields.service_category_id.value,
      service.businessObjectId,
    );
    assert.equal(Number(variant.objectFields.max_amount_pln.value), 25000);
    assert.equal(area.objectFields.value.value, "Polska");
    assert.equal(area.objectFields.operatorId.value, op.businessObjectId);
    assert.equal(row.objectFields.value.value, contact.value);
    assert.equal(
      operatorLink.objectFields.operatorId.value,
      op.businessObjectId,
    );
    assert.deepEqual(requirement.objectFields.source_file_source_ids.value, [
      physical.businessObjectId,
    ]);
    const waitingFile = await readObject(
      recruitment,
      "file_source",
      missingSource,
    );
    assert.ok(waitingFile.businessObjectId);
    assert.equal(waitingFile.objectFields.source.value, null);
  },
);

test("initial reconciliation checkpoints an 8,014-record workspace without approving historical values", async (t) => {
  const historical = Array.from({ length: 8013 }, (_, index) => ({
    id: `historic-${String(index).padStart(5, "0")}`,
    type: "project",
    values: { status: "PLANOWANY" },
  }));
  const state = { ...initial, objects: [record, ...historical] };
  const { file, url, local, call, restart } = await continuousFixture(t, {
    state,
  });
  const path = "/backend-sync/continuous";
  await local("/backend-sync/binding", { workspaceUuid, object: bound });
  assert.equal(
    (
      await call("/backend-sync/binding", {
        workspaceUuid: crypto.randomUUID(),
        object: bound,
      })
    ).status,
    409,
  );

  const established = {
    ...bound,
    identity: { localType: "project", localObjectId: historical[0].id },
    businessObjectId: "89",
    objectFields: {
      status: {
        ...bound.objectFields.status,
        value: "AKTYWNY",
        valueId: "90",
        businessObjectFieldId: "91",
      },
    },
  };
  const { syncContinuousBatch } = await load(
    "src/shared/backend-sync/continuous.ts",
  );
  const actualFetch = globalThis.fetch;
  const actions = [];
  try {
    globalThis.fetch = (target, init) => {
      if (target.startsWith("http://127.0.0.1:8765/"))
        return actualFetch(url + new URL(target).pathname, init);
      const body = JSON.parse(init.body);
      actions.push(body);
      assert.equal(body.action, "preview");
      return Promise.resolve(
        Response.json(
          body.identity.localObjectId === historical[0].id
            ? established
            : {
                ...established,
                businessObjectId: null,
                objectFields: {},
                identity: body.identity,
                status: "LOCAL_ONLY",
              },
        ),
      );
    };
    await syncContinuousBatch(
      { origin, token: "t".repeat(43), syncApprovedCommits: false },
      false,
      new AbortController().signal,
    );
  } finally {
    globalThis.fetch = actualFetch;
  }
  const before = (await local(path)).reconciliation;
  assert.equal(before.found, 8014);
  assert.equal(before.scanned, 64);
  assert.equal(before.alreadyBound, 1);
  assert.equal(before.valueReview, 2);
  assert.equal(before.identityReview, 19);
  assert.equal(actions.length, 20);
  assert.equal((await local(path)).synced, 0);
  await restart();
  assert.deepEqual((await local(path)).reconciliation, before);
  let scan;
  do {
    scan = await local(path + "/scan", { origin, manual: false });
    assert.ok(scan.scanned <= 64);
  } while (scan.more);
  assert.deepEqual(await local(path + "/scan", { origin, manual: false }), {
    scanned: 0,
    more: false,
  });
  assert.equal((await local(path)).reconciliation.scanned, 8014);
  const db = new Database(file, { readonly: true });
  t.after(() => db.close());
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM backend_sync_operations WHERE work_kind='identity'",
      )
      .get().n,
    8013,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM backend_sync_operations WHERE work_kind='commit'",
      )
      .get().n,
    0,
  );
  assert.equal(
    (await local(path + "/review", { origin, kind: "identity" })).items.length,
    19,
  );

  const { makeCommitPreview, identityKey } = await load(
    "src/shared/backend-sync/resolve.ts",
  );
  const key = identityKey(established.identity);
  const sync = await local("/backend-sync");
  const preview = makeCommitPreview(sync, null, state, new Set([key]));
  assert.equal(preview.differences[0].server, "AKTYWNY");
  assert.equal(preview.differences[0].proposed, "PLANOWANY");
  const selection = {
    origin,
    workspaceUuid,
    keys: [key],
    expectedRevision: state.revision,
    schemaRevisionId: registry.revisionId,
    preview: preview.operation,
  };
  await local(path + "/approveValues", selection);
  const { job } = await local(path + "/claim", { origin, manual: false });
  assert.equal(job.kind, "commit");
  assert.deepEqual(
    job.intent.request.changes,
    preview.operation.request.changes,
  );

  const newState = {
    ...state,
    revision: state.revision + 1,
    objects: [{ ...record, values: { status: "AKTYWNY" } }, ...historical],
  };
  await local("/state/commit", {
    state: newState,
    expectedRevision: state.revision,
  });
  assert.equal(
    (
      await call(path + "/approveValues", {
        ...selection,
        keys: [identityKey(identity)],
      })
    ).status,
    409,
  );
  assert.equal((await local("/state")).revision, newState.revision);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM backend_sync_operations WHERE work_kind='commit'",
      )
      .get().n,
    2,
  );
});

test("the durable reference graph identifies cycles, missing records and ambiguous nested IDs without retrying", async (t) => {
  const { file, url, local } = await continuousFixture(t, {
    state: { ...initial, objects: [] },
  });
  const link = {
    ...statusField,
    localKey: "link",
    persistentKey: "link",
    key: "link",
    references: "project",
    definition: { type: "reference" },
  };
  const fileLink = {
    ...link,
    localKey: "attachment",
    persistentKey: "attachment",
    key: "attachment",
    references: "document",
  };
  const withReferences = {
    ...registry,
    entities: [
      { ...registry.entities[0], fields: [statusField, link, fileLink] },
      {
        localType: "document",
        businessEntityId: "92",
        parents: ["project"],
        fields: [],
      },
    ],
  };
  await local("/backend-sync/registry", { origin, registry: withReferences });
  const objects = [
    { id: "cycle-a", type: "project", values: { link: "cycle-b" } },
    { id: "cycle-b", type: "project", values: { link: "cycle-a" } },
    {
      id: "missing-parent",
      type: "project",
      values: { link: "not-in-sqlite" },
    },
    {
      id: "ambiguous-child",
      type: "project",
      values: { attachment: "duplicated-file" },
    },
  ];
  await local("/state/commit", {
    expectedRevision: initial.revision,
    state: {
      ...initial,
      revision: initial.revision + 1,
      objects,
      documentRequirements: objects.slice(0, 2).map((item) => ({
        id: "duplicated-file",
        objectId: item.id,
        label: "Same ID",
      })),
    },
  });
  const { syncContinuousBatch } = await load(
    "src/shared/backend-sync/continuous.ts",
  );
  const actualFetch = globalThis.fetch;
  let requests = 0;
  const path = "/backend-sync/continuous";
  const settings = {
    origin,
    token: "t".repeat(43),
    syncApprovedCommits: false,
  };
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = (urlValue, init) => {
      if (urlValue.startsWith("http://127.0.0.1:8765/"))
        return actualFetch(url + new URL(urlValue).pathname, init);
      const request = JSON.parse(init.body);
      assert.equal(request.action, "preview");
      requests++;
      return Promise.resolve(
        Response.json({
          ...bound,
          identity: request.identity,
          businessObjectId: null,
          objectFields: {},
          status: "LOCAL_ONLY",
        }),
      );
    };
    const batch = await syncContinuousBatch(settings, false, signal);
    assert.equal(batch.retryAt, null);
    const total = requests;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await syncContinuousBatch(settings, false, signal);
      assert.equal(result.retryAt, null);
      assert.equal(result.processed, 0);
    }
    assert.ok(total > 0);
    assert.equal(requests, total);
  } finally {
    globalThis.fetch = actualFetch;
  }
  const status = await local(path);
  for (const code of [
    "DEPENDENCY_CYCLE",
    "LOCAL_RECORD_MISSING",
    "REFERENCE_AMBIGUOUS",
  ])
    assert.ok(
      status.problems.some((item) => item.code === code),
      JSON.stringify(status),
    );
  assert.ok(
    status.problems.some((item) =>
      item.dependencies?.some((dep) => dep.upstreamId && dep.localExists),
    ),
  );
  const db = new Database(file, { readonly: true });
  t.after(() => db.close());
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM backend_sync_operations WHERE work_kind='identity'",
      )
      .get().n,
    6,
  );
  assert.ok(
    db.prepare("SELECT COUNT(*) AS n FROM backend_sync_dependencies").get().n >
      0,
  );
});

test("an approved document discovers an unscanned parent and wakes on an external binding", async (t) => {
  const old = {
    id: "old-recruitment",
    type: "recruitment",
    label: "Nabór BUR-I/2.3/2026",
    values: { external_number: "BUR-I/2.3/2026" },
  };
  const previous = { ...initial, objects: [old] };
  const { call, file, local, restart } = await continuousFixture(t, {
    unlinked: true,
    state: previous,
  });
  const label = {
    ...statusField,
    key: "label",
    localKey: "label",
    persistentKey: "label",
    definition: { type: "string" },
  };
  const owner = {
    ...label,
    key: "recruitment_owner",
    localKey: "recruitment_owner",
    persistentKey: "recruitment_owner",
    references: "recruitment",
    definition: { type: "reference" },
  };
  const nestedRegistry = {
    ...registry,
    entities: [
      ...registry.entities,
      { localType: "recruitment", businessEntityId: "92", fields: [] },
      {
        localType: "document",
        businessEntityId: "93",
        parents: ["recruitment"],
        fields: [label, owner],
      },
    ],
  };
  const path = "/backend-sync/continuous";
  await local("/backend-sync/registry", { origin, registry: nestedRegistry });
  await local(path + "/configure", { origin, enabled: true });
  const document = {
    id: "new-document",
    objectId: old.id,
    label: "Otwiera w nowej karcie.docx",
  };
  await local("/state/commit", {
    expectedRevision: previous.revision,
    reviewedObjectIds: [old.id],
    state: {
      ...previous,
      revision: previous.revision + 1,
      documentRequirements: [document],
    },
  });
  const legacy = new Database(file);
  legacy.exec(`
    DELETE FROM app_meta WHERE key='sync_reconciliation_index';
    DELETE FROM backend_sync_records;
    UPDATE backend_sync_operations SET sync_status='WAITING_DEPENDENCY',
      due_at=9999999999999, result_json='{"code":"REFERENCE_UNRESOLVED"}';
    PRAGMA user_version=17;
  `);
  legacy.close();
  await restart();
  const claim = () => local(path + "/claim", { origin, manual: false });
  const finish = (job, status, result) =>
    local(path + "/finish", {
      origin,
      workspaceUuid,
      operationId: job.intent.operationId,
      leaseId: job.leaseId,
      status,
      result,
    });
  const parent = (await claim()).job;
  assert.equal(parent.kind, "identity");
  assert.equal(parent.intent.identity.localObjectId, old.id);
  assert.equal(parent.intent.canCreate, false);
  assert.equal((await local(path)).reconciliation.scanned, 0);
  await finish(parent, "BLOCKED", { code: "IDENTITY_REVIEW_REQUIRED" });
  assert.equal((await claim()).retryAt, null);

  const binding = {
    ...bound,
    identity: parent.intent.identity,
    businessEntityId: "92",
    businessObjectId: "110",
    objectFields: {},
  };
  assert.equal(
    (
      await call("/backend-sync/binding", {
        workspaceUuid: crypto.randomUUID(),
        object: binding,
      })
    ).status,
    409,
  );
  assert.equal((await claim()).job, null);
  await local("/backend-sync/binding", { workspaceUuid, object: binding });
  const child = (await claim()).job;
  assert.equal(child.kind, "identity");
  assert.equal(child.intent.identity.target.id, document.id);
  assert.equal(child.intent.canCreate, true);
  await finish(child, "SYNCED", {
    object: {
      ...binding,
      identity: child.intent.identity,
      businessEntityId: "93",
      businessObjectId: "111",
    },
  });
  const documentCommit = (await claim()).job;
  assert.equal(documentCommit.kind, "commit");
  assert.equal(
    documentCommit.resolved[JSON.stringify(["recruitment", old.id])],
    binding.businessObjectId,
  );
});

test("explicit reconciliation replaces a confirmed conflict with the latest reviewed values and CAS", async (t) => {
  const { file, local } = await continuousFixture(t);
  const path = "/backend-sync/continuous";
  await local("/backend-sync/binding", { workspaceUuid, object: bound });
  await local(path + "/scan", { origin, manual: false });
  const change = (value, revision) => ({
    ...initial,
    revision,
    objects: [{ ...record, values: { status: value } }],
  });
  await local("/state/commit", {
    expectedRevision: 5,
    state: change("AKTYWNY", 6),
  });
  const latest = change("PLANOWANY", 7);
  await local("/state/commit", { expectedRevision: 6, state: latest });
  const claim = () => local(path + "/claim", { origin, manual: false });
  const { job } = await claim();
  await local(path + "/finish", {
    origin,
    workspaceUuid,
    operationId: job.intent.operationId,
    leaseId: job.leaseId,
    status: "CONFLICT",
    result: { code: "CANONICAL_VALUE_CHANGED" },
  });
  assert.equal((await claim()).job, null);
  const serverHead = {
    ...bound.objectFields.status,
    value: "AKTYWNY",
    valueId: String(BigInt(bound.objectFields.status.valueId) + 1n),
  };
  await local("/backend-sync/binding", {
    workspaceUuid,
    object: {
      ...bound,
      objectFields: { status: serverHead },
    },
  });
  const { items } = await local(path + "/review", { origin, kind: "value" });
  assert.equal(items[0].conflictReview, true);
  const { makeCommitPreview, identityKey } = await load(
    "src/shared/backend-sync/resolve.ts",
  );
  const key = identityKey(identity);
  const preview = makeCommitPreview(
    await local("/backend-sync"),
    null,
    latest,
    new Set([key]),
  );
  const db = new Database(file, { readonly: true });
  t.after(() => db.close());
  const ops = db.prepare(
    "SELECT operation_id, sync_status, payload_json FROM backend_sync_operations WHERE work_kind='commit' ORDER BY rowid",
  );
  const prior = ops.all();
  await local(path + "/approveValues", {
    origin,
    workspaceUuid,
    expectedRevision: 7,
    schemaRevisionId: registry.revisionId,
    keys: [key],
    preview: preview.operation,
    compared: preview.compared,
  });
  const updated = ops.all();
  assert.deepEqual(
    updated.slice(0, 2),
    prior.map((item) => ({ ...item, sync_status: "SUPERSEDED" })),
  );
  const confirmed = (await claim()).job;
  const [patch] = confirmed.intent.request.changes[0].fields;
  assert.equal(patch.expectedValueId, serverHead.valueId);
  assert.equal(patch.value, "PLANOWANY");
});

test("one backend outage pauses dispatch for the workspace without losing queued identities", async (t) => {
  const { local } = await continuousFixture(t, {
    state: {
      ...initial,
      objects: [record, { ...record, id: "other-local-identity" }],
    },
  });
  const path = "/backend-sync/continuous";
  const claim = () => local(path + "/claim", { origin, manual: false });
  await local(path + "/scan", { origin, manual: false });
  const { job } = await claim();
  await local(path + "/finish", {
    origin,
    workspaceUuid,
    operationId: job.intent.operationId,
    leaseId: job.leaseId,
    status: "RETRY_PENDING",
    result: { code: "BACKEND_UNAVAILABLE" },
  });
  const paused = await claim();
  assert.equal(paused.job, null);
  assert.ok(paused.retryAt > Date.now());
  assert.equal((await local(path)).reconciliation.queued, 2);
});
