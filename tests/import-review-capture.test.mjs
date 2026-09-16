import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let reviewModule;
let captureModule;
let stageModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-import-review-capture-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      core: "src/shared/domain/core.js",
      review: "src/shared/import/review.ts",
      capture: "src/shared/import/reviewCapture.ts",
      stage: "src/shared/import/stageReview.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  await import(pathToFileURL(join(outputDir, "schema.js")).href);
  await import(pathToFileURL(join(outputDir, "core.js")).href);
  reviewModule = await import(pathToFileURL(join(outputDir, "review.js")).href);
  captureModule = await import(pathToFileURL(join(outputDir, "capture.js")).href);
  stageModule = await import(pathToFileURL(join(outputDir, "stage.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

function fixture() {
  const sourceText =
    "😀 Projekt\nGenerator   Kompetencji 3.0\nRefund dla mikro: 80 %.";
  return {
    sourceText,
    document: {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [
        {
          key: "project-page",
          type: "HTML",
          url: "https://example.test/project/#details",
          snapshot: { text: sourceText },
        },
      ],
      objects: [
        {
          key: "project-1",
          type: "project",
          data: { name: "Generator Kompetencji 3.0" },
          financing: [
            {
              key: "micro",
              company_size: "MICRO",
              data: { refund_percent: 50 },
            },
          ],
        },
      ],
    },
  };
}

test("picked import-review value is anchored back to the real snapshot with codepoint offsets", () => {
  const uuid = ids();
  const now = "2026-09-17T00:20:00.000Z";
  const { document, sourceText } = fixture();
  const session = reviewModule.createImportReviewSession(
    document,
    "capture.json",
    uuid,
    now,
  );
  const project = session.previewState.objects[0];

  const result = captureModule.captureImportReviewObjectField(
    session,
    project.id,
    "name",
    "Generator Kompetencji 3.0",
    "https://example.test/project/",
    "Generator Kompetencji 3.0",
    now,
  );

  assert.equal(result.evidenceAnchored, true);
  const evidence = project.evidence.name[0];
  const expectedStart = Array.from(sourceText).indexOf("G");
  assert.equal(evidence.charStart, expectedStart);
  assert.equal(
    Array.from(sourceText).slice(evidence.charStart, evidence.charEnd).join(""),
    "Generator   Kompetencji 3.0",
  );

  const plan = reviewModule.buildImportApprovalPlan(session, project.id);
  const staged = stageModule.stageImportReviewObject(
    BurbotCore.empty(),
    plan,
    uuid,
    now,
  );
  assert.equal(staged.state.objects[0].values.name, "Generator Kompetencji 3.0");
  assert.equal(staged.state.objects[0].evidence.name.length, 1);
});

test("manual review edit still invalidates evidence created by picker capture", () => {
  const uuid = ids();
  const now = "2026-09-17T00:20:00.000Z";
  const { document } = fixture();
  const session = reviewModule.createImportReviewSession(
    document,
    "capture.json",
    uuid,
    now,
  );
  const project = session.previewState.objects[0];

  captureModule.captureImportReviewObjectField(
    session,
    project.id,
    "name",
    "Generator Kompetencji 3.0",
    "https://example.test/project/",
    "Generator Kompetencji 3.0",
    now,
  );
  assert.equal(project.evidence.name.length, 1);

  reviewModule.editImportReviewObjectField(
    session,
    project.id,
    "name",
    "Generator Kompetencji 3.1",
    now,
  );
  assert.equal(project.evidence?.name, undefined);
  assert.equal(project.values.name, "Generator Kompetencji 3.1");
});

test("workspace-style picker can update financing fields inside import review", () => {
  const uuid = ids();
  const now = "2026-09-17T00:20:00.000Z";
  const { document } = fixture();
  const session = reviewModule.createImportReviewSession(
    document,
    "capture.json",
    uuid,
    now,
  );
  const project = session.previewState.objects[0];
  const financing = session.previewState.financingRules[0];

  captureModule.captureImportReviewFinancingField(
    session,
    project.id,
    financing.id,
    "refund_percent",
    "80 %",
    now,
  );

  assert.equal(financing.refund_percent, 80);
  const plan = reviewModule.buildImportApprovalPlan(session, project.id);
  const staged = stageModule.stageImportReviewObject(
    BurbotCore.empty(),
    plan,
    uuid,
    now,
  );
  assert.equal(staged.state.financingRules[0].refund_percent, 80);
});
