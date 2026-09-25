import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let reviewModule;
let stageModule;
let formatModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-import-review-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      geography: "src/shared/domain/geographyRuntime.ts",
      core: "src/shared/domain/core.js",
      format: "src/shared/import/format.ts",
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
  await import(pathToFileURL(join(outputDir, "geography.js")).href);
  await import(pathToFileURL(join(outputDir, "core.js")).href);
  formatModule = await import(pathToFileURL(join(outputDir, "format.js")).href);
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
      {
        key: "project-regulations",
        type: "PDF",
        url: "https://example.test/files/regulamin.pdf",
        snapshot: { text: "Regulamin projektu" },
      },
    ],
    objects: [
      {
        key: "project-1",
        type: "project",
        data: { name: "Generator Kompetencji 3.0" },
        evidence: {
          name: [
            {
              source: "project-page",
              ...range(sourceText, "Generator Kompetencji 3.0"),
            },
          ],
        },
        files: [
          {
            source: "project-regulations",
            source_page: "project-page",
            name: "regulamin.pdf",
          },
        ],
        financing: [
          {
            key: "micro-default",
            company_size: "MICRO",
            data: {
              refund_percent_min: 60,
              refund_percent_avg: 70,
              refund_percent_max: 80,
              max_amount_pln: 100000,
              own_contribution_form: "CASH",
              notes: "Podstawowy wariant",
            },
          },
        ],
      },
      {
        key: "recruitment-1",
        type: "recruitment",
        data: {
          external_number: "Nabór 3/2026",
          project_id: { $ref: "project-1" },
          continuous: true,
        },
        evidence: {
          external_number: [
            {
              source: "project-page",
              ...range(sourceText, "Nabór 3/2026"),
            },
          ],
        },
        financing: [
          {
            key: "small-recruitment",
            company_size: "SMALL",
            data: {
              refund_percent_min: 70,
              refund_percent_avg: 75,
              refund_percent_max: 80,
            },
          },
        ],
      },
    ],
  };
}

test("repository portable-import example stays importable", async () => {
  const document = JSON.parse(
    await readFile(
      resolve(root, "examples/portable-import-v1.example.json"),
      "utf8",
    ),
  );
  const session = reviewModule.createImportReviewSession(
    document,
    "portable-import-v1.example.json",
    ids(),
    "2026-09-25T12:30:00.000Z",
  );

  assert.equal(session.objectOrder.length, 3);

  const project = session.previewState.objects.find(
    (object) => object.importKey === "project-1",
  );
  assert.ok(project);

  const files = (session.previewState.fileSources ?? []).filter(
    (entry) => entry.objectId === project.id,
  );
  assert.equal(files.length, 2);
  assert.equal(files[0].display_name, "Regulamin projektu");
  assert.equal(files[0].purpose, "Regulamin");
  assert.equal(files[0].has_fields, false);
  assert.equal(files[0].client_requirement, "Informacyjny");
  assert.equal(files[0].signature_requirement, "Nie jest wymagany");

  assert.equal(files[1].fileType, "DOCX");
  assert.equal(files[1].purpose, "Formularz do uzupełnienia");
  assert.equal(files[1].has_fields, true);

  assert.ok((session.previewState.importTargetEvidence ?? []).length >= 10);
});

test("legacy file name becomes display_name when metadata display_name is absent", () => {
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "legacy-file-name.burbot-import.json",
    ids(),
    "2026-09-25T13:00:00.000Z",
  );

  const project = session.previewState.objects.find(
    (object) => object.importKey === "project-1",
  );
  assert.ok(project);

  const fileSource = (session.previewState.fileSources ?? []).find(
    (entry) => entry.objectId === project.id,
  );
  assert.ok(fileSource);
  assert.equal(fileSource.name, "regulamin.pdf");
  assert.equal(fileSource.display_name, "regulamin.pdf");
});

test("remote filename becomes display_name when import has no file name at all", () => {
  const document = documentFixture();
  delete document.objects[0].files[0].name;

  const session = reviewModule.createImportReviewSession(
    document,
    "minimal-file.burbot-import.json",
    ids(),
    "2026-09-25T13:01:00.000Z",
  );

  const project = session.previewState.objects.find(
    (object) => object.importKey === "project-1",
  );
  const fileSource = (session.previewState.fileSources ?? []).find(
    (entry) => entry.objectId === project.id,
  );

  assert.equal(fileSource.display_name, "regulamin.pdf");
});

test("import review exposes selected object evidence, file attachments and financing", () => {
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
  assert.equal(view.objects[0].fileCount, 1);
  assert.equal(view.objects[0].financingCount, 1);
  assert.equal(view.evidence.length, 1);
  assert.equal(view.evidence[0].rawValue, "Generator Kompetencji 3.0");
  assert.equal(view.evidence[0].sourceUrl, "https://example.test/project");
  assert.equal(view.files.length, 1);
  assert.equal(view.files[0].name, "regulamin.pdf");
  assert.equal(view.financing.length, 1);
  assert.equal(view.financing[0].companySize, "MICRO");
  assert.equal(
    view.financing[0].fields.find((field) => field.field === "refund_percent_min")
      ?.editorValue,
    "60",
  );
  assert.equal(
    view.financing[0].fields.find((field) => field.field === "refund_percent_avg")
      ?.editorValue,
    "70",
  );
  assert.equal(
    view.financing[0].fields.find((field) => field.field === "refund_percent_max")
      ?.editorValue,
    "80",
  );
  assert.equal(
    view.financing[0].fields.some((field) => field.field === "refund_percent"),
    false,
  );
  assert.equal(
    view.financing[0].fields.find((field) => field.field === "max_amount_pln")
      ?.editorValue,
    "100000",
  );
});

