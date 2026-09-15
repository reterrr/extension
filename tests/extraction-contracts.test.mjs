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

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-extraction-"));

  await build({
    absWorkingDir: root,
    entryPoints: {
      rules: "src/shared/extraction/rules.ts",
      runner: "src/content/extraction-runner.ts",
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
