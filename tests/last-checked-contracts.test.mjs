import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let stampLastCheckedAt;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-last-checked-"));
  await build({
    absWorkingDir: root,
    entryPoints: { lastChecked: "src/shared/commits/lastChecked.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  ({ stampLastCheckedAt } = await import(
    pathToFileURL(join(outputDir, "lastChecked.js")).href
  ));
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

function baseState() {
  return {
    version: 1,
    revision: 4,
    objects: [
      {
        id: "project-1",
        type: "project",
        values: {
          name: "Project A",
          status: "AKTYWNY",
          last_checked_at: "2026-09-01T08:00:00.000Z",
        },
      },
      {
        id: "recruitment-1",
        type: "recruitment",
        values: {
          external_number: "1/2026",
          continuous: false,
          last_checked_at: "2026-09-02T08:00:00.000Z",
        },
      },
    ],
    rules: [],
    geographies: [],
    fileSources: [],
    financingRules: [],
    documentRequirements: [],
  };
}

test("commit stamps only changed objects", () => {
  const base = baseState();
  const working = structuredClone(base);
  working.objects[1].values.continuous = true;

  const result = stampLastCheckedAt(
    base,
    working,
    "2026-09-18T10:30:00+02:00",
  );

  assert.equal(
    result.objects[0].values.last_checked_at,
    "2026-09-01T08:00:00.000Z",
  );
  assert.equal(
    result.objects[1].values.last_checked_at,
    "2026-09-18T08:30:00.000Z",
  );
});

test("related configuration changes also mark the owning object as checked", () => {
  const base = baseState();
  const working = structuredClone(base);
  working.financingRules.push({
    id: "funding-1",
    objectId: "project-1",
    company_size: "SMALL",
    variant_no: 1,
  });

  const result = stampLastCheckedAt(base, working, "2026-09-18T11:00:00Z");
  assert.equal(
    result.objects[0].values.last_checked_at,
    "2026-09-18T11:00:00.000Z",
  );
  assert.equal(
    result.objects[1].values.last_checked_at,
    "2026-09-02T08:00:00.000Z",
  );
});

test("new objects receive last_checked_at on their first commit", () => {
  const base = baseState();
  const working = structuredClone(base);
  working.objects.push({
    id: "operator-1",
    type: "operator",
    values: { name: "Operator" },
  });

  const result = stampLastCheckedAt(base, working, "2026-09-18T12:00:00Z");
  assert.equal(
    result.objects[2].values.last_checked_at,
    "2026-09-18T12:00:00.000Z",
  );
});
