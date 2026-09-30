import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
let directory, review, session;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "burbot-review-"));
  await build({
    entryPoints: [
      "src/shared/commits/review.ts",
      "src/shared/commits/session.ts",
    ],
    outdir: directory,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  review = await import(pathToFileURL(join(directory, "review.js")));
  session = await import(pathToFileURL(join(directory, "session.js")));
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
function draft() {
  const base = {
    version: 1,
    revision: 8,
    objects: [
      {
        id: "p",
        type: "project",
        label: "Projekt",
        values: { name: "Projekt", status: "AKTYWNY", notes: "Było" },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "f",
        objectId: "p",
        name: "regulamin.pdf",
        fileType: "PDF",
        purpose: "Regulamin",
        url: "https://example.test/r.pdf",
      },
    ],
    financingRules: [],
    geographies: [
      {
        id: "g",
        objectId: "p",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "małopolskie",
      },
    ],
    operatorAssignments: [],
    fieldEvidence: [],
    importTargetEvidence: [],
    importSources: [],
  };
  const working = structuredClone(base);
  working.objects[0].values.status = "ZAWIESZONY";
  working.objects[0].values.notes = "Będzie";
  working.fileSources[0].purpose = "Inne";
  working.fileSources.push({
    id: "f-new",
    objectId: "p",
    name: "wniosek.pdf",
    fileType: "PDF",
    url: "https://example.test/w.pdf",
  });
  working.financingRules.push({
    id: "v",
    objectId: "p",
    variant_no: 1,
    refund_percent_max: 80,
  });
  working.geographies = [];
  return {
    id: "draft",
    createdAt: "2026-09-30",
    updatedAt: "2026-09-30",
    baseRevision: 8,
    baseState: base,
    workingState: working,
    stagedObjectIds: [],
    reviewVersion: 1,
  };
}
function unit(d, key) {
  return review.reviewChanges(d).find((item) => item.target.key === key);
}
function choose(d, key, decision) {
  const item = unit(d, key);
  assert.ok(item, key);
  review.decideReviewChange(d, item.id, decision, review.fingerprint(item));
  return item;
}

test("edits appear automatically with individual fields, files, variants and geography", () => {
  const d = draft(),
    view = session.commitSessionView(d);
  assert.equal(view.dirty, true);
  assert.equal(view.objects[0].staged, true);
  assert.equal(view.objects[0].reviewItems.length, 6);
  assert.deepEqual(
    new Set(view.objects[0].reviewItems.map((item) => item.group)),
    new Set(["Pola", "Pliki", "Warianty dofinansowania", "Geografia"]),
  );
});

test("partial save preserves baseline values and keeps deferred proposals after reload/rebase", () => {
  let d = draft();
  for (const key of ["notes", "f", "v", "g"]) choose(d, key, "later");
  d = JSON.parse(JSON.stringify(d));
  const saved = review.applyReviewedChanges(d);
  assert.equal(saved.objects[0].values.status, "ZAWIESZONY");
  assert.equal(saved.objects[0].values.notes, "Było");
  assert.equal(saved.fileSources[0].purpose, "Regulamin");
  assert.equal(saved.fileSources.length, 2);
  assert.equal(saved.financingRules.length, 0);
  assert.equal(saved.geographies.length, 1);
  saved.revision = 9;
  saved.objects[0].values.last_checked_at = "2026-09-30T12:00:00Z";
  review.rebaseReviewedChanges(d, saved);
  assert.equal(d.workingState.objects[0].values.notes, "Będzie");
  assert.equal(
    d.workingState.fileSources.find((row) => row.id === "f").purpose,
    "Inne",
  );
  assert.equal(d.workingState.financingRules.length, 1);
  assert.equal(d.workingState.geographies.length, 0);
  assert.equal(
    d.workingState.objects[0].values.last_checked_at,
    "2026-09-30T12:00:00Z",
  );
  assert.equal(review.reviewItems(d).length, 4);
  assert.ok(review.reviewItems(d).every((item) => item.selection === "later"));
  assert.equal(session.commitSessionView(d).dirty, false);
  choose(d, "notes", "save");
  assert.equal(
    review.applyReviewedChanges(d).objects[0].values.notes,
    "Będzie",
  );
});

test("reverting remains visible, is undoable after another save, and newer edits replace it", () => {
  const d = draft();
  const old = choose(d, "notes", "discard");
  assert.equal(d.workingState.objects[0].values.notes, "Było");
  assert.equal(
    review.reviewItems(d).find((item) => item.id === old.id).selection,
    "discarded",
  );
  review.rebaseReviewedChanges(d, review.applyReviewedChanges(d));
  review.decideReviewChange(d, old.id, "restore", review.fingerprint(old));
  assert.equal(d.workingState.objects[0].values.notes, "Będzie");
  assert.equal(
    review.reviewItems(d).find((item) => item.id === old.id).selection,
    "later",
  );
  choose(d, "notes", "discard");
  d.workingState.objects[0].values.notes = "Nowsza propozycja";
  review.refreshReviewDecisions(d);
  assert.equal(d.discardedChanges[old.id], undefined);
  assert.equal(
    review.reviewItems(d).find((item) => item.id === old.id).selection,
    "save",
  );
});

test("field evidence and target evidence follow their selected value without provenance leaking", () => {
  const d = draft();
  d.workingState.objects[0].evidence = {
    notes: [
      { sourceId: "s-notes", charStart: 0, charEnd: 6, rawValue: "Będzie" },
    ],
  };
  d.workingState.objects[0].manualFields = { notes: true };
  d.workingState.rules.push({
    id: "r",
    objectId: "p",
    field: "notes",
    pageUrl: "https://example.test",
    selector: "p",
  });
  d.workingState.importTargetEvidence.push({
    id: "e",
    objectId: "p",
    field: "purpose",
    target: { kind: "file_source", id: "f" },
    sourceId: "s-file",
    charStart: 0,
    charEnd: 4,
    rawValue: "Inne",
  });
  d.workingState.importSources = [
    {
      id: "s-notes",
      importKey: "notes",
      type: "HTML",
      snapshot: { text: "Będzie" },
    },
    {
      id: "s-file",
      importKey: "file",
      type: "HTML",
      snapshot: { text: "Inne" },
    },
  ];
  choose(d, "notes", "later");
  choose(d, "f", "later");
  let saved = review.applyReviewedChanges(d);
  assert.equal(saved.objects[0].evidence, undefined);
  assert.equal(saved.rules.length, 0);
  assert.equal(saved.importTargetEvidence.length, 0);
  assert.equal(saved.importSources.length, 0);
  choose(d, "f", "save");
  saved = review.applyReviewedChanges(d);
  assert.equal(saved.importTargetEvidence.length, 1);
  assert.deepEqual(
    saved.importSources.map((row) => row.id),
    ["s-file"],
  );
  choose(d, "notes", "discard");
  assert.equal(d.workingState.rules.length, 0);
  assert.equal(d.workingState.objects[0].evidence.notes, undefined);
  assert.equal(d.workingState.objects[0].manualFields.notes, undefined);
});

test("stale decisions fail instead of overwriting a newer edit", () => {
  const d = draft(),
    old = unit(d, "notes");
  d.workingState.objects[0].values.notes = "Nowa";
  assert.throws(
    () =>
      review.decideReviewChange(d, old.id, "discard", review.fingerprint(old)),
    /zmodyfikowana/,
  );
  assert.equal(d.workingState.objects[0].values.notes, "Nowa");
});

test("new objects can be saved partially but require their identity; deferred rows survive", () => {
  const d = draft();
  d.baseState = {
    ...d.baseState,
    objects: [],
    fileSources: [],
    geographies: [],
  };
  choose(d, "name", "later");
  assert.throws(() => review.applyReviewedChanges(d), /nazwę nowego obiektu/);
  choose(d, "name", "save");
  choose(d, "notes", "later");
  choose(d, "f-new", "later");
  const saved = review.applyReviewedChanges(d);
  assert.equal(saved.objects[0].values.name, "Projekt");
  assert.equal(saved.objects[0].values.notes, undefined);
  assert.equal(
    saved.fileSources.some((row) => row.id === "f-new"),
    false,
  );
  review.rebaseReviewedChanges(d, saved);
  assert.equal(
    d.workingState.fileSources.some((row) => row.id === "f-new"),
    true,
  );
  assert.equal(d.workingState.objects[0].values.notes, "Będzie");
});

test("geography cannot be saved with an omitted operator assignment", () => {
  const d = draft();
  d.workingState.objects.push({
    id: "op",
    type: "operator",
    values: { name: "Operator" },
  });
  d.workingState.operatorAssignments.push({
    id: "a",
    objectId: "p",
    operatorId: "op",
    operatorType: "GLOWNY",
  });
  d.workingState.geographies.push({
    id: "g2",
    objectId: "p",
    operatorId: "op",
    type: "WOJEWODZTWO",
    role: "OBEJMUJE",
    value: "śląskie",
  });
  choose(d, "a", "later");
  assert.throws(() => review.applyReviewedChanges(d), /przypisania operatora/);
  choose(d, "a", "save");
  assert.equal(review.applyReviewedChanges(d).geographies[0].operatorId, "op");
});

test("deletion is one selectable change and reverting restores the object with its children", () => {
  const d = draft();
  d.workingState.objects = [];
  d.workingState.fileSources = [];
  d.workingState.geographies = [];
  const deletion = choose(d, "object", "later");
  assert.equal(review.applyReviewedChanges(d).objects.length, 1);
  review.decideReviewChange(
    d,
    deletion.id,
    "discard",
    review.fingerprint(deletion),
  );
  assert.equal(d.workingState.objects[0].values.name, "Projekt");
  assert.equal(d.workingState.fileSources[0].id, "f");
  assert.equal(
    review.reviewItems(d).find((item) => item.id === deletion.id).selection,
    "discarded",
  );
});

test("final save rejects a changed selection from another panel", () => {
  const d = draft();
  const expected = review
    .reviewItems(d)
    .filter((item) => item.selection === "save")
    .map(({ id, fingerprint }) => ({ id, fingerprint }));
  assert.doesNotThrow(() => review.validateReviewSelection(d, expected));
  choose(d, "notes", "later");
  assert.throws(
    () => review.validateReviewSelection(d, expected),
    /innym miejscu/,
  );
  choose(d, "notes", "save");
  d.workingState.objects[0].values.notes = "Nowsza treść";
  assert.throws(
    () => review.validateReviewSelection(d, expected),
    /innym miejscu/,
  );
});

test("document evidence follows its business key and role changes cannot leave two main operators", () => {
  const d = draft();
  d.workingState.documentRequirements = [
    {
      id: "doc-id",
      objectId: "p",
      document_type_key: "form",
      requirement: "REQUIRED",
    },
  ];
  d.workingState.importTargetEvidence = [
    {
      id: "doc-evidence",
      objectId: "p",
      field: "requirement",
      target: { kind: "document", id: "form" },
      sourceId: "doc-source",
    },
  ];
  d.workingState.importSources = [
    {
      id: "doc-source",
      importKey: "doc",
      type: "HTML",
      snapshot: { text: "Wymagany" },
    },
  ];
  const saved = review.applyReviewedChanges(d);
  assert.equal(saved.importTargetEvidence[0].id, "doc-evidence");
  assert.equal(saved.importSources[0].id, "doc-source");
  choose(d, "form", "later");
  assert.equal(review.applyReviewedChanges(d).importTargetEvidence.length, 0);
  d.baseState.operatorAssignments = [
    { id: "old-op", objectId: "p", operatorId: "a", operatorType: "GLOWNY" },
  ];
  d.workingState.operatorAssignments = [
    { id: "old-op", objectId: "p", operatorId: "a", operatorType: "DODATKOWY" },
    { id: "new-op", objectId: "p", operatorId: "b", operatorType: "GLOWNY" },
  ];
  choose(d, "old-op", "later");
  assert.throws(
    () => review.applyReviewedChanges(d),
    /jednego operatora głównego/,
  );
});

test("a deferred reimport cannot leak a new snapshot through an unchanged file source key", () => {
  const d = draft();
  const old = {
    id: "s-old",
    importKey: "reg",
    type: "PDF",
    url: "https://example.test/r.pdf",
    snapshot: { text: "Stary regulamin" },
  };
  d.baseState.importSources = [old];
  d.baseState.fileSources[0].sourceImportKey = "reg";
  d.workingState.fileSources[0].sourceImportKey = "reg";
  d.workingState.importSources = [
    old,
    { ...old, id: "s-new", snapshot: { text: "Nowy regulamin" } },
  ];
  d.workingState.objects[0].evidence = {
    notes: [{ sourceId: "s-new", rawValue: "Będzie" }],
  };
  choose(d, "notes", "later");
  choose(d, "f", "later");
  assert.deepEqual(
    review.applyReviewedChanges(d).importSources.map((row) => row.id),
    ["s-old"],
  );
  choose(d, "notes", "save");
  assert.deepEqual(
    review.applyReviewedChanges(d).importSources.map((row) => row.id),
    ["s-old", "s-new"],
  );
});