test("refund range belongs to financing variants, not normal project/recruitment fields", () => {
  const uuid = ids();
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "generator.burbot-import.json",
    uuid,
    "2026-09-16T18:00:00.000Z",
  );

  const projectView = reviewModule.importReviewView(session);
  const projectFields = new Map(
    projectView.fields.map((field) => [field.field, field]),
  );
  assert.equal(projectFields.get("operator_id")?.value, "Nie ustawiono");
  assert.equal(projectFields.get("last_checked_at")?.value, "Nie ustawiono");
  assert.equal(projectFields.has("refund_percent_min"), false);
  assert.equal(projectFields.has("refund_percent_avg"), false);
  assert.equal(projectFields.has("refund_percent_max"), false);
  assert.ok(projectFields.has("announcements_site_url"));
  assert.equal(projectFields.has("amount"), false);
  assert.equal(
    projectView.financing[0].fields.find((field) => field.field === "refund_percent_min")
      ?.editorValue,
    "60",
  );
  assert.equal(
    projectView.financing[0].fields.find((field) => field.field === "refund_percent_avg")
      ?.editorValue,
    "70",
  );
  assert.equal(
    projectView.financing[0].fields.find((field) => field.field === "refund_percent_max")
      ?.editorValue,
    "80",
  );

  const recruitment = session.previewState.objects.find(
    (object) => object.importKey === "recruitment-1",
  );
  assert.ok(recruitment);
  session.selectedObjectId = recruitment.id;
  const recruitmentView = reviewModule.importReviewView(session);
  const recruitmentFields = new Map(
    recruitmentView.fields.map((field) => [field.field, field]),
  );
  assert.equal(recruitmentFields.has("refund_percent_min"), false);
  assert.equal(recruitmentFields.has("refund_percent_avg"), false);
  assert.equal(recruitmentFields.has("refund_percent_max"), false);
  assert.ok(recruitmentFields.has("dataRozpoczeciaOd"));
  assert.equal(recruitmentFields.get("continuous")?.value, "Tak");
  assert.equal(recruitmentFields.get("last_checked_at")?.value, "Nie ustawiono");
  assert.equal(recruitmentFields.has("start_date"), false);
  assert.equal(recruitmentView.financing.length, 1);
  assert.equal(recruitmentView.financing[0].companySize, "SMALL");
  assert.equal(
    recruitmentView.financing[0].fields.find(
      (field) => field.field === "refund_percent_min",
    )?.editorValue,
    "70",
  );
  assert.equal(
    recruitmentView.financing[0].fields.find(
      (field) => field.field === "refund_percent_avg",
    )?.editorValue,
    "75",
  );
  assert.equal(
    recruitmentView.financing[0].fields.find(
      (field) => field.field === "refund_percent_max",
    )?.editorValue,
    "80",
  );
});

test("review edits change staged data and invalidate stale object evidence", () => {
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
  assert.ok(project);
  const financing = session.previewState.financingRules.find(
    (row) => row.objectId === project.id,
  );
  const file = session.previewState.fileSources.find(
    (row) => row.objectId === project.id,
  );
  assert.ok(financing);
  assert.ok(file);

  reviewModule.editImportReviewObjectField(
    session,
    project.id,
    "name",
    "Generator Kompetencji 3.1",
    now,
  );
  reviewModule.editImportReviewFinancingField(
    session,
    project.id,
    String(financing.id),
    "max_amount_pln",
    "120000",
    now,
  );
  const view = reviewModule.importReviewView(session);
  assert.equal(view.objects[0].label, "Generator Kompetencji 3.1");
  assert.equal(view.evidence.length, 0);
  assert.equal(view.fields.find((field) => field.field === "name")?.evidenceCount, 0);
  assert.equal(view.files[0].name, "regulamin.pdf");
  assert.equal(
    view.financing[0].fields.find((field) => field.field === "max_amount_pln")
      ?.editorValue,
    "120000",
  );

  const plan = reviewModule.buildImportApprovalPlan(session, project.id);
  const staged = stageModule.stageImportReviewObject(
    BurbotCore.empty(),
    plan,
    uuid,
    now,
  );
  const stagedProject = staged.state.objects.find(
    (object) => object.id === staged.stagedObjectId,
  );
  assert.ok(stagedProject);
  assert.equal(stagedProject.values.name, "Generator Kompetencji 3.1");
  assert.equal(staged.state.fileSources.length, 1);
  assert.equal(staged.state.fileSources[0].name, "regulamin.pdf");
  assert.equal(staged.state.financingRules.length, 1);
  assert.equal(staged.state.financingRules[0].refund_percent_min, 60);
  assert.equal(staged.state.financingRules[0].refund_percent_avg, 70);
  assert.equal(staged.state.financingRules[0].refund_percent_max, 80);
  assert.equal(staged.state.financingRules[0].max_amount_pln, 120000);
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
  assert.equal(stagedProject.state.fileSources.length, 1);
  assert.equal(stagedProject.state.financingRules.length, 1);

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
  assert.equal(stagedRecruitment.state.financingRules.length, 2);
  const finalRecruitment = stagedRecruitment.state.objects.find(
    (object) => object.id === stagedRecruitment.stagedObjectId,
  );
  assert.ok(finalRecruitment);
  assert.equal(finalRecruitment.importKey, "recruitment-1");
  assert.equal(
    finalRecruitment.values.project_id,
    stagedProject.stagedObjectId,
  );
  assert.equal(finalRecruitment.values.continuous, true);
  assert.equal(
    stagedRecruitment.state.objects.filter(
      (object) => object.importKey === "project-1",
    ).length,
    1,
  );
});

