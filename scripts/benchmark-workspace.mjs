// Run against this checkout, or pass a baseline checkout as the first argument.
// Timings are diagnostic medians, never CI thresholds.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const directory = await mkdtemp(join(tmpdir(), "burbot-benchmark-"));
try {
  await build({
    absWorkingDir: root,
    entryPoints: {
      schema: "src/shared/domain/schema.js",
      geography: "src/shared/domain/geographyRuntime.ts",
      core: "src/shared/domain/core.js",
      review: "src/shared/commits/review.ts",
      session: "src/shared/commits/session.ts",
      stage: "src/shared/import/stageReview.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: directory,
    logLevel: "silent",
  });
  const modules = {};
  for (const name of [
    "schema",
    "geography",
    "core",
    "review",
    "session",
    "stage",
  ])
    modules[name] = await import(pathToFileURL(join(directory, `${name}.js`)));
  const base = BurbotCore.empty();
  for (let i = 0; i < 150; i++) {
    const objectId = `project-${i}`;
    base.objects.push({
      id: objectId,
      type: "project",
      importKey: objectId,
      values: {
        name: `Projekt ${i}`,
        ...Object.fromEntries(
          Array.from({ length: 12 }, (_, j) => [`field-${j}`, `Wartość ${j}`]),
        ),
      },
    });
    for (let j = 0; j < 12; j++) {
      (base.fileSources ??= []).push({
        id: `file-${i}-${j}`,
        objectId,
        name: "Regulamin",
        url: `https://example.test/${i}/${j}.pdf`,
      });
      (base.financingRules ??= []).push({
        id: `funding-${i}-${j}`,
        objectId,
        company_size: "MIKRO",
        variant_no: j + 1,
        refund_percent_max: 80,
      });
    }
  }
  base.importSources = [
    {
      id: "source",
      importKey: "source",
      type: "PDF",
      snapshot: { text: "Treść regulaminu i załączników. ".repeat(150_000) },
    },
  ];
  const working = structuredClone(base);
  for (const object of working.objects) object.values.name += " — aktualizacja";
  for (const row of working.fileSources.filter((_, i) => i % 12 === 0))
    row.name = "Nowy regulamin";
  const draft = {
    id: "benchmark",
    baseRevision: 0,
    baseState: base,
    workingState: working,
    reviewVersion: 1,
    stagedObjectIds: [],
    reviewDecisions: {},
    discardedChanges: {},
  };
  const results = {
    objects: base.objects.length,
    changes: modules.review.reviewChanges(draft).length,
  };
  function measure(name, action, runs = 5) {
    action(); // Warm up the code path.
    const times = Array.from({ length: runs }, () => {
      const start = performance.now();
      action();
      return performance.now() - start;
    }).sort((a, b) => a - b);
    results[name] = Number(times[Math.floor(times.length / 2)].toFixed(2));
  }
  if (!process.argv.includes("--imports-only")) {
    measure("review_ms", () => modules.review.reviewChanges(draft));
    measure("session_ms", () => modules.session.commitSessionView(draft));
    measure(
      "select_all_ms",
      () => {
        if (modules.review.decideAllReviewChanges)
          modules.review.decideAllReviewChanges(draft, "save");
        else
          for (const item of modules.review.reviewItems(draft))
            modules.review.decideReviewChange(
              draft,
              item.id,
              "save",
              item.fingerprint,
            );
      },
      3,
    );
  }
  let id = 0;
  const plan = {
    document: {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [],
      objects: [
        { key: "project-0", type: "project", data: { name: "Aktualizacja" } },
      ],
    },
    selectedImportKey: "project-0",
    existingTargetObjectId: "project-0",
    selectedDataFields: ["name"],
    financingFieldsByImportKey: {},
    referencePatches: [],
    operatorReferencePatches: [],
    existingReferenceLinks: [],
    temporaryDependencyImportKeys: [],
  };
  measure("approve_existing_ms", () =>
    modules.stage.stageImportReviewObject(
      base,
      plan,
      () => `new-${++id}`,
      "2026-10-01T10:00:00.000Z",
    ),
  );
  const newPlan = {
    ...plan,
    selectedImportKey: "new-call",
    existingTargetObjectId: undefined,
    document: {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources: [],
      objects: [
        {
          key: "temporary-project",
          type: "project",
          data: { name: "Projekt" },
        },
        {
          key: "new-call",
          type: "recruitment",
          data: {
            external_number: "Nabór",
            project_id: { $ref: "temporary-project" },
          },
        },
      ],
    },
    referencePatches: [{ field: "project_id", targetObjectId: "project-0" }],
    temporaryDependencyImportKeys: ["temporary-project"],
  };
  measure("approve_new_ms", () =>
    modules.stage.stageImportReviewObject(
      base,
      newPlan,
      () => `new-${++id}`,
      "2026-10-01T10:00:00.000Z",
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
