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

test("typed recruitment date range and planned-date fields are exposed", () => {
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
  ]) {
    assert.ok(fields[key], `missing recruitment field ${key}`);
  }
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
