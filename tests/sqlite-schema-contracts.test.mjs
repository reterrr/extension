import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const schema = readFileSync(resolve(root, "scripts/db/schema.sql"), "utf8");

function openMemoryDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  return db;
}

test("SQLite schema creates typed business and provenance tables", () => {
  const db = openMemoryDb();
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  );

  for (const table of [
    "workspace_state",
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

  const projectColumns = new Set(
    db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name),
  );
  assert.ok(projectColumns.has("refund_percent_min"));
  assert.ok(projectColumns.has("refund_percent_max"));
  assert.equal(projectColumns.has("operator_id"), false);

  const recruitmentColumns = new Set(
    db.prepare("PRAGMA table_info(recruitments)").all().map((row) => row.name),
  );
  assert.ok(recruitmentColumns.has("refund_percent_min"));
  assert.ok(recruitmentColumns.has("refund_percent_max"));

  assert.equal(db.pragma("user_version", { simple: true }), 2);
  db.close();
});

test("typed project row can share stable numeric id with workspace object", () => {
  const db = openMemoryDb();
  db.prepare(
    "INSERT INTO workspace_objects(object_id, object_type, values_json) VALUES (?, ?, ?)",
  ).run("project-uuid", "project", "{}");

  const { db_id: id } = db
    .prepare("SELECT db_id FROM workspace_objects WHERE object_id = ?")
    .get("project-uuid");

  db.prepare(
    `INSERT INTO projects(
       id, object_id, name, status, refund_percent_min, refund_percent_max
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "project-uuid",
    "Generator Kompetencji 3.0",
    "AKTYWNY",
    50,
    80,
  );

  const row = db
    .prepare(
      "SELECT id, name, status, refund_percent_min, refund_percent_max FROM projects",
    )
    .get();
  assert.deepEqual(row, {
    id,
    name: "Generator Kompetencji 3.0",
    status: "AKTYWNY",
    refund_percent_min: 50,
    refund_percent_max: 80,
  });
  db.close();
});
