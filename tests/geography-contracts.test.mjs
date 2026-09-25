import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-geography-"));

  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      geography: "src/shared/domain/geographyRuntime.ts",
      core: "src/shared/domain/core.js",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  await import(pathToFileURL(join(outputDir, "schema.js")).href);
  await import(pathToFileURL(join(outputDir, "geography.js")).href);
  await import(pathToFileURL(join(outputDir, "core.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function ids() {
  let index = 0;
  return () => `id-${++index}`;
}

function createProject() {
  const uuid = ids();
  const state = BurbotCore.mutate(
    BurbotCore.empty(),
    {
      op: "CREATE_FROM_SELECTION",
      expectedRevision: 0,
      objectType: "project",
      initialValue: "Generator Kompetencji 3.0",
      sourceUrl: "https://example.test/project",
    },
    uuid,
    "2026-09-16T10:00:00.000Z",
  );
  return { state, uuid, object: state.objects[0] };
}

test("legacy status values normalize to typed Polish domain values", () => {
  const { state } = createProject();
  const definition = BurbotSchema.project.fields.status;

  assert.equal(state.objects[0].values.status, "PLANOWANY");
  assert.equal(BurbotCore.coerceField("ACTIVE", definition, state), "AKTYWNY");
  assert.equal(BurbotCore.coerceField("Active", definition, state), "AKTYWNY");
  assert.equal(BurbotCore.coerceField("Aktywny", definition, state), "AKTYWNY");
});

test("typed recruitment fields are exposed with choice controls where appropriate", () => {
  const fields = BurbotSchema.recruitment.fields;

  for (const key of [
    "dataRozpoczeciaOd",
    "dataRozpoczeciaDo",
    "dataZakonczeniaOd",
    "dataZakonczeniaDo",
    "planowanyStartRok",
    "planowanyStartMiesiac",
    "planowanyStartKwartal",
    "planowanyKoniecRok",
    "planowanyKoniecMiesiac",
    "planowanyKoniecKwartal",
    "statusZakonczenia",
    "powodStatusu",
    "urlOgloszenia",
  ]) {
    assert.ok(fields[key], `missing recruitment field ${key}`);
  }

  assert.equal(fields.status.type, "enum");
  assert.equal(fields.planowanyStartMiesiac.type, "enum");
  assert.equal(fields.planowanyKoniecMiesiac.type, "enum");
  assert.equal(fields.planowanyStartKwartal.type, "enum");
  assert.equal(fields.planowanyKoniecKwartal.type, "enum");
  assert.equal(Object.keys(fields.planowanyStartMiesiac.options).length, 12);
});

test("geography is selected first and page text is stored as supporting evidence rule", () => {
  const { state: initial, uuid, object } = createProject();

  let state = BurbotCore.mutate(
    initial,
    {
      op: "ADD_GEOGRAPHY",
      expectedRevision: initial.revision,
      objectId: object.id,
      geographyType: "WOJEWODZTWO",
      geographyRole: "OBEJMUJE",
      value: "podkarpackie",
    },
    uuid,
    "2026-09-16T10:01:00.000Z",
  );

  assert.equal(state.geographies.length, 1);
  const geography = state.geographies[0];
  assert.deepEqual(
    {
      objectId: geography.objectId,
      type: geography.type,
      role: geography.role,
      value: geography.value,
    },
    {
      objectId: object.id,
      type: "WOJEWODZTWO",
      role: "OBEJMUJE",
      value: "podkarpackie",
    },
  );

  state = BurbotCore.mutate(
    state,
    {
      op: "ASSIGN",
      expectedRevision: state.revision,
      objectId: object.id,
      field: "value",
      target: { kind: "geography", id: geography.id },
      value: geography.value,
      candidate: {
        raw: "województwo podkarpackie",
        pageUrl: "https://example.test/project",
        selector: "#geography",
        extraction: { type: "text" },
      },
    },
    uuid,
    "2026-09-16T10:02:00.000Z",
  );

  assert.equal(state.rules.length, 1);
  assert.deepEqual(state.rules[0].target, {
    kind: "geography",
    id: geography.id,
  });
  assert.deepEqual(state.rules[0].transform, {
    sample: "województwo podkarpackie",
    value: "podkarpackie",
  });

  const removed = BurbotCore.mutate(
    state,
    {
      op: "REMOVE_GEOGRAPHY",
      expectedRevision: state.revision,
      objectId: object.id,
      geographyId: geography.id,
    },
    uuid,
    "2026-09-16T10:03:00.000Z",
  );

  assert.equal(removed.geographies.length, 0);
  assert.equal(removed.rules.length, 0);
});


test("projects and recruitments support multiple operators and recruitment geography is operator-scoped", () => {
  const uuid = ids();
  let state = BurbotCore.empty();

  const create = (objectType, initialValue, sourceUrl) => {
    state = BurbotCore.mutate(
      state,
      {
        op: "CREATE_FROM_SELECTION",
        expectedRevision: state.revision,
        objectType,
        initialValue,
        sourceUrl,
      },
      uuid,
      "2026-09-25T14:00:00.000Z",
    );
    return state.objects.at(-1);
  };

  const operatorA = create(
    "operator",
    "Operator A",
    "https://example.test/operator-a",
  );
  operatorA.importKey = "OP_A";
  const operatorB = create(
    "operator",
    "Operator B",
    "https://example.test/operator-b",
  );
  operatorB.importKey = "OP_B";
  const project = create(
    "project",
    "Projekt wielu operatorów",
    "https://example.test/project",
  );
  const recruitment = create(
    "recruitment",
    "Nabór wielu operatorów",
    "https://example.test/recruitment",
  );

  for (const object of [project, recruitment]) {
    state = BurbotCore.mutate(
      state,
      {
        op: "ADD_OPERATOR_ASSIGNMENT",
        expectedRevision: state.revision,
        objectId: object.id,
        operatorId: operatorA.id,
        operatorType: "GLOWNY",
      },
      uuid,
      "2026-09-25T14:01:00.000Z",
    );
    state = BurbotCore.mutate(
      state,
      {
        op: "ADD_OPERATOR_ASSIGNMENT",
        expectedRevision: state.revision,
        objectId: object.id,
        operatorId: operatorB.id,
        operatorType: "DODATKOWY",
      },
      uuid,
      "2026-09-25T14:02:00.000Z",
    );
  }

  assert.equal(
    state.operatorAssignments.filter((row) => row.objectId === project.id)
      .length,
    2,
  );
  assert.equal(
    state.operatorAssignments.filter((row) => row.objectId === recruitment.id)
      .length,
    2,
  );

  assert.throws(
    () =>
      BurbotCore.mutate(
        state,
        {
          op: "ADD_GEOGRAPHY",
          expectedRevision: state.revision,
          objectId: recruitment.id,
          geographyType: "WOJEWODZTWO",
          geographyRole: "OBEJMUJE",
          value: "podkarpackie",
        },
        uuid,
        "2026-09-25T14:03:00.000Z",
      ),
    /Choose the operator/,
  );

  state = BurbotCore.mutate(
    state,
    {
      op: "ADD_GEOGRAPHY",
      expectedRevision: state.revision,
      objectId: recruitment.id,
      operatorId: operatorA.id,
      geographyType: "WOJEWODZTWO",
      geographyRole: "OBEJMUJE",
      value: "podkarpackie",
    },
    uuid,
    "2026-09-25T14:04:00.000Z",
  );
  state = BurbotCore.mutate(
    state,
    {
      op: "ADD_GEOGRAPHY",
      expectedRevision: state.revision,
      objectId: recruitment.id,
      operatorId: operatorB.id,
      geographyType: "WOJEWODZTWO",
      geographyRole: "OBEJMUJE",
      value: "podkarpackie",
    },
    uuid,
    "2026-09-25T14:05:00.000Z",
  );

  const recruitmentGeo = state.geographies.filter(
    (row) => row.objectId === recruitment.id,
  );
  assert.equal(recruitmentGeo.length, 2);
  assert.deepEqual(
    new Set(recruitmentGeo.map((row) => row.operatorId)),
    new Set([operatorA.id, operatorB.id]),
  );

  const assignmentA = state.operatorAssignments.find(
    (row) =>
      row.objectId === recruitment.id &&
      row.operatorId === operatorA.id,
  );
  state = BurbotCore.mutate(
    state,
    {
      op: "REMOVE_OPERATOR_ASSIGNMENT",
      expectedRevision: state.revision,
      objectId: recruitment.id,
      assignmentId: assignmentA.id,
    },
    uuid,
    "2026-09-25T14:06:00.000Z",
  );

  assert.equal(
    state.geographies.filter((row) => row.objectId === recruitment.id).length,
    1,
  );
  assert.equal(
    state.geographies.find((row) => row.objectId === recruitment.id).operatorId,
    operatorB.id,
  );
  assert.equal(
    state.operatorAssignments.find(
      (row) =>
        row.objectId === recruitment.id &&
        row.operatorId === operatorB.id,
    ).operatorType,
    "GLOWNY",
  );
});
