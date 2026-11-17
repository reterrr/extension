import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import Database from "better-sqlite3";
import {
  migrateLegacySelectors,
  migrateRuleSelector,
} from "../src/shared/selectors/migration.js";
import {
  validateSelectorTree,
  validateSelectorTransition,
} from "../src/shared/selectors/validation.js";
import {
  writeSelectorTrees,
  readSelectorTree,
} from "../scripts/db/selectors.mjs";

const root = resolve(import.meta.dirname, "..");
let output, runtime, repository, ruleFactory, dto;
before(async () => {
  output = await mkdtemp(join(tmpdir(), "burbot-unified-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      runtime: "src/content/extraction-runner.ts",
      repository: "src/shared/selectors/repository.ts",
      dto: "src/shared/selectors/dto.ts",
      rules: "src/shared/extraction/rules.ts",
      core: "src/shared/domain/core.js",
      schema: "src/shared/domain/schema.js",
    },
    outdir: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  runtime = await import(pathToFileURL(join(output, "runtime.js")));
  repository = await import(pathToFileURL(join(output, "repository.js")));
  ruleFactory = await import(pathToFileURL(join(output, "rules.js")));
  dto = await import(pathToFileURL(join(output, "dto.js")));
  await import(pathToFileURL(join(output, "schema.js")));
  await import(pathToFileURL(join(output, "core.js")));
});
after(async () => {
  await rm(output, { recursive: true, force: true });
});

function legacy(overrides = {}) {
  return {
    id: "legacy-17",
    objectId: "R_42",
    field: "name",
    pageUrl: "https://example.test/",
    selector: "#funding",
    selectorFallbacks: [".funding", "#funding"],
    extraction: { type: "text" },
    sampleValue: "80%",
    createdAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}
function tree() {
  const rule = legacy();
  migrateRuleSelector(rule);
  return rule.selectorTree;
}
function css(selector, order = 0) {
  return { uuid: randomUUID(), kind: "css_path", order, selector };
}
function part(locators, order = 0, extraction = { type: "text" }) {
  return { uuid: randomUUID(), order, extraction, locators };
}
function recipe(parts, order = 0) {
  return { uuid: randomUUID(), order, parts };
}
function version(recipes) {
  return { ...tree().versions[0], recipes };
}
function runtimeWith(values) {
  return {
    resolve(locator) {
      if (locator.kind === "dom_path") return null;
      const value =
        values[locator.selector ?? locator.expression ?? locator.kind];
      if (value instanceof Error) throw value;
      return (
        Array.isArray(value) ? value : value === undefined ? [] : [value]
      ).map((value) => ({ value }));
    },
    read: (target) => target.value,
  };
}

test("migration creates one complete tree, preserves legacy mapping and remains idempotent", () => {
  const rule = legacy();
  assert.equal(migrateRuleSelector(rule), true);
  const definition = structuredClone(rule.selectorTree);
  validateSelectorTree(definition);
  assert.equal(definition.selector.migration.legacyRuleId, "legacy-17");
  assert.equal(definition.selector.migration.provenance, "unverified");
  const [v] = definition.versions;
  assert.equal(v.createdFromSnapshotUuid, null);
  assert.equal(v.artifactType, null);
  assert.equal(v.recipes.length, 1);
  assert.equal(v.recipes[0].parts.length, 1);
  assert.deepEqual(
    v.recipes[0].parts[0].locators.map((locator) => locator.selector),
    ["#funding", ".funding"],
  );
  assert.equal(JSON.stringify(definition).includes("sampleValue"), false);
  assert.equal(migrateRuleSelector(rule), false);
  assert.deepEqual(rule.selectorTree, definition);
});

test("migration maps attribute names, selection quotes and mirrored CSS; leaves PDF and page URL rules alone", () => {
  for (const extraction of [
    { type: "attribute", attribute: "content", selectorFallbacks: ["meta"] },
    {
      type: "selection",
      quote: { exact: "80%", prefix: "Funding ", suffix: "" },
    },
  ]) {
    const rule = legacy({ extraction, selectorFallbacks: undefined });
    migrateRuleSelector(rule);
    const p = rule.selectorTree.versions[0].recipes[0].parts[0];
    assert.equal(p.extraction.type, extraction.type);
    if (extraction.type === "attribute") {
      assert.equal(p.extraction.name, "content");
      assert.equal(p.locators.length, 2);
    } else assert.deepEqual(p.extraction.quote, extraction.quote);
  }
  for (const type of ["pageUrl", "pdfText"])
    assert.equal(
      migrateRuleSelector(legacy({ selector: null, extraction: { type } })),
      false,
    );
});

test("all successful locators are checked, with conflicts and match counts retained", () => {
  const p = part([
    css("#first"),
    css("#second", 1),
    css(".ambiguous", 2),
    css(".missing", 3),
  ]);
  const result = runtime.evaluatePart(
    p,
    runtimeWith({
      "#first": "80%",
      "#second": "85%",
      ".ambiguous": ["80%", "80%"],
    }),
  );
  assert.equal(result.status, "conflict");
  assert.deepEqual(
    result.locatorResults.map((item) => [item.status, item.matchCount]),
    [
      ["success", 1],
      ["success", 1],
      ["ambiguous", 2],
      ["not_found", 0],
    ],
  );
  assert.equal(result.rawValue, undefined);
});

test("an unambiguous fallback can recover a missing or ambiguous locator without losing its diagnostics", () => {
  const result = runtime.evaluatePart(
    part([css(".many"), css("#unique", 1)]),
    runtimeWith({ ".many": ["bad", "bad"], "#unique": "80%" }),
  );
  assert.equal(result.status, "success");
  assert.equal(result.rawValue, "80%");
  assert.equal(result.locatorResults[0].status, "ambiguous");
});

test("CSS, XPath and TextQuote are independent alternatives and do not turn into recipes", () => {
  const v = version([
    recipe([
      part([
        css("#css"),
        { uuid: randomUUID(), order: 1, kind: "xpath", expression: "//span" },
        {
          uuid: randomUUID(),
          order: 2,
          kind: "text_quote",
          quote: { exact: "80%" },
        },
      ]),
    ]),
  ]);
  const result = runtime.evaluateSelectorVersion(
    v,
    runtimeWith({ "#css": "80%", "//span": "80%", text_quote: "80%" }),
  );
  assert.equal(result.status, "success");
  assert.equal(result.recipeResults.length, 1);
  assert.equal(result.recipeResults[0].partResults[0].locatorResults.length, 3);
});

test("parts are assembled in order and independent complete recipes must reach consensus", () => {
  const number = part([css("#number")], 0);
  const percent = { ...part([css("#percent")], 1), joinWith: "" };
  const v = version([
    recipe([percent, number], 1),
    recipe([part([css("meta")])], 0),
  ]);
  const values = { "#number": "80", "#percent": "%", meta: "80%" };
  assert.equal(
    runtime.evaluateSelectorVersion(v, runtimeWith(values)).rawValue,
    "80%",
  );
  const conflict = runtime.evaluateSelectorVersion(
    v,
    runtimeWith({ ...values, meta: "85%" }),
  );
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(
    conflict.recipeResults.map((item) => item.rawValue),
    ["85%", "80%"],
  );
  assert.equal(
    runtime.evaluateSelectorVersion(
      v,
      runtimeWith({ "#number": "80", "#percent": "%" }),
    ).status,
    "not_found",
  );
  percent.joinWith = " ";
  assert.equal(
    runtime.evaluateRecipe(v.recipes[0], runtimeWith(values)).rawValue,
    "80 %",
  );
});

test("consensus preserves meaningful text differences unless an explicit normalizer is supplied", () => {
  const v = version([
    recipe([part([css("a")])]),
    recipe([part([css("b")])], 1),
  ]);
  const r = runtimeWith({ a: "A 80.0%", b: "a 80.0%" });
  assert.equal(runtime.evaluateSelectorVersion(v, r).status, "conflict");
  assert.equal(
    runtime.evaluateSelectorVersion(v, r, {
      normalize: (value) => value.toLowerCase(),
    }).status,
    "success",
  );
});

test("unsupported reserved locators and invalid expressions produce explicit diagnostics", () => {
  const unsupported = {
    uuid: randomUUID(),
    order: 0,
    kind: "dom_path",
    payload: {
      root: "document",
      segments: [{ tagName: "html", siblingIndex: 0 }],
    },
  };
  assert.equal(
    runtime.evaluateLocator(unsupported, { type: "text" }, runtimeWith({}))
      .status,
    "unsupported",
  );
  const bad = runtime.evaluateLocator(
    css("[invalid"),
    { type: "text" },
    runtimeWith({ "[invalid": new Error("Invalid CSS") }),
  );
  assert.equal(bad.status, "error");
  assert.match(bad.diagnostic, /Invalid CSS/);
});

test("draft editing leaves the active version unchanged, and activation retains immutable history", () => {
  const original = tree();
  const before = structuredClone(original.versions[0]);
  const draftTree = repository.createSelectorDraft(original);
  const draft = draftTree.versions[1];
  assert.notEqual(draft.recipes[0].uuid, before.recipes[0].uuid);
  draft.recipes[0].parts[0].locators[0].selector = "#new";
  const saved = repository.saveSelectorDraft(draftTree, draft);
  assert.deepEqual(saved.versions[0], before);
  assert.deepEqual(original.versions, [before]);
  const approved = repository.reviewSelectorDraft(saved, draft.uuid, true);
  assert.equal(approved.versions[0].status, "superseded");
  assert.equal(approved.selector.activeVersionUuid, draft.uuid);
  assert.equal(approved.versions[1].status, "active");
  assert.throws(
    () => repository.saveSelectorDraft(approved, approved.versions[1]),
    /Only a draft/,
  );
  const tampered = structuredClone(approved);
  tampered.versions[0].recipes[0].parts[0].locators[0].selector = "#tampered";
  assert.throws(
    () => validateSelectorTransition(approved, tampered),
    /immutable/,
  );
});

test("rejection and failed evaluations never activate a new version", () => {
  const original = tree();
  const before = structuredClone(original);
  const draft = repository.createSelectorDraft(original);
  const rejected = repository.reviewSelectorDraft(
    draft,
    draft.versions[1].uuid,
    false,
  );
  assert.equal(rejected.versions[1].status, "rejected");
  assert.equal(
    rejected.selector.activeVersionUuid,
    original.selector.activeVersionUuid,
  );
  runtime.evaluateSelectorVersion(original.versions[0], runtimeWith({}));
  assert.deepEqual(original, before);
});

test("several explicitly approved versions in View can share one final commit", () => {
  const before = tree();
  const second = repository.createSelectorDraft(before);
  const approvedSecond = repository.reviewSelectorDraft(
    second,
    second.versions[1].uuid,
    true,
  );
  const third = repository.createSelectorDraft(approvedSecond);
  const approvedThird = repository.reviewSelectorDraft(
    third,
    third.versions[2].uuid,
    true,
  );
  validateSelectorTransition(before, approvedThird);
  assert.deepEqual(
    approvedThird.versions.map((item) => item.status),
    ["superseded", "superseded", "active"],
  );
});

test("JSON import/export preserves UUIDs and history and validates typed reserved payloads", () => {
  const definition = repository.createSelectorDraft(tree());
  assert.deepEqual(
    repository.importSelectorTree(repository.exportSelectorTree(definition)),
    definition,
  );
  const locator = definition.versions[1].recipes[0].parts[0].locators[0];
  delete locator.selector;
  Object.assign(locator, {
    kind: "text_position",
    payload: {
      start: 0,
      end: 3,
      coordinates: {
        representation: "rendered_dom_text",
        representationVersion: "backend-v1",
        offsetUnit: "unicode_codepoint",
        contentHash: { algorithm: "sha256", value: "a".repeat(64) },
      },
    },
  });
  validateSelectorTree(definition);
  locator.payload.coordinates.contentHash = undefined;
  assert.throws(() => repository.importSelectorTree(definition), /hash/);
  assert.throws(
    () => repository.importSelectorTree({ selector: {} }),
    /Invalid/,
  );
});

test("future DTOs omit local migration metadata and reject results embedded in definitions", () => {
  const definition = tree();
  const transport = dto.selectorTreeDTO(definition);
  assert.equal(transport.selector.migration, undefined);
  assert.equal(transport.selector.uuid, definition.selector.uuid);
  assert.deepEqual(transport.versions, definition.versions);
  definition.versions[0].rawValue = "80%";
  assert.throws(
    () => repository.importSelectorTree(definition),
    /Unexpected field/,
  );
});

test("evaluation records are separate from definitions and validate every locator diagnostic", () => {
  const rule = legacy();
  migrateRuleSelector(rule);
  const original = {
    version: 1,
    revision: 2,
    objects: [{ id: "R_42", type: "project", values: { name: "80%" } }],
    rules: [rule],
  };
  const evaluation = runtime.evaluateSelectorVersion(
    rule.selectorTree.versions[0],
    runtimeWith({ "#funding": "80%", ".funding": "80%" }),
  );
  const message = {
    op: "SELECTOR_RECORD_EVALUATIONS",
    objectId: "R_42",
    expectedRevision: 2,
    evaluations: [{ ruleId: rule.id, evaluation }],
  };
  const state = repository.mutateSelectorState(
    original,
    message,
    "2026-11-17T12:00:00Z",
  );
  assert.deepEqual(state.rules[0].selectorTree, rule.selectorTree);
  assert.equal(state.rules[0].selectorEvaluations[0].result.status, "success");
  evaluation.recipeResults[0].partResults[0].locatorResults = [];
  assert.throws(
    () =>
      repository.mutateSelectorState(original, message, "2026-11-17T12:00:00Z"),
    /Incomplete/,
  );
});

test("editing a tested draft clears stale diagnostics without touching active evaluations", () => {
  const rule = legacy();
  migrateRuleSelector(rule);
  rule.selectorTree = repository.createSelectorDraft(rule.selectorTree);
  const original = {
    version: 1,
    revision: 0,
    objects: [{ id: "R_42", type: "project", values: { name: "80%" } }],
    rules: [rule],
  };
  const r = runtimeWith({ "#funding": "80%", ".funding": "80%" });
  const state = repository.mutateSelectorState(
    original,
    {
      op: "SELECTOR_RECORD_EVALUATIONS",
      objectId: "R_42",
      expectedRevision: 0,
      evaluations: rule.selectorTree.versions.map((version) => ({
        ruleId: rule.id,
        evaluation: runtime.evaluateSelectorVersion(version, r),
      })),
    },
    "2026-11-17T12:00:00Z",
  );
  const version = structuredClone(state.rules[0].selectorTree.versions[1]);
  version.recipes[0].parts[0].locators.pop();
  const saved = repository.mutateSelectorState(
    state,
    {
      op: "SELECTOR_SAVE_DRAFT",
      objectId: "R_42",
      ruleId: rule.id,
      expectedRevision: state.revision,
      version,
    },
    "2026-11-17T13:00:00Z",
  );
  assert.equal(saved.rules[0].selectorEvaluations.length, 1);
  assert.equal(
    saved.rules[0].selectorEvaluations[0].result.selectorVersionUuid,
    rule.selectorTree.versions[0].uuid,
  );
  assert.deepEqual(
    saved.rules[0].selectorTree.versions[0],
    rule.selectorTree.versions[0],
  );
});

test("SQLite normalizes the tree and preserves its identity across a file restart", async () => {
  const path = join(output, "selectors.sqlite");
  const schema = await readFile(join(root, "scripts/db/schema.sql"), "utf8");
  let db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  db.prepare(
    "INSERT INTO workspace_objects(object_id, object_type, values_json) VALUES (?, ?, ?)",
  ).run("R_42", "project", "{}");
  const rule = legacy();
  const state = { rules: [rule] };
  db.transaction(() => writeSelectorTrees(db, state))();
  const expected = structuredClone(rule.selectorTree);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM selector_locators").get().n,
    2,
  );
  db.close();
  db = new Database(path);
  db.pragma("foreign_keys = ON");
  assert.deepEqual(readSelectorTree(db, expected.selector.uuid), expected);
  const draftTree = repository.createSelectorDraft(expected);
  const before = structuredClone(state);
  rule.selectorTree = repository.reviewSelectorDraft(
    draftTree,
    draftTree.versions[1].uuid,
    true,
  );
  const withoutReview = structuredClone(state);
  delete withoutReview.rules[0].selectorTree.versions[1].reviewedAt;
  assert.throws(
    () => db.transaction(() => writeSelectorTrees(db, withoutReview, before))(),
    /new draft/,
  );
  // Draft creation and explicit approval in View can share one SQLite commit.
  db.transaction(() => writeSelectorTrees(db, state, before))();
  const approvedState = structuredClone(state);
  rule.selectorEvaluations = [
    {
      uuid: randomUUID(),
      evaluatedAt: "2026-11-17T12:00:00Z",
      pageUrl: rule.pageUrl,
      result: runtime.evaluateSelectorVersion(
        rule.selectorTree.versions[1],
        runtimeWith({ "#funding": "80%", ".funding": "80%" }),
      ),
    },
  ];
  db.transaction(() => writeSelectorTrees(db, state, approvedState))();
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM selector_evaluations").get().n,
    1,
  );
  const stored = readSelectorTree(db, expected.selector.uuid);
  const invalid = structuredClone(state);
  invalid.rules[0].selectorTree.versions[1].recipes[0].parts[0].locators[0].selector =
    "#illegal";
  assert.throws(
    () => db.transaction(() => writeSelectorTrees(db, invalid, state))(),
    /immutable/,
  );
  assert.deepEqual(readSelectorTree(db, expected.selector.uuid), stored);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM workspace_objects").get().n,
    1,
  );
  db.transaction(() => {
    db.exec(
      "UPDATE selectors SET active_version_uuid = NULL; DELETE FROM selectors",
    );
  })();
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM selector_versions").get().n,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM workspace_objects").get().n,
    1,
  );
  db.close();
});