test("recruitment reference reuses an existing workspace project instead of duplicating it", () => {
  const uuid = ids();
  const now = "2026-09-20T14:50:00.000Z";
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "existing-project-reference.burbot-import.json",
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

  const existingState = BurbotCore.empty();
  existingState.objects.push({
    id: "existing-project-id",
    type: "project",
    importKey: "project-1",
    label: "Generator Kompetencji 3.0",
    values: {
      name: "Generator Kompetencji 3.0",
      number: "FEPK.01.01-TEST",
    },
    createdAt: now,
    updatedAt: now,
  });

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    recruitment.id,
    existingState,
  );

  assert.deepEqual(plan.referencePatches, [
    {
      field: "project_id",
      targetObjectId: "existing-project-id",
    },
  ]);
  assert.deepEqual(plan.existingReferenceLinks, [
    {
      importKey: "project-1",
      targetObjectId: "existing-project-id",
    },
  ]);

  const staged = stageModule.stageImportReviewObject(
    existingState,
    plan,
    uuid,
    now,
  );

  assert.equal(staged.state.objects.length, 2);
  assert.equal(
    staged.state.objects.filter((object) => object.type === "project").length,
    1,
  );
  const stagedRecruitment = staged.state.objects.find(
    (object) => object.id === staged.stagedObjectId,
  );
  assert.ok(stagedRecruitment);
  assert.equal(
    stagedRecruitment.values.project_id,
    "existing-project-id",
  );

  reviewModule.markImportObjectLinked(
    session,
    "project-1",
    "existing-project-id",
    now,
  );
  assert.equal(session.statusByObjectId[project.id], "APPROVED");
  assert.equal(
    session.approvedObjectIdByImportKey["project-1"],
    "existing-project-id",
  );
});

test("existing project can be resolved by unique project number when import keys differ", () => {
  const uuid = ids();
  const now = "2026-09-20T14:50:00.000Z";
  const document = documentFixture();
  document.objects[0].data.number = "FEDS.09.01-IP.02-0007/23";

  const session = reviewModule.createImportReviewSession(
    document,
    "project-number-reference.burbot-import.json",
    uuid,
    now,
  );
  const recruitment = session.previewState.objects.find(
    (object) => object.importKey === "recruitment-1",
  );
  assert.ok(recruitment);

  const existingState = BurbotCore.empty();
  existingState.objects.push({
    id: "database-project-id",
    type: "project",
    importKey: "legacy-project-key",
    label: "Existing project",
    values: {
      name: "Existing project",
      number: "FEDS.09.01-IP.02-0007/23",
    },
    createdAt: now,
    updatedAt: now,
  });

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    recruitment.id,
    existingState,
  );
  assert.equal(
    plan.referencePatches[0]?.targetObjectId,
    "database-project-id",
  );
});

