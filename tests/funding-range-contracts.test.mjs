import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let normalizeModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-funding-range-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      normalize: "src/shared/domain/normalizeFundingRanges.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  await import(pathToFileURL(join(outputDir, "schema.js")).href);
  normalizeModule = await import(pathToFileURL(join(outputDir, "normalize.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("project and recruitment refund percentages live only on financing variants", () => {
  assert.equal("refund_percent_min" in BurbotSchema.project.fields, false);
  assert.equal("refund_percent_max" in BurbotSchema.project.fields, false);
  assert.equal("refund_percent_min" in BurbotSchema.recruitment.fields, false);
  assert.equal("refund_percent_max" in BurbotSchema.recruitment.fields, false);

  const visibleFundingFields = Object.keys(BurbotFunding.fields);
  assert.ok(visibleFundingFields.includes("refund_percent_min"));
  assert.ok(visibleFundingFields.includes("refund_percent_max"));
  assert.equal(visibleFundingFields.includes("refund_percent"), false);

  // Kept only as a non-enumerable compatibility definition for old imports/rules.
  assert.equal(BurbotFunding.fields.refund_percent.type, "percentage");
});

test("legacy exact refund migrates to equal min/max without changing revision", () => {
  const state = {
    version: 1,
    revision: 17,
    objects: [
      {
        id: "project-1",
        type: "project",
        label: "Project",
        values: {
          name: "Project",
          refund_percent_min: 40,
          refund_percent_max: 90,
        },
        manualFields: {
          refund_percent_min: true,
          refund_percent_max: true,
        },
      },
    ],
    rules: [
      {
        id: "refund-rule",
        objectId: "project-1",
        field: "refund_percent",
        pageUrl: "https://example.test/project",
        selector: { css: ".refund" },
        extraction: { type: "text" },
        sampleValue: "60%",
        target: { kind: "funding", id: "funding-1" },
      },
      {
        id: "wrong-object-refund-rule",
        objectId: "project-1",
        field: "refund_percent_min",
        pageUrl: "https://example.test/project",
        selector: { css: ".wrong-refund" },
        extraction: { type: "text" },
      },
    ],
    financingRules: [
      {
        id: "funding-1",
        objectId: "project-1",
        company_size: "SMALL",
        variant_no: 1,
        refund_percent: 60,
      },
    ],
    geographies: [],
    fileSources: [],
    importSources: [],
    documentRequirements: [],
  };

  normalizeModule.normalizeFundingRanges(state);

  assert.equal(state.revision, 17);
  assert.equal(state.financingRules[0].refund_percent, undefined);
  assert.equal(state.financingRules[0].refund_percent_min, 60);
  assert.equal(state.financingRules[0].refund_percent_max, 60);

  assert.equal(state.objects[0].values.refund_percent_min, undefined);
  assert.equal(state.objects[0].values.refund_percent_max, undefined);
  assert.equal(state.objects[0].manualFields, undefined);

  const fundingRules = state.rules.filter(
    (rule) => rule.target?.kind === "funding" && rule.target.id === "funding-1",
  );
  assert.equal(fundingRules.length, 2);
  assert.deepEqual(
    new Set(fundingRules.map((rule) => rule.field)),
    new Set(["refund_percent_min", "refund_percent_max"]),
  );
  assert.equal(
    state.rules.some((rule) => rule.id === "wrong-object-refund-rule"),
    false,
  );
});
