import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let session;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-commit-session-"));
  await build({
    absWorkingDir: root,
    entryPoints: { session: "src/shared/commits/session.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  session = await import(pathToFileURL(join(outputDir, "session.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function state(objects, revision = 4) {
  return {
    version: 1,
    revision,
    objects,
    rules: [],
    geographies: [],
    fileSources: [],
    importSources: [],
    financingRules: [],
    documentRequirements: [],
  };
}

const project = {
  id: "project-1",
  type: "project",
  label: "Generator Kompetencji 3.0",
  values: { name: "Generator Kompetencji 3.0", status: "AKTYWNY" },
  updatedAt: "2026-09-16T10:00:00.000Z",
};

test("fresh draft exposes committed objects as unchanged and is clean", () => {
  const base = state([project]);
  const draft = {
    id: "commit-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T10:00:00.000Z",
    baseRevision: 4,
    baseState: structuredClone(base),
    workingState: structuredClone(base),
  };

  const view = session.commitSessionView(draft);
  assert.equal(view.active, true);
  assert.equal(view.dirty, false);
  assert.equal(view.objects[0].status, "UNCHANGED");
});

test("new and edited objects are marked in commit projection", () => {
  const base = state([project]);
  const edited = structuredClone(project);
  edited.values.status = "ZAKONCZONY";
  edited.updatedAt = "2026-09-16T11:00:00.000Z";
  const operator = {
    id: "operator-1",
    type: "operator",
    label: "RARR",
    values: { name: "RARR" },
  };
  const draft = {
    id: "commit-2",
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T11:00:00.000Z",
    baseRevision: 4,
    baseState: structuredClone(base),
    workingState: state([edited, operator], 6),
  };

  const view = session.commitSessionView(draft);
  assert.equal(view.dirty, true);
  assert.deepEqual(view.objects[0].changes, [
    {
      field: "status",
      status: "MODIFIED",
      before: "AKTYWNY",
      after: "ZAKONCZONY",
    },
  ]);
  assert.deepEqual(view.objects[1].changes, [
    {
      field: "name",
      status: "ADDED",
      after: "RARR",
    },
  ]);
  assert.deepEqual(
    view.objects.map(({ id, status }) => [id, status]),
    [
      ["project-1", "MODIFIED"],
      ["operator-1", "NEW"],
    ],
  );
});

test("deleted database objects remain visible in the draft as DELETED", () => {
  const operator = {
    id: "operator-1",
    type: "operator",
    label: "RARR",
    values: { name: "RARR" },
  };
  const base = state([project, operator]);
  const draft = {
    id: "commit-3",
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    baseRevision: 4,
    baseState: structuredClone(base),
    workingState: state([project], 5),
  };

  const view = session.commitSessionView(draft);
  assert.equal(view.dirty, true);
  assert.deepEqual(
    view.objects.map(({ id, status }) => [id, status]),
    [
      ["project-1", "UNCHANGED"],
      ["operator-1", "DELETED"],
    ],
  );
});


test("related-only changes are visible in the commit diff", () => {
  const base = state([project]);
  const working = structuredClone(base);
  working.revision = 5;
  working.geographies.push({
    id: "geo-1",
    objectId: "project-1",
    type: "WOJEWODZTWO",
    role: "OBEJMUJE",
    value: "podkarpackie",
  });

  const draft = {
    id: "commit-4",
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    baseRevision: 4,
    baseState: base,
    workingState: working,
  };

  const view = session.commitSessionView(draft);
  assert.equal(view.objects[0].status, "MODIFIED");
  assert.deepEqual(view.objects[0].changes, []);
  assert.deepEqual(view.objects[0].relatedChanges, [
    {
      key: "geographies",
      label: "Geografia",
      added: 1,
      modified: 0,
      removed: 0,
    },
  ]);
});
