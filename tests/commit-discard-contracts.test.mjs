import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let moduleUnderTest;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-discard-object-"));
  await build({
    absWorkingDir: root,
    entryPoints: { discard: "src/shared/commits/discardObject.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  moduleUnderTest = await import(
    pathToFileURL(join(outputDir, "discard.js")).href
  );
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function state() {
  return {
    version: 1,
    revision: 10,
    objects: [
      {
        id: "project-1",
        type: "project",
        label: "Project A",
        values: { name: "Project A", status: "AKTYWNY" },
      },
      {
        id: "project-2",
        type: "project",
        label: "Project B",
        values: { name: "Project B", status: "AKTYWNY" },
      },
    ],
    rules: [
      {
        id: "rule-1",
        objectId: "project-1",
        field: "status",
        pageUrl: "https://example.test",
        selector: "body",
        extraction: { type: "text" },
      },
    ],
    geographies: [
      {
        id: "geo-1",
        objectId: "project-1",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "podkarpackie",
      },
    ],
    operatorContacts: [],
    fileSources: [],
    financingRules: [],
    documentRequirements: [],
    fieldEvidence: [],
  };
}

test("discarding one object restores only that object and its owned rows", () => {
  const base = state();
  const working = structuredClone(base);
  working.revision = 14;
  working.objects[0].values.status = "ZAKONCZONY";
  working.objects[1].values.status = "ZAWIESZONY";
  working.geographies.push({
    id: "geo-extra",
    objectId: "project-1",
    type: "POWIAT",
    role: "OBEJMUJE",
    value: "podkarpackie|powiat|rzeszowski",
  });

  const draft = {
    id: "commit-1",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:10:00.000Z",
    baseRevision: 10,
    baseState: base,
    workingState: working,
  };

  const next = moduleUnderTest.discardObjectChanges(
    draft,
    "project-1",
    "2026-09-22T10:20:00.000Z",
  );

  assert.equal(next.workingState.objects[0].values.status, "AKTYWNY");
  assert.equal(next.workingState.objects[1].values.status, "ZAWIESZONY");
  assert.deepEqual(
    next.workingState.geographies.filter(
      (row) => row.objectId === "project-1",
    ),
    base.geographies,
  );
  assert.equal(next.workingState.revision, 15);
});

test("discarding a newly staged object removes it without touching others", () => {
  const base = state();
  const working = structuredClone(base);
  working.objects.push({
    id: "new-operator",
    type: "operator",
    label: "New operator",
    values: { name: "New operator" },
  });
  working.operatorContacts.push({
    id: "contact-1",
    objectId: "new-operator",
    kind: "EMAIL",
    variant_no: 1,
    value: "test@example.test",
  });

  const draft = {
    id: "commit-2",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:10:00.000Z",
    baseRevision: 10,
    baseState: base,
    workingState: working,
  };

  const next = moduleUnderTest.discardObjectChanges(
    draft,
    "new-operator",
    "2026-09-22T10:20:00.000Z",
  );

  assert.equal(
    next.workingState.objects.some((object) => object.id === "new-operator"),
    false,
  );
  assert.equal(
    next.workingState.operatorContacts.some(
      (row) => row.objectId === "new-operator",
    ),
    false,
  );
  assert.equal(next.workingState.objects.length, base.objects.length);
});


test("new staged object cannot be discarded while another staged object references it", () => {
  const base = state();
  const working = structuredClone(base);
  working.objects.push(
    {
      id: "new-project",
      type: "project",
      label: "New project",
      values: { name: "New project" },
    },
    {
      id: "new-recruitment",
      type: "recruitment",
      label: "New recruitment",
      values: {
        external_number: "Nabór X",
        project_id: "new-project",
      },
    },
  );

  const draft = {
    id: "commit-3",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:10:00.000Z",
    baseRevision: 10,
    baseState: base,
    workingState: working,
  };

  assert.throws(
    () =>
      moduleUnderTest.discardObjectChanges(
        draft,
        "new-project",
        "2026-09-22T10:20:00.000Z",
      ),
    /Najpierw odrzuć obiekty zależne/,
  );
});
