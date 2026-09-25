import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let rulesModule;
let runnerModule;
let importModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-extraction-"));

  await build({
    absWorkingDir: root,
    entryPoints: {
      rules: "src/shared/extraction/rules.ts",
      runner: "src/content/extraction-runner.ts",
      schema: "src/shared/domain/schema.js",
      core: "src/shared/domain/core.js",
      format: "src/shared/import/format.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  rulesModule = await import(pathToFileURL(join(outputDir, "rules.js")).href);
  runnerModule = await import(pathToFileURL(join(outputDir, "runner.js")).href);
  await import(pathToFileURL(join(outputDir, "schema.js")).href);
  await import(pathToFileURL(join(outputDir, "core.js")).href);
  importModule = await import(pathToFileURL(join(outputDir, "format.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

const candidate = {
  pageUrl: "https://example.test/recruitment",
  selector: "#details",
  options: [],
};

test("candidate text option becomes a durable rule", () => {
  const option = {
    label: "Element text",
    raw: "Generator Kompetencji 3.0",
    extraction: { type: "text" },
  };

  assert.deepEqual(rulesModule.createExtractionRule(candidate, option), {
    pageUrl: candidate.pageUrl,
    selector: candidate.selector,
    extraction: { type: "text" },
  });
});

test("candidate attribute option preserves href extraction", () => {
  const option = {
    label: "Attribute: href",
    raw: "https://example.test/download.pdf",
    extraction: { type: "attribute", attribute: "href" },
  };

  assert.deepEqual(rulesModule.createExtractionRule(candidate, option), {
    pageUrl: candidate.pageUrl,
    selector: candidate.selector,
    extraction: { type: "attribute", attribute: "href" },
  });
});

test("candidate selection option preserves quote semantics", () => {
  const quote = {
    exact: "21.09.2026",
    prefix: "Nabór od ",
    suffix: " do wyczerpania środków",
  };
  const option = {
    label: "Selected text",
    raw: quote.exact,
    extraction: { type: "selection", quote },
  };

  assert.deepEqual(rulesModule.createExtractionRule(candidate, option), {
    pageUrl: candidate.pageUrl,
    selector: candidate.selector,
    extraction: { type: "selection", quote },
  });
});

test("boundary text selection stays bounded to the exact quote", () => {
  const source = "Prefix Selected value suffix";
  assert.equal(
    BurbotCore.selectedText(source, {
      exact: "Selected value",
      prefix: "",
      suffix: " suffix",
    }),
    "Selected value",
  );
});

test("boundary text selection rejects ambiguous exact text", () => {
  assert.throws(
    () =>
      BurbotCore.selectedText("Same value and Same value", {
        exact: "Same value",
        prefix: "",
        suffix: "",
      }),
    /ambiguous/,
  );
});

test("page URL rule has no DOM selector", () => {
  const pageCandidate = rulesModule.createPageUrlCandidate(candidate.pageUrl);
  const rule = rulesModule.createExtractionRule(
    pageCandidate,
    pageCandidate.options[0],
  );

  assert.deepEqual(rule, {
    pageUrl: candidate.pageUrl,
    selector: null,
    extraction: { type: "pageUrl" },
  });
});

test("RUN returns raw for a successful rule", () => {
  const marker = {};
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-1",
        pageUrl: candidate.pageUrl,
        selector: candidate.selector,
        extraction: { type: "text" },
      },
    ],
    {
      pageUrl: candidate.pageUrl,
      selectAll: () => [marker],
      readElement: (element) => {
        assert.equal(element, marker);
        return "Captured value";
      },
    },
  );

  assert.deepEqual(results, [{ ruleId: "rule-1", raw: "Captured value" }]);
});

test("RUN returns an error for a failed selector", () => {
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-2",
        pageUrl: candidate.pageUrl,
        selector: ".missing",
        extraction: { type: "text" },
      },
    ],
    {
      pageUrl: candidate.pageUrl,
      selectAll: () => [],
      readElement: () => "unused",
    },
  );

  assert.deepEqual(results, [
    { ruleId: "rule-2", error: "Selector matched 0 elements." },
  ]);
});

