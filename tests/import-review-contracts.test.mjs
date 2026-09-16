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
let stageModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-import-review-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      core: "src/shared/domain/core.js",
      review: "src/shared/import/review.ts",
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
  stageModule = await import(pathToFileURL(join(outputDir, "stage.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

function range(text, exact) {
  const codepoints = Array.from(text);
  const needle = Array.from(exact);
  const start = codepoints.join("").indexOf(exact);
  assert.notEqual(start, -1);
  const charStart = Array.from(codepoints.join("").slice(0, start)).length;
  return {
    char_start: charStart,
    char_end: charStart + needle.length,
    raw_value: exact,
  };
}

function documentFixture() {
  const sourceText =
    "Projekt Generator Kompetencji 3.0. Harmonogram: Nabór 3/2026 dla przedsiębiorców.";
  return {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [
      {
        key: "project-page",
        type: "HTML",
        url: "https://example.test/project",
        snapshot: { text: sourceText },
      },
    ],
    objects: [
      {
        key: "project-1",
        type: "project",
        data: { name: "Generator Kompetencji 3.0" },
        evidence: {
          name: [{ source: "project-page", ...range(sourceText, "Generator Kompetencji 3.0") }],
        },
      },
      {
        key: "recruitment-1",
        type: "recruitment",
        data: {
          external_number: "Nabór 3/2026",
          project_id: { $ref: "project-1" },
        },
        evidence: {
          external_number: [{ source: "project-page", ...range(sourceText, "Nabór 3/2026") }],
        },
      },
    ],
  };
}

test("import starts as a separate review queue and exposes only the selected object's evidence", () => {
  const uuid = ids();
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "generator.burbot-import.json",
    uuid,
    "2026-09-16T18:00:00.000Z",
  );
  const view = reviewModule.importReviewView(session);

  assert.equal(view.active, true);
  assert.equal(view.pendingCount, 2);
  assert.equal(view.approvedCount, 0);
  assert.equal(view.objects.length, 2);
  assert.equal(view.objects[0].label, "Generator Kompetencji 3.0");
  assert.equal(view.evidence.length, 1);
  assert.equal(view.evidence[0].rawValue, "Generator Kompetencji 3.0");
  assert.equal(view.evidence[0].sourceUrl, "https://example.test/project");
});

test("referenced objects must be approved first and each approval stages only one real object", () => {
  const uuid = ids();
  const now = "2026-09-16T18:00:00.000Z";
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "generator.burbot-import.json",
    uuid,
    now,
  );
  const project = session.previewState.objects.find(
    (object) => object.importKey === "project-1",
  );
  const recruitment = session.previewState.objects.find(
    (object) => object.importKey === "recruitment-1",
  );
  assert.ok(project);
  assert.ok(recruitment);

  assert.throws(
    () => reviewModule.buildImportApprovalPlan(session, recruitment.id),
    /Approve referenced object/,
  );

  const projectPlan = reviewModule.buildImportApprovalPlan(session, project.id);
  assert.equal(projectPlan.referencePatches.length, 0);
  assert.equal(projectPlan.temporaryDependencyImportKeys.length, 0);

  const stagedProject = stageModule.stageImportReviewObject(
    BurbotCore.empty(),
    projectPlan,
    uuid,
    now,
  );
  assert.equal(stagedProject.state.objects.length, 1);
  assert.equal(stagedProject.state.objects[0].importKey, "project-1");

  reviewModule.markImportObjectApproved(
    session,
    project.id,
    stagedProject.stagedObjectId,
    now,
  );
  assert.equal(session.selectedObjectId, recruitment.id);

  const recruitmentView = reviewModule.importReviewView(session);
  assert.equal(recruitmentView.evidence.length, 1);
  assert.equal(recruitmentView.evidence[0].rawValue, "Nabór 3/2026");

  const recruitmentPlan = reviewModule.buildImportApprovalPlan(
    session,
    recruitment.id,
  );
  assert.deepEqual(recruitmentPlan.referencePatches, [
    {
      field: "project_id",
      targetObjectId: stagedProject.stagedObjectId,
    },
  ]);
  assert.deepEqual(recruitmentPlan.temporaryDependencyImportKeys, ["project-1"]);

  const stagedRecruitment = stageModule.stageImportReviewObject(
    stagedProject.state,
    recruitmentPlan,
    uuid,
    now,
  );

  assert.equal(stagedRecruitment.state.objects.length, 2);
  const finalRecruitment = stagedRecruitment.state.objects.find(
    (object) => object.id === stagedRecruitment.stagedObjectId,
  );
  assert.ok(finalRecruitment);
  assert.equal(finalRecruitment.importKey, "recruitment-1");
  assert.equal(
    finalRecruitment.values.project_id,
    stagedProject.stagedObjectId,
  );
  assert.equal(
    stagedRecruitment.state.objects.filter(
      (object) => object.importKey === "project-1",
    ).length,
    1,
  );
});
