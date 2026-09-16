import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let selectors;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-pdf-selector-"));
  await build({
    absWorkingDir: root,
    entryPoints: { selectors: "src/shared/pdf/textSelector.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  selectors = await import(pathToFileURL(join(outputDir, "selectors.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("PDF selector stores page number plus exact/prefix/suffix quote", () => {
  const text = "Dofinansowanie wynosi maksymalnie 80% wartości usługi.";
  const start = text.indexOf("80%");
  const candidate = selectors.createPdfTextCandidate(
    "source-1",
    "https://projekt.test/regulamin.pdf",
    7,
    text,
    start,
    start + 3,
  );

  assert.equal(candidate.selector, null);
  assert.equal(candidate.options[0].raw, "80%");
  assert.deepEqual(candidate.options[0].extraction, {
    type: "pdfText",
    sourceId: "source-1",
    selector: {
      pageNumber: 7,
      quote: {
        exact: "80%",
        prefix: "Dofinansowanie wynosi maksymalnie ",
        suffix: " wartości usługi.",
      },
    },
  });
});

test("PDF selector resolves the same value from canonical page text", () => {
  const text = "Nabór rozpoczyna się 16.06.2026 i kończy 25.06.2026.";
  const start = text.indexOf("16.06.2026");
  const selector = selectors.buildPdfSelectionQuote(
    text,
    start,
    start + "16.06.2026".length,
  );

  assert.equal(
    selectors.resolvePdfTextSelector(text, {
      pageNumber: 2,
      quote: selector,
    }),
    "16.06.2026",
  );
});

test("ambiguous PDF selections are rejected before rule persistence", () => {
  const text = "Limit: 80%. Inny limit: 80%.";
  const first = text.indexOf("80%");

  assert.throws(
    () =>
      selectors.createPdfTextCandidate(
        "source-1",
        "https://projekt.test/regulamin.pdf",
        1,
        text,
        first,
        first + 3,
      ),
    /ambiguous/i,
  );
});

test("PDF selector normalizes page text deterministically", () => {
  assert.equal(
    selectors.normalizePdfPageText("A   B\r\nC\tD  \n E"),
    "A B\nC D\n E",
  );
});