test("SQLite enforces unique version numbers, active versions, order and foreign keys", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(await readFile(join(root, "scripts/db/schema.sql"), "utf8"));
  db.prepare(
    "INSERT INTO workspace_objects(object_id, object_type, values_json) VALUES ('R_42', 'project', '{}')",
  ).run();
  const rule = legacy();
  db.transaction(() => writeSelectorTrees(db, { rules: [rule] }))();
  const v = rule.selectorTree.versions[0];
  const insert = db.prepare(
    "INSERT INTO selector_versions(uuid, selector_uuid, version_no, status, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  assert.throws(
    () => insert.run(randomUUID(), v.selectorUuid, 1, "draft", v.createdAt),
    /UNIQUE/,
  );
  assert.throws(
    () => insert.run(randomUUID(), v.selectorUuid, 2, "active", v.createdAt),
    /UNIQUE/,
  );
  assert.throws(
    () => insert.run(randomUUID(), randomUUID(), 2, "draft", v.createdAt),
    /FOREIGN KEY/,
  );
  const p = v.recipes[0].parts[0];
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO selector_locators VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), p.uuid, 0, "css_path", '{"selector":"a"}'),
    /UNIQUE/,
  );
  db.close();
});

test("picker transport becomes a canonical tree on assignment, and recapture creates a draft", () => {
  const candidateVersion = {
    ...tree().versions[0],
    status: "draft",
    artifactType: "rendered_dom",
  };
  const candidate = {
    pageUrl: "https://example.test/",
    selector: "#funding",
    options: [],
  };
  const option = {
    label: "Element text",
    raw: "80%",
    extraction: { type: "text" },
    selectorVersion: candidateVersion,
  };
  const captured = ruleFactory.createCapturedExtractionInput(candidate, option);
  const original = {
    version: 1,
    revision: 0,
    objects: [{ id: "R_42", type: "project", values: { name: "Old" } }],
    rules: [],
  };
  const assigned = BurbotCore.mutate(
    original,
    {
      op: "ASSIGN",
      objectId: "R_42",
      field: "name",
      candidate: captured,
      expectedRevision: 0,
    },
    randomUUID,
    "2026-11-17T12:00:00Z",
  );
  validateSelectorTree(assigned.rules[0].selectorTree);
  assert.equal(
    assigned.rules[0].selectorTree.selector.uuid,
    candidateVersion.selectorUuid,
  );
  assert.equal(assigned.rules[0].extraction.selectorVersion, undefined);
  const active = structuredClone(assigned.rules[0].selectorTree.versions[0]);
  const recapture = structuredClone(captured);
  recapture.extraction.selectorVersion = {
    ...candidateVersion,
    uuid: randomUUID(),
  };
  // Fresh capture has new identifiers for every entity.
  for (const recipe of recapture.extraction.selectorVersion.recipes) {
    recipe.uuid = randomUUID();
    for (const part of recipe.parts) {
      part.uuid = randomUUID();
      for (const locator of part.locators) locator.uuid = randomUUID();
    }
  }
  const next = BurbotCore.mutate(
    assigned,
    {
      op: "ASSIGN",
      objectId: "R_42",
      field: "name",
      candidate: recapture,
      expectedRevision: assigned.revision,
    },
    randomUUID,
    "2026-11-17T13:00:00Z",
  );
  assert.equal(next.rules[0].id, assigned.rules[0].id);
  assert.deepEqual(next.rules[0].selectorTree.versions[0], active);
  assert.equal(next.rules[0].selectorTree.versions[1].status, "draft");
  validateSelectorTree(next.rules[0].selectorTree);
});

test("new rule execution uses the active tree and returns separate diagnostics", () => {
  const rule = legacy();
  migrateRuleSelector(rule);
  const result = runtime.runExtractionRules([rule], {
    pageUrl: rule.pageUrl,
    selectAll: () => [],
    readElement: () => "unused",
    selectorRuntime: runtimeWith({ "#funding": "80%", ".funding": "85%" }),
  });
  assert.match(result[0].error, /conflict/);
  assert.equal(result[0].raw, undefined);
  assert.equal(result[0].evaluation.status, "conflict");
  assert.equal(rule.selectorTree.versions.length, 1);
});
