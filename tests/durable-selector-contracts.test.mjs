import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
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
  outputDir = await mkdtemp(join(tmpdir(), "burbot-durable-selectors-"));
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

const pageUrl = "https://example.test/project";

const candidate = {
  pageUrl,
  selector: "#project-number",
  selectorFallbacks: [
    "[data-testid=project-number]",
    "#project-details .project-number",
  ],
  options: [],
};

const option = {
  label: "Element text",
  raw: "FEPK.07.09-IP.01-0014/23-00",
  extraction: { type: "text" },
};

test("created DOM rules retain ordered selector fallbacks", () => {
  assert.deepEqual(rulesModule.createExtractionRule(candidate, option), {
    pageUrl,
    selector: "#project-number",
    selectorFallbacks: [
      "[data-testid=project-number]",
      "#project-details .project-number",
    ],
    extraction: { type: "text" },
  });
});

test("captured input mirrors fallbacks into extraction metadata for legacy persistence", () => {
  const captured = rulesModule.createCapturedExtractionInput(candidate, option);
  assert.deepEqual(captured.selectorFallbacks, candidate.selectorFallbacks);
  assert.deepEqual(
    captured.extraction.selectorFallbacks,
    candidate.selectorFallbacks,
  );
});

test("runner uses the first unique durable fallback when the primary selector disappears", () => {
  const marker = { id: "correct" };
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-fallback",
        pageUrl,
        selector: "#old-project-number",
        selectorFallbacks: ["[data-testid=project-number]"],
        extraction: { type: "text" },
      },
    ],
    {
      pageUrl,
      selectAll: (selector) =>
        selector === "[data-testid=project-number]" ? [marker] : [],
      readElement: (element) => {
        assert.equal(element, marker);
        return "FEPK.07.09-IP.01-0014/23-00";
      },
    },
  );

  assert.deepEqual(results, [
    {
      ruleId: "rule-fallback",
      raw: "FEPK.07.09-IP.01-0014/23-00",
    },
  ]);
});

test("runner recovers fallbacks mirrored inside extraction metadata", () => {
  const marker = { id: "persisted" };
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-persisted",
        pageUrl,
        selector: "#old-selector",
        extraction: {
          type: "text",
          selectorFallbacks: ["[itemprop=identifier]"],
        },
      },
    ],
    {
      pageUrl,
      selectAll: (selector) =>
        selector === "[itemprop=identifier]" ? [marker] : [],
      readElement: () => "GK-3.0",
    },
  );

  assert.deepEqual(results, [{ ruleId: "rule-persisted", raw: "GK-3.0" }]);
});

test("ambiguous primary selector does not block a unique fallback", () => {
  const correct = { id: "correct" };
  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-ambiguous",
        pageUrl,
        selector: ".project-number",
        selectorFallbacks: ["[data-qa=project-number]"],
        extraction: { type: "text" },
      },
    ],
    {
      pageUrl,
      selectAll: (selector) =>
        selector === ".project-number"
          ? [{}, {}]
          : selector === "[data-qa=project-number]"
            ? [correct]
            : [],
      readElement: (element) => {
        assert.equal(element, correct);
        return "stable";
      },
    },
  );

  assert.deepEqual(results, [{ ruleId: "rule-ambiguous", raw: "stable" }]);
});

test("selection quote survives a complete DOM wrapper change", () => {
  const extraction = {
    type: "selection",
    quote: {
      exact: "FEPK.07.09-IP.01-0014/23-00",
      prefix: "numer ",
      suffix: " z dnia",
    },
  };
  let globalFallbackCalled = false;

  const results = runnerModule.runExtractionRules(
    [
      {
        id: "rule-selection-global",
        pageUrl,
        selector: "#old-wrapper > span:nth-of-type(2)",
        selectorFallbacks: ["#also-gone"],
        extraction,
      },
    ],
    {
      pageUrl,
      selectAll: () => [],
      readElement: () => {
        throw new Error("should not read a missing element");
      },
      readSelectionFromPage: (received) => {
        globalFallbackCalled = true;
        assert.deepEqual(received, extraction);
        return "FEPK.07.09-IP.01-0014/23-00";
      },
    },
  );

  assert.equal(globalFallbackCalled, true);
  assert.deepEqual(results, [
    {
      ruleId: "rule-selection-global",
      raw: "FEPK.07.09-IP.01-0014/23-00",
    },
  ]);
});


test("repeated class-based DOM blocks keep a structural nth-of-type fallback", () => {
  const durableSelector = readFileSync(
    resolve(root, "src/content/durable-selector.ts"),
    "utf8",
  );
  assert.match(
    durableSelector,
    /const sameShape = classes\.length[\s\S]*?sameTag\.filter[\s\S]*?sameShape\.length > 1[\s\S]*?:nth-of-type/,
  );
});

test("selected text has a quote-only fallback when CSS cannot be unique", () => {
  const picker = readFileSync(resolve(root, "src/content/picker.ts"), "utf8");
  assert.match(
    picker,
    /if \(!range\) throw error;[\s\S]*?primary: "body"[\s\S]*?quoteOnly = true/,
  );
  assert.match(
    picker,
    /if \(!quoteOnly && full\)[\s\S]*?if \(!quoteOnly\) \{/,
  );
});
