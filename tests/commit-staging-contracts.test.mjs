import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let staging;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-commit-staging-"));
  await build({
    absWorkingDir: root,
    entryPoints: { staging: "src/shared/commits/staging.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  staging = await import(pathToFileURL(join(outputDir, "staging.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function state(objects) {
  return {
    version: 1,
    revision: 7,
    objects,
    rules: [],
    geographies: [],
    operatorContacts: [],
    fileSources: [],
    importSources: [],
    financingRules: [],
    documentRequirements: [],
    fieldEvidence: [],
  };
}

const projectA = {
  id: "project-a",
  type: "project",
  label: "A",
  values: { name: "A", number: "OLD-A" },
};

const projectB = {
  id: "project-b",
  type: "project",
  label: "B",
  values: { name: "B", number: "OLD-B" },
};

test("applyStagedObjects commits only selected View objects", () => {
  const base = state([projectA, projectB]);
  const working = structuredClone(base);
  working.objects[0].values.number = "NEW-A";
  working.objects[1].values.number = "NEW-B";
  working.geographies.push({
    id: "geo-a",
    objectId: "project-a",
    type: "WOJEWODZTWO",
    role: "OBEJMUJE",
    value: "małopolskie",
  });
  working.geographies.push({
    id: "geo-b",
    objectId: "project-b",
    type: "WOJEWODZTWO",
    role: "OBEJMUJE",
    value: "śląskie",
  });

  const draft = {
    id: "draft",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    baseRevision: 7,
    baseState: base,
    workingState: working,
    stagedObjectIds: ["project-a"],
  };

  const committed = staging.applyStagedObjects(draft);
  assert.equal(committed.objects[0].values.number, "NEW-A");
  assert.equal(committed.objects[1].values.number, "OLD-B");
  assert.deepEqual(
    committed.geographies.map((row) => row.objectId),
    ["project-a"],
  );
});

test("unstage keeps View changes while discard restores one object", () => {
  const base = state([projectA, projectB]);
  const working = structuredClone(base);
  working.objects[0].values.number = "NEW-A";
  working.objects[1].values.number = "NEW-B";

  const draft = {
    id: "draft",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    baseRevision: 7,
    baseState: base,
    workingState: working,
    stagedObjectIds: ["project-a", "project-b"],
  };

  staging.unstageObject(draft, "project-a");
  assert.deepEqual(draft.stagedObjectIds, ["project-b"]);
  assert.equal(draft.workingState.objects[0].values.number, "NEW-A");

  staging.discardViewObject(draft, "project-b");
  assert.equal(draft.workingState.objects[0].values.number, "NEW-A");
  assert.equal(draft.workingState.objects[1].values.number, "OLD-B");
  assert.deepEqual(draft.stagedObjectIds, []);
});


test("partial commit keeps import provenance only for staged objects", () => {
  const base = state([projectA, projectB]);
  const working = structuredClone(base);
  working.objects[0].values.number = "NEW-A";
  working.objects[1].values.number = "NEW-B";
  working.objects[0].evidence = {
    number: [
      {
        sourceId: "source-a",
        charStart: 0,
        charEnd: 5,
        rawValue: "NEW-A",
      },
    ],
  };
  working.objects[1].evidence = {
    number: [
      {
        sourceId: "source-b",
        charStart: 0,
        charEnd: 5,
        rawValue: "NEW-B",
      },
    ],
  };
  working.importSources = [
    {
      id: "source-a",
      importKey: "page-a",
      type: "HTML",
      snapshot: { text: "NEW-A" },
      importedAt: "2026-09-22T10:00:00.000Z",
    },
    {
      id: "source-b",
      importKey: "page-b",
      type: "HTML",
      snapshot: { text: "NEW-B" },
      importedAt: "2026-09-22T10:00:00.000Z",
    },
  ];

  const draft = {
    id: "draft",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    baseRevision: 7,
    baseState: base,
    workingState: working,
    stagedObjectIds: ["project-a"],
  };

  const committed = staging.applyStagedObjects(draft);
  assert.deepEqual(
    committed.importSources.map((row) => row.id),
    ["source-a"],
  );
});

test("partial commit reports references to new objects left only in View", () => {
  const recruitment = {
    id: "recruitment-1",
    type: "recruitment",
    label: "Nabór",
    values: {
      external_number: "Nabór",
      project_id: "project-new",
    },
  };
  const newProject = {
    id: "project-new",
    type: "project",
    label: "Nowy projekt",
    values: { name: "Nowy projekt" },
  };
  const candidate = state([recruitment]);

  const missing = staging.missingReferences(candidate, {
    recruitment: {
      fields: {
        project_id: { type: "reference" },
      },
    },
    project: { fields: {} },
  });
  assert.deepEqual(missing, [
    {
      objectId: "recruitment-1",
      field: "project_id",
      targetId: "project-new",
    },
  ]);

  candidate.objects.push(newProject);
  assert.deepEqual(
    staging.missingReferences(candidate, {
      recruitment: {
        fields: {
          project_id: { type: "reference" },
        },
      },
      project: { fields: {} },
    }),
    [],
  );
});


test("rebase after partial commit clears committed changes but preserves unstaged View edits", () => {
  const base = state([projectA, projectB]);
  const working = structuredClone(base);
  working.objects[0].values.number = "NEW-A";
  working.objects[1].values.number = "NEW-B";

  const draft = {
    id: "draft",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    baseRevision: 7,
    baseState: base,
    workingState: working,
    stagedObjectIds: ["project-a"],
  };

  const committed = state([
    {
      ...structuredClone(projectA),
      values: {
        ...projectA.values,
        number: "NEW-A",
        last_checked_at: "2026-09-22T11:00:00.000Z",
      },
    },
    structuredClone(projectB),
  ]);
  committed.revision = 8;

  staging.rebaseCommittedObjects(draft, committed, ["project-a"]);
  draft.baseState = structuredClone(committed);
  draft.baseRevision = 8;
  draft.stagedObjectIds = [];

  assert.equal(
    draft.workingState.objects[0].values.last_checked_at,
    "2026-09-22T11:00:00.000Z",
  );
  assert.equal(draft.workingState.objects[0].values.number, "NEW-A");
  assert.equal(draft.workingState.objects[1].values.number, "NEW-B");
  assert.deepEqual(staging.changedObjectIds(draft), ["project-b"]);
});
