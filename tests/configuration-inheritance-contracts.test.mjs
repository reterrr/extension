import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let inheritance;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-config-inheritance-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      inheritance: "src/shared/configurationInheritance.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  inheritance = await import(
    pathToFileURL(join(outputDir, "inheritance.js")).href
  );
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function baseState() {
  return {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "OP_1",
        importKey: "OP_1",
        type: "operator",
        label: "Operator 1",
        values: { name: "Operator 1" },
      },
      {
        id: "PR_1",
        importKey: "PR_1",
        type: "project",
        label: "Projekt",
        values: { name: "Projekt" },
      },
      {
        id: "NAB_1",
        importKey: "NAB_1",
        type: "recruitment",
        label: "Nabór",
        values: {
          external_number: "Nabór",
          project_id: "PR_1",
        },
      },
    ],
    rules: [],
    operatorAssignments: [
      {
        id: "A_1",
        objectId: "NAB_1",
        operatorId: "OP_1",
        operatorType: "GLOWNY",
      },
    ],
    geographies: [
      {
        id: "G_1",
        objectId: "PR_1",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "śląskie",
      },
      {
        id: "G_2",
        objectId: "PR_1",
        type: "POWIAT",
        role: "OBEJMUJE",
        value: "śląskie|powiat|katowicki",
      },
    ],
    financingRules: [
      {
        id: "F_1",
        objectId: "PR_1",
        company_size: "MICRO",
        variant_no: 1,
        refund_percent_standard: 80,
        max_amount_pln: 10000,
      },
      {
        id: "F_2",
        objectId: "PR_1",
        company_size: "SMALL",
        variant_no: 1,
        refund_percent_standard: 70,
        max_amount_pln: 12000,
      },
    ],
  };
}

test("geography inheritance requires an assigned operator and creates independent copies", () => {
  const state = baseState();
  const recruitment = state.objects.find((object) => object.id === "NAB_1");

  const noOperator = inheritance.geographyInheritanceStatus(
    state,
    recruitment,
    "",
  );
  assert.equal(noOperator.operatorAssigned, false);
  assert.equal(noOperator.pendingGeographies.length, 0);

  let sequence = 0;
  const result = inheritance.copyProjectGeographiesToRecruitment(
    state,
    "NAB_1",
    "OP_1",
    () => `copy-g-${++sequence}`,
    "2026-09-29T12:30:00.000Z",
  );

  assert.equal(result.copied.length, 2);
  for (const copy of result.copied) {
    assert.equal(copy.objectId, "NAB_1");
    assert.equal(copy.operatorId, "OP_1");
    assert.equal(copy.copiedFromProjectId, "PR_1");
    assert.ok(copy.copiedFromGeographyId);
    assert.equal(copy.copiedAt, "2026-09-29T12:30:00.000Z");
  }

  const projectGeo = state.geographies.find((row) => row.id === "G_1");
  const recruitmentGeo = state.geographies.find(
    (row) => row.copiedFromGeographyId === "G_1",
  );
  projectGeo.value = "mazowieckie";
  assert.equal(recruitmentGeo.value, "śląskie");

  state.geographies = state.geographies.filter((row) => row.id !== "G_2");
  assert.ok(
    state.geographies.some(
      (row) =>
        row.objectId === "NAB_1" &&
        row.copiedFromGeographyId === "G_2",
    ),
  );
});

test("re-inheriting geography copies only newly added project geography", () => {
  const state = baseState();
  let sequence = 0;

  inheritance.copyProjectGeographiesToRecruitment(
    state,
    "NAB_1",
    "OP_1",
    () => `copy-g-${++sequence}`,
    "2026-09-29T12:30:00.000Z",
  );

  state.geographies.push({
    id: "G_3",
    objectId: "PR_1",
    type: "GMINA",
    role: "WYKLUCZA",
    value: "2469011",
  });

  const recruitment = state.objects.find((object) => object.id === "NAB_1");
  const status = inheritance.geographyInheritanceStatus(
    state,
    recruitment,
    "OP_1",
  );
  assert.deepEqual(
    status.pendingGeographies.map((row) => row.id),
    ["G_3"],
  );

  const second = inheritance.copyProjectGeographiesToRecruitment(
    state,
    "NAB_1",
    "OP_1",
    () => `copy-g-${++sequence}`,
    "2026-09-29T13:00:00.000Z",
  );
  assert.equal(second.copied.length, 1);
  assert.equal(second.copied[0].copiedFromGeographyId, "G_3");
});

