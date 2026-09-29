import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let migrations;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-geography-"));

  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      geography: "src/shared/domain/geographyRuntime.ts",
      core: "src/shared/domain/core.js",
      migrations: "src/shared/domain/stateMigrations.ts",
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
  migrations = await import(pathToFileURL(join(outputDir, "migrations.js")).href);
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
    "godzinaRozpoczecia",
    "dataZakonczeniaDo",
    "godzinaZakonczenia",
    "planned_start_low_date",
    "planned_start_ceil_date",
    "planned_start_time",
    "planned_end_low_date",
    "planned_end_ceil_date",
    "planned_end_time",
    "planned_start_low_year",
    "planned_start_ceil_year",
    "planned_start_low_month",
    "planned_start_ceil_month",
    "planned_start_low_week",
    "planned_start_ceil_week",
    "planned_start_low_quarter",
    "planned_start_ceil_quarter",
    "planned_end_low_year",
    "planned_end_ceil_year",
    "planned_end_low_month",
    "planned_end_ceil_month",
    "planned_end_low_week",
    "planned_end_ceil_week",
    "planned_end_low_quarter",
    "planned_end_ceil_quarter",
    "statusZakonczenia",
    "powodStatusu",
    "urlOgloszenia",
  ]) {
    assert.ok(fields[key], `missing recruitment field ${key}`);
  }

  assert.equal(fields.status.type, "enum");
  assert.equal(fields.planned_start_low_month.type, "enum");
  assert.equal(fields.planned_start_ceil_month.type, "enum");
  assert.equal(fields.planned_end_low_month.type, "enum");
  assert.equal(fields.planned_end_ceil_month.type, "enum");
  assert.equal(fields.godzinaRozpoczecia.type, "time");
  assert.equal(fields.godzinaZakonczenia.type, "time");
  assert.equal(fields.planned_start_time.type, "time");
  assert.equal(fields.planned_end_time.type, "time");
  assert.equal(fields.planned_start_low_time.hidden, true);
  assert.equal(fields.planned_start_ceil_time.hidden, true);
  assert.equal(fields.planned_end_low_time.hidden, true);
  assert.equal(fields.planned_end_ceil_time.hidden, true);
  assert.equal(fields.planned_start_low_week.type, "enum");
  assert.equal(fields.planned_start_ceil_week.type, "enum");
  assert.equal(fields.planned_end_low_week.type, "enum");
  assert.equal(fields.planned_end_ceil_week.type, "enum");
  assert.equal(fields.planned_start_low_quarter.type, "enum");
  assert.equal(fields.planned_start_ceil_quarter.type, "enum");
  assert.equal(Object.keys(fields.planned_start_low_month.options).length, 12);
  assert.equal(Object.keys(fields.planned_start_low_week.options).length, 5);
  assert.equal(fields.dataRozpoczeciaDo.hidden, true);
  assert.equal(fields.dataZakonczeniaOd.hidden, true);
  assert.equal(fields.planned_start_date.hidden, true);
  assert.equal(fields.planowanyStartTydzien.hidden, true);
});

test("legacy scalar planned dates migrate to ranges while scalar hours stay canonical", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "nab-1",
        type: "recruitment",
        values: {
          planned_start_date: "2028-01-10",
          planned_start_time: "09:00",
          planned_end_date: "2028-01-14",
          planned_end_time: "15:00",
          planowanyStartRok: 2028,
          planowanyStartMiesiac: 1,
          planowanyStartTydzien: 2,
          planowanyStartKwartal: 1,
          planowanyKoniecRok: 2028,
          planowanyKoniecMiesiac: 1,
          planowanyKoniecTydzien: 2,
          planowanyKoniecKwartal: 1,
        },
      },
    ],
    rules: [
      {
        id: "rule-start",
        objectId: "nab-1",
        field: "planned_start_date",
        pageUrl: "https://example.test/nabor",
        selector: "#start",
        extraction: { type: "text" },
        sampleValue: "10 sty 2028",
      },
    ],
  };

  assert.equal(migrations.migratePlannedRecruitmentRanges(state), true);
  const values = state.objects[0].values;
  assert.equal(values.planned_start_low_date, "2028-01-10");
  assert.equal(values.planned_start_ceil_date, "2028-01-10");
  assert.equal(values.planned_end_low_date, "2028-01-14");
  assert.equal(values.planned_end_ceil_date, "2028-01-14");
  assert.equal(values.planned_start_time, "09:00");
  assert.equal(values.planned_end_time, "15:00");
  assert.equal(values.planned_start_low_time, undefined);
  assert.equal(values.planned_end_ceil_time, undefined);
  assert.equal(values.planned_start_low_week, 2);
  assert.equal(values.planned_start_ceil_week, 2);
  assert.ok(state.rules.some((rule) => rule.field === "planned_start_low_date"));
  assert.ok(state.rules.some((rule) => rule.field === "planned_start_ceil_date"));
});

test("legacy planned hour ranges migrate to one start and one end hour", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "nab-time",
        type: "recruitment",
        values: {
          planned_start_low_time: "08:00",
          planned_start_ceil_time: "09:00",
          planned_end_low_time: "15:00",
          planned_end_ceil_time: "17:00",
        },
      },
    ],
    rules: [
      {
        id: "rule-start-time",
        objectId: "nab-time",
        field: "planned_start_low_time",
        pageUrl: "https://example.test/nabor",
        selector: "#start-time",
        extraction: { type: "text" },
        sampleValue: "08:00",
      },
      {
        id: "rule-end-time",
        objectId: "nab-time",
        field: "planned_end_ceil_time",
        pageUrl: "https://example.test/nabor",
        selector: "#end-time",
        extraction: { type: "text" },
        sampleValue: "17:00",
      },
    ],
  };

  assert.equal(migrations.migratePlannedRecruitmentRanges(state), true);
  assert.equal(state.objects[0].values.planned_start_time, "08:00");
  assert.equal(state.objects[0].values.planned_end_time, "17:00");
  assert.ok(state.rules.some((rule) => rule.field === "planned_start_time"));
  assert.ok(state.rules.some((rule) => rule.field === "planned_end_time"));
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