test("approving an existing imported object updates it in place without duplicating it", () => {
  const uuid = ids();
  const now = "2026-09-21T12:00:00.000Z";
  const sourceText =
    "Generator Kompetencji 3.1. Maksymalna refundacja wynosi 85%.";

  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [
      {
        key: "project-update-page",
        type: "HTML",
        url: "https://example.test/project-update",
        snapshot: { text: sourceText },
      },
    ],
    objects: [
      {
        key: "project-1",
        type: "project",
        data: {
          name: "Generator Kompetencji 3.1",
        },
        evidence: {
          name: [
            {
              source: "project-update-page",
              ...range(sourceText, "Generator Kompetencji 3.1"),
            },
          ],
        },
        financing: [
          {
            key: "micro-default",
            company_size: "MICRO",
            data: {
              refund_percent_max: 85,
            },
          },
        ],
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "existing-project-update.burbot-import.json",
    uuid,
    now,
  );
  const imported = session.previewState.objects[0];

  const existingState = BurbotCore.empty();
  existingState.objects.push({
    id: "existing-project-id",
    type: "project",
    importKey: "project-1",
    label: "Generator Kompetencji 3.0",
    values: {
      name: "Generator Kompetencji 3.0",
      number: "FEPK.01.01-KEEP",
      status: "AKTYWNY",
    },
    evidence: {
      number: [
        {
          sourceId: "old-source",
          charStart: 0,
          charEnd: 4,
          rawValue: "KEEP",
        },
      ],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  existingState.financingRules = [
    {
      id: "existing-funding-id",
      objectId: "existing-project-id",
      importKey: "micro-default",
      company_size: "MICRO",
      variant_no: 1,
      refund_percent_max: 80,
      max_amount_pln: 130000,
      own_contribution_form: "CASH",
    },
  ];

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    imported.id,
    existingState,
  );

  assert.equal(plan.existingTargetObjectId, "existing-project-id");
  assert.deepEqual(plan.selectedDataFields, ["name"]);
  assert.deepEqual(plan.financingFieldsByImportKey["micro-default"], [
    "refund_percent_max",
  ]);

  const staged = stageModule.stageImportReviewObject(
    existingState,
    plan,
    uuid,
    now,
  );

  assert.equal(staged.updatedExisting, true);
  assert.equal(staged.stagedObjectId, "existing-project-id");
  assert.equal(staged.state.objects.length, 1);

  const project = staged.state.objects[0];
  assert.equal(project.id, "existing-project-id");
  assert.equal(project.values.name, "Generator Kompetencji 3.1");
  assert.equal(project.values.number, "FEPK.01.01-KEEP");
  assert.equal(project.values.status, "AKTYWNY");
  assert.equal(project.label, "Generator Kompetencji 3.1");
  assert.equal(project.evidence.number[0].rawValue, "KEEP");
  assert.equal(project.evidence.name[0].rawValue, "Generator Kompetencji 3.1");

  assert.equal(staged.state.financingRules.length, 1);
  const funding = staged.state.financingRules[0];
  assert.equal(funding.id, "existing-funding-id");
  assert.equal(funding.refund_percent_max, 85);
  assert.equal(funding.max_amount_pln, 130000);
  assert.equal(funding.own_contribution_form, "CASH");

  assert.equal(staged.state.importSources.length, 1);
  assert.equal(
    staged.state.importSources[0].importKey,
    "project-update-page",
  );
});

test("existing object IDs and legacy financing rows are reused when stable import keys are absent", () => {
  const uuid = ids();
  const now = "2026-09-21T12:05:00.000Z";
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [],
    objects: [
      {
        key: "existing-project-id",
        type: "project",
        data: {
          name: "Updated project",
        },
        financing: [
          {
            key: "micro-1",
            company_size: "MICRO",
            data: {
              refund_percent_max: 90,
            },
          },
        ],
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "legacy-existing-update.burbot-import.json",
    uuid,
    now,
  );
  const existingState = BurbotCore.empty();
  existingState.objects.push({
    id: "existing-project-id",
    type: "project",
    label: "Old project",
    values: {
      name: "Old project",
      number: "UNCHANGED",
    },
  });
  existingState.financingRules = [
    {
      id: "legacy-finance-id",
      objectId: "existing-project-id",
      company_size: "MICRO",
      variant_no: 1,
      refund_percent_max: 75,
      max_amount_pln: 200000,
      own_contribution_form: "CASH",
    },
  ];

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    session.previewState.objects[0].id,
    existingState,
  );
  assert.equal(plan.existingTargetObjectId, "existing-project-id");

  const staged = stageModule.stageImportReviewObject(
    existingState,
    plan,
    uuid,
    now,
  );

  assert.equal(staged.state.objects.length, 1);
  assert.equal(staged.state.objects[0].id, "existing-project-id");
  assert.equal(staged.state.objects[0].importKey, "existing-project-id");
  assert.equal(staged.state.objects[0].values.name, "Updated project");
  assert.equal(staged.state.objects[0].values.number, "UNCHANGED");

  assert.equal(staged.state.financingRules.length, 1);
  assert.equal(staged.state.financingRules[0].id, "legacy-finance-id");
  assert.equal(staged.state.financingRules[0].importKey, "micro-1");
  assert.equal(staged.state.financingRules[0].refund_percent_max, 90);
  assert.equal(staged.state.financingRules[0].max_amount_pln, 200000);
  assert.equal(staged.state.financingRules[0].own_contribution_form, "CASH");
});

test("fields omitted by AI are not overwritten by schema defaults during an existing-object update", () => {
  const uuid = ids();
  const now = "2026-09-21T12:10:00.000Z";
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [],
    objects: [
      {
        key: "project-1",
        type: "project",
        data: {
          name: "Only the name changed",
        },
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "partial-update.burbot-import.json",
    uuid,
    now,
  );
  const imported = session.previewState.objects[0];
  // Preview has schema defaults, but they were not present in the JSON.
  assert.equal(imported.values.status, "PLANOWANY");

  const existingState = BurbotCore.empty();
  existingState.objects.push({
    id: "existing-project-id",
    type: "project",
    importKey: "project-1",
    label: "Old name",
    values: {
      name: "Old name",
      type: "B2B",
      status: "AKTYWNY",
      number: "KEEP-ME",
    },
  });

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    imported.id,
    existingState,
  );
  const staged = stageModule.stageImportReviewObject(
    existingState,
    plan,
    uuid,
    now,
  );
  const project = staged.state.objects[0];

  assert.equal(project.values.name, "Only the name changed");
  assert.equal(project.values.type, "B2B");
  assert.equal(project.values.status, "AKTYWNY");
  assert.equal(project.values.number, "KEEP-ME");
});

test("portable import cannot set system-managed last_checked_at", () => {
  const document = documentFixture();
  document.objects[0].data.last_checked_at = "2026-09-18T10:00:00Z";

  assert.throws(
    () =>
      reviewModule.createImportReviewSession(
        document,
        "invalid-system-field.burbot-import.json",
        ids(),
        "2026-09-18T10:00:00.000Z",
      ),
    /managed automatically/,
  );
});


test("import review objects can be rejected and restored without entering View", () => {
  const uuid = ids();
  const now = "2026-09-22T11:00:00.000Z";
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "rejectable-import.burbot-import.json",
    uuid,
    now,
  );
  const project = session.previewState.objects[0];

  reviewModule.markImportObjectRejected(session, project.id, now);
  let view = reviewModule.importReviewView(session);
  assert.equal(session.statusByObjectId[project.id], "REJECTED");
  assert.equal(view.rejectedCount, 1);
  assert.equal(view.pendingCount, 1);
  assert.equal(view.approvedCount, 0);

  reviewModule.restoreRejectedImportObject(
    session,
    project.id,
    "2026-09-22T11:01:00.000Z",
  );
  view = reviewModule.importReviewView(session);
  assert.equal(session.statusByObjectId[project.id], "PENDING");
  assert.equal(view.rejectedCount, 0);
  assert.equal(view.pendingCount, 2);
});


test("approved import can be revoked after its View changes are discarded", () => {
  const uuid = ids();
  const now = "2026-09-22T12:30:00.000Z";
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "revoke-approved-import.burbot-import.json",
    uuid,
    now,
  );
  const project = session.previewState.objects[0];

  reviewModule.markImportObjectApproved(
    session,
    project.id,
    "working-project-id",
    now,
  );
  assert.equal(session.statusByObjectId[project.id], "APPROVED");
  assert.equal(
    session.approvedObjectIdByImportKey[project.importKey],
    "working-project-id",
  );

  reviewModule.revokeApprovedImportObject(
    session,
    project.id,
    "2026-09-22T12:31:00.000Z",
  );

  const view = reviewModule.importReviewView(session);
  assert.equal(session.statusByObjectId[project.id], "REJECTED");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      session.approvedObjectIdByImportKey,
      project.importKey,
    ),
    false,
  );
  assert.equal(view.rejectedCount, 1);
  assert.equal(view.approvedCount, 0);
});


