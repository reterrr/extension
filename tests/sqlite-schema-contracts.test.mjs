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

  assert.equal(db.pragma("user_version", { simple: true }), 1);
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
    "INSERT INTO projects(id, object_id, name, status) VALUES (?, ?, ?, ?)",
  ).run(id, "project-uuid", "Generator Kompetencji 3.0", "AKTYWNY");

  const row = db.prepare("SELECT id, name, status FROM projects").get();
  assert.deepEqual(row, {
    id,
    name: "Generator Kompetencji 3.0",
    status: "AKTYWNY",
  });
  db.close();
});
