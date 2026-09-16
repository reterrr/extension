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
  assert.equal(result, draft);
});
