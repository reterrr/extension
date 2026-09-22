import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let normalize;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-draft-revision-"));
  await build({
    absWorkingDir: root,
    entryPoints: { normalize: "src/shared/commits/normalize.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  normalize = await import(pathToFileURL(join(outputDir, "normalize.js")).href);
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function state(revision) {
  return {
    version: 1,
    revision,
    objects: [],
    rules: [],
  };
}

test("staged writes keep working state on the commit base revision", () => {
  const draft = {
    id: "commit-1",
    createdAt: "2026-09-16T15:00:00.000Z",
    updatedAt: "2026-09-16T15:01:00.000Z",
    baseRevision: 4,
    baseState: state(4),
    workingState: state(11),
  };

  const result = normalize.normalizeDraftWorkingRevision(draft);
  assert.equal(result.workingState.revision, 4);
  assert.equal(result.baseRevision, 4);
  assert.deepEqual(result.stagedObjectIds, []);
  assert.equal(result, draft);
});

test("legacy single refund percent becomes a min/avg/max funding range", () => {
  const workingState = {
    ...state(11),
    financingRules: [
      {
        id: "funding-1",
        objectId: "project-1",
        company_size: "SMALL",
        variant_no: 1,
        refund_percent: 60,
      },
    ],
    rules: [
      {
        id: "rule-refund",
        objectId: "project-1",
        field: "refund_percent",
        pageUrl: "https://example.test/project",
        selector: null,
        extraction: { type: "pageUrl" },
        target: { kind: "funding", id: "funding-1" },
      },
    ],
  };
  const draft = {
    id: "commit-legacy",
    createdAt: "2026-09-16T15:00:00.000Z",
    updatedAt: "2026-09-16T15:01:00.000Z",
    baseRevision: 4,
    baseState: state(4),
    workingState,
  };

  normalize.normalizeDraftWorkingRevision(draft);

  const funding = draft.workingState.financingRules[0];
  assert.equal(funding.refund_percent_min, 60);
  assert.equal(funding.refund_percent_avg, 60);
  assert.equal(funding.refund_percent_max, 60);
  assert.equal("refund_percent" in funding, false);
  assert.deepEqual(
    draft.workingState.rules.map((rule) => rule.field).sort(),
    ["refund_percent_avg", "refund_percent_max", "refund_percent_min"],
  );
  assert.equal(new Set(draft.workingState.rules.map((rule) => rule.id)).size, 3);
  assert.equal(draft.workingState.revision, 4);
});
