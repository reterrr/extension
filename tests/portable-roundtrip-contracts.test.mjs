import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  createAiViewExport,
  aiViewExportFilename,
} from "../src/shared/export/aiViewExport.js";
import { normalizePortableInput } from "../src/shared/import/normalizePortableInput.js";

let directory, format, review, stage, example;
const now = "2026-09-30T14:00:00.000Z";
const ids = (prefix = "id") => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "burbot-portable-"));
  await build({
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      geography: "src/shared/domain/geographyRuntime.ts",
      core: "src/shared/domain/core.js",
      format: "src/shared/import/format.ts",
      review: "src/shared/import/review.ts",
      stage: "src/shared/import/stageReview.ts",
    },
    outdir: directory,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  for (const name of ["schema", "geography", "core"])
    await import(pathToFileURL(join(directory, `${name}.js`)));
  format = await import(pathToFileURL(join(directory, "format.js")));
  review = await import(pathToFileURL(join(directory, "review.js")));
  stage = await import(pathToFileURL(join(directory, "stage.js")));
  example = JSON.parse(
    await readFile("examples/portable-import-v1.example.json", "utf8"),
  );
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const imported = (document = example) =>
  format.importDocumentIntoState(BurbotCore.empty(), document, 0, ids(), now);
const exported = (state, objectIds) =>
  createAiViewExport({ state, ...(objectIds ? { view: { objectIds } } : {}) });
const byKey = (document, key) => document.objects.find((o) => o.key === key);
const counts = (state) =>
  Object.fromEntries(
    [
      "objects",
      "operatorAssignments",
      "operatorContacts",
      "geographies",
      "fileSources",
      "financingRules",
      "documentRequirements",
    ].map((key) => [key, state[key]?.length ?? 0]),
  );

function approve(document, state = BurbotCore.empty()) {
  const uuid = ids("staged"),
    session = review.createImportReviewSession(
      document,
      "export.json",
      ids("preview"),
      now,
    );
  for (const id of session.objectOrder) {
    const plan = review.buildImportApprovalPlan(session, id, state);
    const result = stage.stageImportReviewObject(state, plan, uuid, now);
    state = result.state;
    review.markImportObjectApproved(session, id, result.stagedObjectId, now);
  }
  return state;
}

test("portable export imports directly with values, references, files, source snapshots and evidence", () => {
  const state = imported();
  const project = state.objects.find((o) => o.type === "project");
  project.sourceUrl = "https://example.org/original-project";
  project.values.last_checked_at = now;
  const document = exported(state);
  assert.deepEqual(Object.keys(document), [
    "version",
    "offset_unit",
    "sources",
    "objects",
  ]);
  assert.equal(document.offset_unit, "unicode_codepoint");
  assert.equal(
    byKey(document, project.importKey).source_url,
    project.sourceUrl,
  );
  assert.equal(
    byKey(document, project.importKey).data.last_checked_at,
    undefined,
  );
  assert.ok(document.sources.some((source) => source.snapshot.text.length > 0));
  assert.ok(document.objects.some((object) => object.evidence));
  assert.ok(
    document.objects.some((object) =>
      object.files?.some((file) => file.evidence),
    ),
  );
  assert.deepEqual(exported(imported(document)), document);
  const staged = approve(document);
  assert.deepEqual(exported(staged), document);
  assert.deepEqual(counts(approve(document, staged)), counts(staged));
});

test("View includes each project recruitment and referenced operators once with local $ref targets", () => {
  const state = imported();
  const project = state.objects.find((o) => o.type === "project"),
    call = state.objects.find((o) => o.type === "recruitment");
  const document = exported(state, [project.id, call.id, project.id]);
  assert.equal(
    document.objects.filter((o) => o.key === call.importKey).length,
    1,
  );
  assert.equal(
    document.objects.filter((o) => o.key === project.importKey).length,
    1,
  );
  assert.equal(
    new Set(document.objects.map((o) => o.key)).size,
    document.objects.length,
  );
  assert.ok(
    document.objects.every((o) => !o.recruitments && !o.values && !o.links),
  );
  assert.equal(
    byKey(document, call.importKey).data.project_id.$ref,
    project.importKey,
  );
  for (const object of document.objects)
    for (const assignment of object.operators ?? [])
      assert.equal(byKey(document, assignment.operator.$ref).type, "operator");
  assert.doesNotThrow(() => imported(document));
  const sibling = structuredClone(call);
  sibling.id = "sibling";
  sibling.importKey = "sibling";
  state.objects.push(sibling);
  assert.equal(
    exported(state, [call.id]).objects.some((o) => o.key === "sibling"),
    false,
  );
  assert.equal(
    exported(state, [project.id]).objects.some((o) => o.key === "sibling"),
    true,
  );
});

test("editing exported rows with database IDs updates existing rows, even with gaps in variant numbers", () => {
  const state = imported();
  for (const key of [
    "objects",
    "operatorAssignments",
    "operatorContacts",
    "geographies",
    "financingRules",
    "documentRequirements",
  ])
    for (const row of state[key] ?? []) delete row.importKey;
  const funding = state.financingRules[0],
    contact = state.operatorContacts[0];
  funding.variant_no = 9;
  contact.variant_no = 7;
  const document = exported(state);
  const fundingRow = document.objects
    .flatMap((o) => o.financing ?? [])
    .find((row) => row.key === funding.id);
  fundingRow.data.notes = "Nowe warunki wariantu";
  const contactRow = document.objects
    .flatMap((o) => o.contacts ?? [])
    .find((row) => row.key === contact.id);
  contactRow.value =
    contactRow.kind === "EMAIL"
      ? "aktualizacja@example.org"
      : "+48 600 111 222";
  const result = approve(document, state);
  assert.deepEqual(counts(result), counts(state));
  assert.equal(
    result.financingRules.find((row) => row.id === funding.id).notes,
    "Nowe warunki wariantu",
  );
  assert.equal(
    result.operatorContacts.find((row) => row.id === contact.id).value,
    contactRow.value,
  );
});

test("files without captured text remain attachments with empty snapshots; URLs and false survive", () => {
  const state = BurbotCore.empty();
  state.objects = [{ id: "o", type: "operator", values: { name: "Operator" } }];
  state.fileSources = [
    {
      id: "f",
      objectId: "o",
      fileType: "ZIP",
      name: "archiwum.zip",
      url: "http://127.0.0.1:8765/assets/archiwum.zip",
      has_fields: false,
      purpose: "Inne",
    },
  ];
  const document = exported(state);
  assert.equal(document.sources[0].snapshot.text, "");
  assert.equal(document.sources[0].type, "ZIP");
  assert.equal(document.objects[0].files[0].metadata.has_fields, false);
  const result = imported(document);
  assert.equal(result.fileSources[0].url, state.fileSources[0].url);
  assert.equal(result.fileSources[0].has_fields, false);
});

test("duplicate source keys retain distinct faithful snapshots and Unicode code-point evidence", () => {
  const state = BurbotCore.empty();
  state.objects = [
    {
      id: "o",
      type: "operator",
      values: { name: "Operator", notes: "Nowe" },
      evidence: {
        name: [
          { sourceId: "old", charStart: 2, charEnd: 10, rawValue: "Operator" },
        ],
        notes: [
          { sourceId: "new", charStart: 2, charEnd: 6, rawValue: "Nowe" },
        ],
      },
    },
  ];
  state.importSources = [
    {
      id: "old",
      importKey: "same",
      type: "HTML",
      snapshot: { text: "😀 Operator" },
    },
    {
      id: "new",
      importKey: "same",
      type: "HTML",
      snapshot: { text: "😀 Nowe" },
    },
  ];
  const document = exported(state);
  assert.equal(new Set(document.sources.map((source) => source.key)).size, 2);
  assert.deepEqual(exported(imported(document)), document);
});

function legacyExport() {
  const operators = [
    { role: "GLOWNY", operator: { id: "a", key: "OP_A", name: "Operator A" } },
    {
      role: "DODATKOWY",
      operator: { id: "b", key: "OP_B", name: "Operator B" },
    },
  ];
  const call = {
    id: "call",
    type: "recruitment",
    name: "Nabór",
    values: {
      external_number: "Nabór",
      project_id: { id: "p", name: "Projekt", type: "project" },
      status: "ZAWIESZONY",
    },
    operators,
  };
  return {
    format: "burbot-ai-view",
    version: 1,
    objects: [
      {
        id: "p",
        type: "project",
        name: "Projekt",
        source_url: "https://example.org/project",
        values: { name: "Projekt", last_checked_at: now },
        operators,
        recruitments: [structuredClone(call)],
        files: [
          {
            url: "https://example.org/regulamin.pdf",
            file_type: "PDF",
            has_fields: false,
            purpose: "Regulamin",
            intended_use: "Warunki udziału",
          },
        ],
      },
      call,
    ],
  };
}

test("older AI exports deduplicate identical recruitment copies and preserve explicit update fields", () => {
  const old = legacyExport(),
    document = normalizePortableInput(old);
  assert.equal(document.objects.length, 4);
  assert.equal(byKey(document, "call").data.status, "ZAWIESZONY");
  assert.equal(byKey(document, "p").source_url, "https://example.org/project");
  const session = review.createImportReviewSession(old, "old.json", ids(), now);
  const call = session.previewState.objects.find((o) => o.importKey === "call");
  assert.ok(session.importedFieldsByObjectId[call.id].includes("status"));
  const result = approve(document);
  assert.equal(result.objects.length, 4);
  assert.equal(
    result.objects.find((o) => o.importKey === "call").values.status,
    "ZAWIESZONY",
  );
  assert.equal(result.fileSources[0].intended_use, "Warunki udziału");
});

test("conflicting legacy copies, missing references and unsupported fields fail explicitly", () => {
  const old = legacyExport();
  old.objects[1].values.status = "AKTYWNY";
  assert.throws(() => normalizePortableInput(old), /Sprzeczne kopie.*call/);
  const state = BurbotCore.empty();
  state.objects = [
    {
      id: "r",
      type: "recruitment",
      values: { external_number: "Nabór", project_id: "missing" },
    },
  ];
  assert.throws(() => exported(state), /Brak powiązanego obiektu missing/);
  state.objects = [
    {
      id: "o",
      type: "operator",
      values: { name: "Operator", unknown_field: "nie zgub" },
    },
  ];
  assert.throws(() => exported(state), /Nieznane pole operator.unknown_field/);
});

test("old workspace backups use the portable business import without executing extraction rules", () => {
  const state = imported();
  state.rules = [
    {
      id: "rule",
      objectId: state.objects[0].id,
      field: "name",
      selector: "#live-dom",
    },
  ];
  const document = normalizePortableInput(state);
  assert.equal(document.rules, undefined);
  assert.equal(imported(state).rules.length, 0);
  assert.deepEqual(exported(imported(state)), document);
});

test("legacy document requirements without row IDs retain separate keys, values and evidence", () => {
  const state = imported();
  const project = state.objects.find((object) => object.type === "project");
  state.documentRequirements = [
    {
      objectId: project.id,
      document_type_key: "msp_application_form",
      requirement: "REQUIRED",
      auto_fill: false,
    },
    {
      objectId: project.id,
      document_type_key: "other",
      requirement: "OPTIONAL",
      notes: "Załącznik warunkowy",
    },
  ];
  state.importSources.push({
    id: "doc-proof",
    importKey: "doc-proof",
    type: "PDF",
    snapshot: { text: "Formularz jest wymagany." },
  });
  state.importTargetEvidence.push({
    id: "proof",
    objectId: project.id,
    target: { kind: "document", id: "msp_application_form" },
    field: "requirement",
    sourceId: "doc-proof",
    charStart: 0,
    charEnd: Array.from("Formularz jest wymagany.").length,
    rawValue: "Formularz jest wymagany.",
  });
  const document = exported(state);
  assert.deepEqual(
    byKey(document, project.importKey).documents.map((row) => row.key),
    ["msp_application_form", "other"],
  );
  assert.deepEqual(exported(imported(document)), document);
  const result = approve(document);
  assert.deepEqual(exported(result), document);
  assert.deepEqual(counts(approve(document, state)), counts(state));
});

test("source_url is a validated HTTP URL and survives review approval independently of evidence", () => {
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [],
    objects: [
      {
        key: "o",
        type: "operator",
        source_url: "https://example.org/operator",
        data: { name: "Operator" },
      },
    ],
  };
  assert.equal(
    approve(document).objects[0].sourceUrl,
    document.objects[0].source_url,
  );
  document.objects[0].source_url = "javascript:alert(1)";
  assert.throws(() => imported(document), /URL|url|http/i);
});

test("all complete JSON examples in the AI prompt use the live importer", async () => {
  const prompt = await readFile("import/import.md", "utf8");
  let count = 0;
  for (const match of prompt.matchAll(/```json\s*([\s\S]*?)```/g)) {
    const document = JSON.parse(match[1]);
    if (document.version !== 1 || !Array.isArray(document.objects)) continue;
    assert.doesNotThrow(() => imported(document), `Prompt example ${++count}`);
  }
  assert.ok(count >= 9);
});

test("portable filenames and empty selection behavior are predictable", () => {
  assert.equal(
    aiViewExportFilename("2026-09-30T14:00:00.000Z"),
    "burbot-portable-2026-09-30T14-00-00-000Z.json",
  );
  assert.throws(() => exported(BurbotCore.empty()), /Brak obiektów/);
});