test("RUN executes page URL rules without selecting the DOM", () => {
  let selected = false;
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-url",
        pageUrl: candidate.pageUrl,
        selector: null,
        extraction: { type: "pageUrl" },
      },
    ],
    {
      pageUrl: candidate.pageUrl,
      selectAll: () => {
        selected = true;
        return [];
      },
      readElement: () => "unused",
    },
  );

  assert.equal(selected, false);
  assert.deepEqual(results, [{ ruleId: "rule-url", raw: candidate.pageUrl }]);
});

test("import creates objects, resolves references and keeps evidence out of rules", () => {
  let id = 0;
  const sourceText = "🚀 Generator Kompetencji 3.0 — Nabór 3/2026";
  const projectText = "Generator Kompetencji 3.0";
  const recruitmentText = "Nabór 3/2026";
  const projectStart = Array.from(sourceText).indexOf("G");
  const recruitmentStart = Array.from(sourceText).indexOf("N");
  const next = importModule.importDocumentIntoState(
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
      ],
      objects: [
        {
          key: "project-1",
          type: "project",
          data: { name: projectText, type: "B2B", status: "ACTIVE" },
          evidence: {
            name: [
              {
                source: "page",
                char_start: projectStart,
                char_end: projectStart + Array.from(projectText).length,
                raw_value: projectText,
              },
            ],
          },
        },
        {
          key: "recruitment-1",
          type: "recruitment",
          data: {
            external_number: recruitmentText,
            project_id: { $ref: "project-1" },
          },
          evidence: {
            external_number: [
              {
                source: "page",
                char_start: recruitmentStart,
                char_end: recruitmentStart + Array.from(recruitmentText).length,
                raw_value: recruitmentText,
              },
            ],
          },
        },
      ],
    },
    0,
    () => `id-${++id}`,
    "2026-09-16T08:00:00.000Z",
  );

  assert.equal(next.revision, 1);
  assert.equal(next.objects.length, 2);
  assert.equal(next.rules.length, 0);
  assert.equal(next.objects[1].values.project_id, next.objects[0].id);
  assert.equal(next.objects[0].evidence.name[0].rawValue, projectText);
  assert.equal(next.importSources[0].snapshot.text, sourceText);
});

test("import rejects evidence whose range does not match raw_value", () => {
  assert.throws(
    () =>
      importModule.importDocumentIntoState(
        BurbotCore.empty(),
        {
          version: 1,
          offset_unit: "unicode_codepoint",
          sources: [
            {
              key: "page",
              type: "HTML",
              snapshot: { text: "ABC" },
            },
          ],
          objects: [
            {
              key: "operator-1",
              type: "operator",
              data: { name: "ABC" },
              evidence: {
                name: [
                  {
                    source: "page",
                    char_start: 0,
                    char_end: 2,
                    raw_value: "ABC",
                  },
                ],
              },
            },
          ],
        },
        0,
        () => "id",
        "2026-09-16T08:00:00.000Z",
      ),
    /Evidence mismatch/,
  );
});


test("new recruitment starts without an assumed status and status can be cleared", () => {
  let id = 0;
  const uuid = () => "id-" + ++id;
  const now = "2026-09-23T16:00:00.000Z";

  let state = BurbotCore.mutate(
    BurbotCore.empty(),
    {
      op: "CREATE_FROM_SELECTION",
      objectType: "recruitment",
      initialValue: "Nabór testowy",
      sourceUrl: "https://example.test/recruitment",
      expectedRevision: 0,
    },
    uuid,
    now,
  );

  const recruitment = state.objects[0];
  assert.equal("status" in recruitment.values, false);

  state = BurbotCore.mutate(
    state,
    {
      op: "EDIT",
      objectId: recruitment.id,
      field: "status",
      target: { kind: "object" },
      value: "AKTYWNY",
      expectedRevision: state.revision,
    },
    uuid,
    now,
  );
  assert.equal(state.objects[0].values.status, "AKTYWNY");

  state = BurbotCore.mutate(
    state,
    {
      op: "EDIT",
      objectId: recruitment.id,
      field: "status",
      target: { kind: "object" },
      value: "",
      expectedRevision: state.revision,
    },
    uuid,
    now,
  );
  assert.equal("status" in state.objects[0].values, false);
});