test("import review can expose evidence from all imported objects at once", () => {
  const uuid = ids();
  const session = reviewModule.createImportReviewSession(
    documentFixture(),
    "generator.burbot-import.json",
    uuid,
    "2026-09-23T18:00:00.000Z",
  );

  const evidence = reviewModule.allImportReviewEvidenceViews(session);
  assert.equal(evidence.length, 2);
  assert.deepEqual(
    new Set(evidence.map((entry) => entry.rawValue)),
    new Set(["Generator Kompetencji 3.0", "Nabór 3/2026"]),
  );
  assert.ok(
    evidence.every(
      (entry) => entry.sourceUrl === "https://example.test/project",
    ),
  );
});


test("portable import v1 supports geography, contacts, documents and B2C financing", () => {
  const uuid = ids();
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [
      {
        key: "page",
        type: "HTML",
        url: "https://example.test/full",
        snapshot: { text: "Pełny przykład" },
      },
      {
        key: "pdf",
        type: "PDF",
        url: "https://example.test/regulamin.pdf",
        snapshot: { text: "Regulamin" },
      },
    ],
    objects: [
      {
        key: "operator-1",
        type: "operator",
        data: {
          name: "Operator Demo",
          role: "OPERATOR",
        },
        contacts: [
          { key: "email-biuro", kind: "EMAIL", value: "biuro@example.test" },
          { key: "telefon-biuro", kind: "PHONE", value: "+48 123 456 789" },
        ],
      },
      {
        key: "project-1",
        type: "project",
        data: {
          name: "Projekt Demo",
          operator_id: { $ref: "operator-1" },
          type: "B2C",
        },
        geography: [
          {
            key: "geo-maz",
            type: "WOJEWODZTWO",
            role: "OBEJMUJE",
            value: "mazowieckie",
          },
          {
            key: "geo-warszawa",
            type: "PODREGION",
            role: "WYKLUCZA",
            value: "miasto Warszawa",
          },
        ],
        files: [
          {
            source: "pdf",
            source_page: "page",
            name: "Regulamin.pdf",
          },
        ],
        financing: [
          {
            key: "b2c-main",
            company_size: "B2C",
            data: {
              refund_percent_standard: 80,
              max_per_person_pln: 10000,
              own_contribution_form: "CASH",
            },
          },
        ],
        documents: [
          {
            key: "doc-application",
            document_type_key: "psf_application_form",
            data: {
              requirement: "REQUIRED",
              auto_fill: true,
              notes: "Wymagany formularz.",
            },
          },
        ],
      },
    ],
  };

  const state = formatModule.importDocumentIntoState(
    BurbotCore.empty(),
    document,
    0,
    uuid,
    "2026-09-24T09:00:00.000Z",
  );

  const operator = state.objects.find((object) => object.importKey === "operator-1");
  const project = state.objects.find((object) => object.importKey === "project-1");
  assert.ok(operator);
  assert.ok(project);

  assert.deepEqual(
    state.operatorContacts.map((row) => ({
      importKey: row.importKey,
      kind: row.kind,
      value: row.value,
    })),
    [
      { importKey: "email-biuro", kind: "EMAIL", value: "biuro@example.test" },
      { importKey: "telefon-biuro", kind: "PHONE", value: "+48 123 456 789" },
    ],
  );

  assert.deepEqual(
    state.geographies.map((row) => ({
      importKey: row.importKey,
      type: row.type,
      role: row.role,
      value: row.value,
    })),
    [
      {
        importKey: "geo-maz",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "mazowieckie",
      },
      {
        importKey: "geo-warszawa",
        type: "PODREGION",
        role: "WYKLUCZA",
        value: "miasto Warszawa",
      },
    ],
  );

  assert.equal(state.fileSources.length, 1);
  assert.equal(state.financingRules[0].company_size, "B2C");
  assert.equal(state.financingRules[0].max_per_person_pln, 10000);
  assert.deepEqual(
    {
      importKey: state.documentRequirements[0].importKey,
      document_type_key: state.documentRequirements[0].document_type_key,
      requirement: state.documentRequirements[0].requirement,
      auto_fill: state.documentRequirements[0].auto_fill,
      notes: state.documentRequirements[0].notes,
    },
    {
      importKey: "doc-application",
      document_type_key: "psf_application_form",
      requirement: "REQUIRED",
      auto_fill: true,
      notes: "Wymagany formularz.",
    },
  );
});

