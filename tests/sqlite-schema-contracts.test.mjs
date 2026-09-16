import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import initSqlJs from "sql.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let schema;
let SQL;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-sqlite-schema-"));
  await build({
    absWorkingDir: root,
    entryPoints: { schema: "src/shared/sqlite/schema.ts" },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  schema = await import(pathToFileURL(join(outputDir, "schema.js")).href);
  SQL = await initSqlJs();
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("SQLite schema creates typed business and provenance tables", () => {
  const db = new SQL.Database();
  db.exec(schema.SQLITE_SCHEMA_V1);

  const tables = new Set(
    db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map(
      ([name]) => name,
    ),
  );

  for (const table of [
    "workspace_objects",
    "projects",
    "operators",
    "recruitments",
    "projects_operators",
    "geography_groups",
    "geographies",
    "extraction_rules",
    "file_sources",
    "import_sources",
    "financing_rules",
    "document_requirements",
  ]) {
    assert.ok(tables.has(table), `missing table ${table}`);
  }

  assert.equal(db.exec("PRAGMA user_version")[0].values[0][0], 1);
  db.close();
});

test("typed project row can share stable numeric id with workspace object", () => {
  const db = new SQL.Database();
  db.exec(schema.SQLITE_SCHEMA_V1);
  db.run(
    "INSERT INTO workspace_objects(object_id, object_type, values_json) VALUES (?, ?, ?)",
    ["project-uuid", "project", "{}"],
  );
  const id = db.exec("SELECT db_id FROM workspace_objects WHERE object_id='project-uuid'")[0]
    .values[0][0];
  db.run(
    "INSERT INTO projects(id, object_id, name, status) VALUES (?, ?, ?, ?)",
    [id, "project-uuid", "Generator Kompetencji 3.0", "AKTYWNY"],
  );

  const row = db.exec("SELECT id, name, status FROM projects")[0].values[0];
  assert.deepEqual(row, [id, "Generator Kompetencji 3.0", "AKTYWNY"]);
  db.close();
});