test("funding variants are inherited as independent copies", () => {
  const state = baseState();
  let sequence = 0;

  const result = inheritance.copyProjectFundingToRecruitment(
    state,
    "NAB_1",
    () => `copy-f-${++sequence}`,
    "2026-09-29T12:40:00.000Z",
  );

  assert.equal(result.copied.length, 2);
  assert.equal(result.copied[0].objectId, "NAB_1");
  assert.equal(result.copied[0].company_size, "MICRO");
  assert.equal(result.copied[0].variant_no, 1);
  assert.equal(result.copied[0].refund_percent_standard, 80);
  assert.equal(result.copied[0].copiedFromProjectId, "PR_1");
  assert.equal(result.copied[0].copiedFromFundingRuleId, "F_1");
  assert.equal(result.copied[0].importKey, undefined);

  const projectVariant = state.financingRules.find((row) => row.id === "F_1");
  const recruitmentVariant = state.financingRules.find(
    (row) => row.copiedFromFundingRuleId === "F_1",
  );
  projectVariant.refund_percent_standard = 55;
  projectVariant.max_amount_pln = 999;
  assert.equal(recruitmentVariant.refund_percent_standard, 80);
  assert.equal(recruitmentVariant.max_amount_pln, 10000);

  state.financingRules = state.financingRules.filter((row) => row.id !== "F_1");
  assert.ok(
    state.financingRules.some(
      (row) =>
        row.objectId === "NAB_1" &&
        row.copiedFromFundingRuleId === "F_1",
    ),
  );
});

test("re-inheriting funding adds only new source variants and preserves local edits", () => {
  const state = baseState();
  let sequence = 0;

  inheritance.copyProjectFundingToRecruitment(
    state,
    "NAB_1",
    () => `copy-f-${++sequence}`,
    "2026-09-29T12:40:00.000Z",
  );

  const firstCopy = state.financingRules.find(
    (row) => row.copiedFromFundingRuleId === "F_1",
  );
  firstCopy.refund_percent_standard = 95;

  state.financingRules.push({
    id: "F_3",
    objectId: "PR_1",
    company_size: "MICRO",
    variant_no: 2,
    refund_percent_standard: 60,
  });

  const recruitment = state.objects.find((object) => object.id === "NAB_1");
  const status = inheritance.fundingInheritanceStatus(state, recruitment);
  assert.deepEqual(
    status.pendingVariants.map((row) => row.id),
    ["F_3"],
  );

  const second = inheritance.copyProjectFundingToRecruitment(
    state,
    "NAB_1",
    () => `copy-f-${++sequence}`,
    "2026-09-29T13:10:00.000Z",
  );
  assert.equal(second.copied.length, 1);
  assert.equal(second.copied[0].copiedFromFundingRuleId, "F_3");
  assert.equal(second.copied[0].variant_no, 2);
  assert.equal(firstCopy.refund_percent_standard, 95);
});

test("funding copy avoids variant-number collisions with recruitment-local variants", () => {
  const state = baseState();
  state.financingRules.push({
    id: "LOCAL_1",
    objectId: "NAB_1",
    company_size: "MICRO",
    variant_no: 1,
    refund_percent_standard: 50,
  });

  let sequence = 0;
  const result = inheritance.copyProjectFundingToRecruitment(
    state,
    "NAB_1",
    () => `copy-f-${++sequence}`,
    "2026-09-29T13:20:00.000Z",
  );

  const copiedMicro = result.copied.find(
    (row) => row.copiedFromFundingRuleId === "F_1",
  );
  assert.equal(copiedMicro.variant_no, 2);
});