test("import approval plan preserves nested portable configuration", () => {
  const uuid = ids();
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [],
    objects: [
      {
        key: "project-full",
        type: "project",
        data: { name: "Projekt pełny" },
        geography: [
          {
            key: "geo-1",
            type: "WOJEWODZTWO",
            role: "OBEJMUJE",
            value: "mazowieckie",
          },
        ],
        financing: [
          {
            key: "fin-b2c",
            company_size: "B2C",
            data: { refund_percent_standard: 80 },
          },
        ],
        documents: [
          {
            key: "doc-1",
            document_type_key: "psf_application_form",
            data: { requirement: "REQUIRED", auto_fill: false },
          },
        ],
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "full.json",
    uuid,
    "2026-09-24T09:00:00.000Z",
  );
  const plan = reviewModule.buildImportApprovalPlan(
    session,
    session.objectOrder[0],
  );
  const portable = plan.document.objects.at(-1);

  assert.equal(portable.geography[0].key, "geo-1");
  assert.equal(portable.financing[0].company_size, "B2C");
  assert.equal(portable.documents[0].document_type_key, "psf_application_form");
});


test("existing object approval merges imported geography contacts and documents", () => {
  const uuid = ids();
  const original = formatModule.importDocumentIntoState(
    BurbotCore.empty(),
    {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [],
      objects: [
        {
          key: "operator-existing",
          type: "operator",
          data: { name: "Operator Existing", role: "OPERATOR" },
        },
        {
          key: "project-existing",
          type: "project",
          data: {
            name: "Projekt Existing",
            operator_id: { $ref: "operator-existing" },
          },
        },
      ],
    },
    0,
    uuid,
    "2026-09-24T08:00:00.000Z",
  );

  const operator = original.objects.find(
    (object) => object.importKey === "operator-existing",
  );
  const project = original.objects.find(
    (object) => object.importKey === "project-existing",
  );
  assert.ok(operator);
  assert.ok(project);

  const operatorSession = reviewModule.createImportReviewSession(
    {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [],
      objects: [
        {
          key: "operator-existing",
          type: "operator",
          data: { name: "Operator Existing", role: "OPERATOR" },
          contacts: [
            {
              key: "contact-email",
              kind: "EMAIL",
              value: "kontakt@example.test",
            },
          ],
        },
      ],
    },
    "operator-update.json",
    uuid,
    "2026-09-24T09:00:00.000Z",
  );
  const operatorPlan = reviewModule.buildImportApprovalPlan(
    operatorSession,
    operatorSession.objectOrder[0],
    original,
  );
  const operatorStaged = stageModule.stageImportReviewObject(
    original,
    operatorPlan,
    uuid,
    "2026-09-24T09:01:00.000Z",
  );

  assert.equal(operatorStaged.updatedExisting, true);
  assert.equal(
    operatorStaged.state.operatorContacts.find(
      (row) => row.objectId === operator.id && row.importKey === "contact-email",
    )?.value,
    "kontakt@example.test",
  );

  const projectSession = reviewModule.createImportReviewSession(
    {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [],
      objects: [
        {
          key: "operator-existing",
          type: "operator",
          data: { name: "Operator Existing" },
        },
        {
          key: "project-existing",
          type: "project",
          data: {
            name: "Projekt Existing",
            operator_id: { $ref: "operator-existing" },
          },
          geography: [
            {
              key: "geo-existing",
              type: "WOJEWODZTWO",
              role: "OBEJMUJE",
              value: "mazowieckie",
            },
          ],
          documents: [
            {
              key: "doc-existing",
              document_type_key: "psf_application_form",
              data: {
                requirement: "REQUIRED",
                auto_fill: true,
                notes: "Aktualizacja.",
              },
            },
          ],
        },
      ],
    },
    "project-update.json",
    uuid,
    "2026-09-24T09:02:00.000Z",
  );

  // The referenced operator already exists under the same stable import key.
  const projectPreview = projectSession.previewState.objects.find(
    (object) => object.importKey === "project-existing",
  );
  assert.ok(projectPreview);
  const projectPlan = reviewModule.buildImportApprovalPlan(
    projectSession,
    projectPreview.id,
    operatorStaged.state,
  );
  const projectStaged = stageModule.stageImportReviewObject(
    operatorStaged.state,
    projectPlan,
    uuid,
    "2026-09-24T09:03:00.000Z",
  );

  assert.equal(projectStaged.updatedExisting, true);
  assert.equal(
    projectStaged.state.geographies.find(
      (row) => row.objectId === project.id && row.importKey === "geo-existing",
    )?.value,
    "mazowieckie",
  );
  assert.deepEqual(
    {
      requirement: projectStaged.state.documentRequirements.find(
        (row) =>
          row.objectId === project.id && row.importKey === "doc-existing",
      )?.requirement,
      auto_fill: projectStaged.state.documentRequirements.find(
        (row) =>
          row.objectId === project.id && row.importKey === "doc-existing",
      )?.auto_fill,
    },
    { requirement: "REQUIRED", auto_fill: true },
  );
});


test("nested portable evidence keeps char offsets and target identity", () => {
  const uuid = ids();
  const sourceText =
    "Obszar: mazowieckie. Kontakt: kontakt@example.test. Refundacja: 80%. Dokument: Wymagany formularz.";
  const evidence = (raw, normalizedValue) => ({
    source: "page",
    ...range(sourceText, raw),
    ...(normalizedValue !== undefined
      ? { normalized_value: normalizedValue }
      : {}),
  });

  const state = formatModule.importDocumentIntoState(
    BurbotCore.empty(),
    {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [
        {
          key: "page",
          type: "HTML",
          url: "https://example.test/full",
          snapshot: { text: sourceText },
        },
      ],
      objects: [
        {
          key: "operator-nested",
          type: "operator",
          data: { name: "Operator Nested", role: "OPERATOR" },
          contacts: [
            {
              key: "contact-email",
              kind: "EMAIL",
              value: "kontakt@example.test",
              evidence: {
                value: [evidence("kontakt@example.test")],
              },
            },
          ],
        },
        {
          key: "project-nested",
          type: "project",
          data: {
            name: "Projekt Nested",
            operator_id: { $ref: "operator-nested" },
          },
          geography: [
            {
              key: "geo-maz",
              type: "WOJEWODZTWO",
              role: "OBEJMUJE",
              value: "mazowieckie",
              evidence: {
                value: [evidence("mazowieckie")],
              },
            },
          ],
          financing: [
            {
              key: "fin-b2c",
              company_size: "B2C",
              data: { refund_percent_standard: 80 },
              evidence: {
                refund_percent_standard: [evidence("80%", 80)],
              },
            },
          ],
          documents: [
            {
              key: "doc-form",
              document_type_key: "psf_application_form",
              data: {
                requirement: "REQUIRED",
                notes: "Wymagany formularz",
              },
              evidence: {
                notes: [evidence("Wymagany formularz")],
              },
            },
          ],
        },
      ],
    },
    0,
    uuid,
    "2026-09-24T10:00:00.000Z",
  );

  assert.equal(state.importTargetEvidence.length, 4);
  assert.deepEqual(
    new Set(state.importTargetEvidence.map((entry) => entry.target.kind)),
    new Set(["operator_contact", "geography", "funding", "document"]),
  );
  assert.ok(
    state.importTargetEvidence.every(
      (entry) =>
        entry.charStart >= 0 &&
        entry.charEnd > entry.charStart &&
        entry.sourceId,
    ),
  );
});

test("Import Review plan round-trips nested evidence", () => {
  const uuid = ids();
  const sourceText = "Obszar projektu: mazowieckie.";
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [
      {
        key: "page",
        type: "HTML",
        url: "https://example.test/project",
        snapshot: { text: sourceText },
      },
    ],
    objects: [
      {
        key: "project-evidence",
        type: "project",
        data: { name: "Projekt Evidence" },
        geography: [
          {
            key: "geo-1",
            type: "WOJEWODZTWO",
            role: "OBEJMUJE",
            value: "mazowieckie",
            evidence: {
              value: [
                {
                  source: "page",
                  ...range(sourceText, "mazowieckie"),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "nested-evidence.json",
    uuid,
    "2026-09-24T10:10:00.000Z",
  );
  const plan = reviewModule.buildImportApprovalPlan(
    session,
    session.objectOrder[0],
  );
  const portable = plan.document.objects.at(-1);

  assert.equal(
    portable.geography[0].evidence.value[0].raw_value,
    "mazowieckie",
  );
  assert.equal(plan.document.sources[0].key, "page");
  assert.ok(
    reviewModule
      .allImportReviewEvidenceViews(session)
      .some((entry) => entry.rawValue === "mazowieckie"),
  );
});


test("portable files are dynamic records with filename-derived names and free-form classification", () => {
  const uuid = ids();
  const sourceText =
    "Rodzaj: Oryginał operatora. Cel: Formularz do uzupełnienia. Zawiera pola: Tak. Wymagalność: Obowiązkowy.";
  const evidence = (raw, normalizedValue) => ({
    source: "page",
    ...range(sourceText, raw),
    ...(normalizedValue !== undefined
      ? { normalized_value: normalizedValue }
      : {}),
  });

  const state = formatModule.importDocumentIntoState(
    BurbotCore.empty(),
    {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [
        {
          key: "page",
          type: "HTML",
          url: "https://example.test/project",
          snapshot: { text: sourceText },
        },
        {
          key: "pdf",
          type: "PDF",
          url: "https://example.test/files/02_PUR_cz_2.pdf",
          snapshot: { text: "Plan Usług Rozwojowych cz. 2" },
        },
      ],
      objects: [
        {
          key: "project-files",
          type: "project",
          data: { name: "Projekt z plikiem" },
          files: [
            {
              source: "pdf",
              source_page: "page",
              name: "Ta nazwa jest legacy i ma być zignorowana.pdf",
              metadata: {
                document_kind: "Oryginał operatora",
                purpose: "Formularz do uzupełnienia",
                has_fields: true,
                intended_use: "Drugi etap aplikowania.",
                client_requirement: "Obowiązkowy po wstępnym zakwalifikowaniu",
                signature_requirement: "Wymagany podpisany plik",
                delivery_method: "Opracowany wzór / generator",
              },
              evidence: {
                document_kind: [evidence("Oryginał operatora")],
                purpose: [evidence("Formularz do uzupełnienia")],
                has_fields: [evidence("Tak", true)],
                client_requirement: [evidence("Obowiązkowy")],
              },
            },
          ],
        },
      ],
    },
    0,
    uuid,
    "2026-09-24T12:00:00.000Z",
  );

  const file = state.fileSources[0];
  assert.equal(file.name, "02_PUR_cz_2.pdf");
  assert.equal(file.document_kind, "Oryginał operatora");
  assert.equal(file.purpose, "Formularz do uzupełnienia");
  assert.equal(file.has_fields, true);
  assert.equal(
    file.client_requirement,
    "Obowiązkowy po wstępnym zakwalifikowaniu",
  );
  assert.equal(file.signature_requirement, "Wymagany podpisany plik");
  assert.equal(file.delivery_method, "Opracowany wzór / generator");

  const fileEvidence = state.importTargetEvidence.filter(
    (entry) =>
      entry.objectId === file.objectId &&
      entry.target.kind === "file_source" &&
      entry.target.id === file.id,
  );
  assert.equal(fileEvidence.length, 4);
  assert.ok(
    fileEvidence.some(
      (entry) =>
        entry.field === "has_fields" &&
        entry.normalizedValue === true,
    ),
  );
});

test("Import Review preserves dynamic file classification and file evidence", () => {
  const uuid = ids();
  const sourceText = "Cel dokumentu: Regulamin.";
  const document = {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [
      {
        key: "page",
        type: "HTML",
        url: "https://example.test/project",
        snapshot: { text: sourceText },
      },
      {
        key: "pdf",
        type: "PDF",
        url: "https://example.test/files/regulamin_naboru.pdf",
        snapshot: { text: "Regulamin" },
      },
    ],
    objects: [
      {
        key: "project-file-review",
        type: "project",
        data: { name: "Projekt File Review" },
        files: [
          {
            source: "pdf",
            source_page: "page",
            metadata: {
              document_kind: "Oryginał operatora",
              purpose: "Regulamin",
              has_fields: false,
              intended_use: "Główne zasady naboru",
              client_requirement: "Informacyjny",
              signature_requirement: "Nie jest wymagany",
              delivery_method: "Z oryginału operatora",
            },
            evidence: {
              purpose: [
                {
                  source: "page",
                  ...range(sourceText, "Regulamin"),
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const session = reviewModule.createImportReviewSession(
    document,
    "dynamic-file.json",
    uuid,
    "2026-09-24T12:10:00.000Z",
  );
  const reviewView = reviewModule.importReviewView(session);
  assert.equal(reviewView.files[0].name, "regulamin_naboru.pdf");
  assert.equal(reviewView.files[0].purpose, "Regulamin");
  assert.equal(reviewView.files[0].hasFields, false);
  assert.equal(reviewView.files[0].clientRequirement, "Informacyjny");

  const plan = reviewModule.buildImportApprovalPlan(
    session,
    session.objectOrder[0],
  );
  const portable = plan.document.objects.at(-1);

  assert.equal(portable.files.length, 1);
  assert.equal(portable.files[0].name, undefined);
  assert.equal(portable.files[0].metadata.purpose, "Regulamin");
  assert.equal(portable.files[0].metadata.has_fields, false);
  assert.equal(
    portable.files[0].evidence.purpose[0].raw_value,
    "Regulamin",
  );
});
