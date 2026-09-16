import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let assignModule;
let selectorModule;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-pdf-assignment-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      core: "src/shared/domain/core.js",
      assign: "src/shared/pdf/assignPdfRule.ts",
      selector: "src/shared/pdf/textSelector.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });

  await import(pathToFileURL(join(outputDir, "schema.js")).href);
  await import(pathToFileURL(join(outputDir, "core.js")).href);
  assignModule = await import(pathToFileURL(join(outputDir, "assign.js")).href);
  selectorModule = await import(pathToFileURL(join(outputDir, "selector.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function fixture() {
  let id = 0;
  const uuid = () => `id-${++id}`;
  const state = BurbotCore.mutate(
    BurbotCore.empty(),
    {
      op: "CREATE_FROM_SELECTION",
      expectedRevision: 0,
      objectType: "project",
      initialValue: "Generator Kompetencji 3.0",
      sourceUrl: "https://projekt.test/project",
    },
    uuid,
    "2026-09-16T12:00:00.000Z",
  );
  const object = state.objects[0];
  state.fileSources = [
    {
      id: "pdf-1",
      objectId: object.id,
      fileType: "PDF",
      url: "https://projekt.test/regulamin.pdf",
      sourcePageUrl: "https://projekt.test/project",
      name: "regulamin.pdf",
      addedAt: "2026-09-16T12:01:00.000Z",
    },
  ];
  return { state, object, uuid };
}

function capturedCandidate(sourceId = "pdf-1", url = "https://projekt.test/regulamin.pdf") {
  const text = "Numer projektu: FEPK.07.09-IP.01-0014/23-00";
  const value = "FEPK.07.09-IP.01-0014/23-00";
  const start = text.indexOf(value);
  const candidate = selectorModule.createPdfTextCandidate(
    sourceId,
    url,
    3,
    text,
    start,
    start + value.length,
  );
  return {
    pageUrl: candidate.pageUrl,
    selector: null,
    extraction: candidate.options[0].extraction,
    raw: candidate.options[0].raw,
  };
}

test("PDF rule assigns a typed object field and stores source selector", () => {
  const { state, object, uuid } = fixture();
  const next = assignModule.assignPdfRuleIntoState(
    state,
    {
      op: "ASSIGN_PDF",
      expectedRevision: state.revision,
      objectId: object.id,
      field: "number",
      candidate: capturedCandidate(),
    },
    uuid,
    "2026-09-16T12:02:00.000Z",
  );

  assert.equal(next.objects[0].values.number, "FEPK.07.09-IP.01-0014/23-00");
  assert.equal(next.rules.length, 1);
  assert.equal(next.rules[0].selector, null);
  assert.equal(next.rules[0].extraction.type, "pdfText");
  assert.equal(next.rules[0].extraction.sourceId, "pdf-1");
  assert.equal(next.rules[0].extraction.selector.pageNumber, 3);
});

test("PDF rule cannot point at an unowned or mismatched source", () => {
  const { state, object, uuid } = fixture();

  assert.throws(
    () =>
      assignModule.assignPdfRuleIntoState(
        state,
        {
          op: "ASSIGN_PDF",
          expectedRevision: state.revision,
          objectId: object.id,
          field: "number",
          candidate: capturedCandidate("pdf-other"),
        },
        uuid,
        "2026-09-16T12:02:00.000Z",
      ),
    /source no longer exists/i,
  );
});
