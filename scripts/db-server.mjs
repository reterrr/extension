import "dotenv/config";

import Database from "better-sqlite3";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.BURBOT_DB_HOST || "127.0.0.1";
const PORT = Number(process.env.BURBOT_DB_PORT || "8765");
const DATABASE_PATH = resolve(
  ROOT,
  process.env.BURBOT_DB_PATH || "./data/burbot.sqlite",
);
const SCHEMA_PATH = resolve(ROOT, "scripts/db/schema.sql");
const MAX_BODY_BYTES = 32 * 1024 * 1024;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("BURBOT_DB_PORT must be a valid TCP port.");
}

mkdirSync(dirname(DATABASE_PATH), { recursive: true });

const db = new Database(DATABASE_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.exec(readFileSync(SCHEMA_PATH, "utf8"));

function ensureColumn(table, column, definition) {
  const columns = new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name)),
  );
  if (!columns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// CREATE TABLE IF NOT EXISTS does not evolve an existing local database. Keep
// the typed materialization compatible with databases created by schema v1.
ensureColumn("projects", "refund_percent_min", "REAL");
ensureColumn("projects", "refund_percent_max", "REAL");
ensureColumn("recruitments", "refund_percent_min", "REAL");
ensureColumn("recruitments", "refund_percent_max", "REAL");
ensureColumn("workspace_objects", "last_checked_at", "TEXT");
ensureColumn("projects", "documents_url", "TEXT");
ensureColumn("projects", "documents_link_direct", "INTEGER");
ensureColumn("projects", "notes", "TEXT");
ensureColumn("projects", "schedule_note", "TEXT");
ensureColumn("projects", "technical_notes", "TEXT");
ensureColumn("projects", "last_checked_at", "TEXT");
ensureColumn("operators", "role", "TEXT");
ensureColumn("operators", "address", "TEXT");
ensureColumn("operators", "website", "TEXT");
ensureColumn("operators", "notes", "TEXT");
ensureColumn("operators", "last_checked_at", "TEXT");
ensureColumn("recruitments", "last_checked_at", "TEXT");
ensureColumn("recruitments", "continuous", "INTEGER");
ensureColumn("recruitments", "operator_id", "INTEGER");
ensureColumn("recruitments", "source_number", "TEXT");
ensureColumn("recruitments", "planned_start_date", "TEXT");
ensureColumn("recruitments", "planned_end_date", "TEXT");
ensureColumn("recruitments", "action_code", "TEXT");
ensureColumn("recruitments", "documents_url", "TEXT");
ensureColumn("recruitments", "data_source_url", "TEXT");
ensureColumn("recruitments", "direct_recruitment_link", "INTEGER");
ensureColumn("recruitments", "notes", "TEXT");
ensureColumn("recruitments", "funding_rules", "TEXT");
ensureColumn("recruitments", "funding_verified_at", "TEXT");
ensureColumn("recruitments", "funding_verification_url", "TEXT");
db.pragma("user_version = 6");

db.prepare(
  `INSERT INTO app_meta(key, value) VALUES ('schema_version', '6')
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
).run();

function assertState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !Number.isInteger(value.revision) ||
    !Array.isArray(value.objects) ||
    !Array.isArray(value.rules)
  ) {
    throw new Error("Invalid Burbot workspace state.");
  }
}

function nullableText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function nullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function geographyTable(type) {
  switch (type) {
    case "POLSKA":
      return "polska_objects";
    case "WOJEWODZTWO":
      return "wojewodztwo_objects";
    case "PODREGION":
      return "podregion_objects";
    case "POWIAT":
      return "powiat_objects";
    case "GMINA":
      return "gmina_objects";
    case "MIASTO_NA_PRAWACH_POWIATU":
      return "miasto_na_prawach_powiatu_objects";
    default:
      throw new Error(`Unsupported geography type: ${String(type)}.`);
  }
}

function clearMaterializedTables() {
  db.exec(`
    DELETE FROM projects_operators;
    DELETE FROM operator_contacts;
    DELETE FROM recruitments;
    DELETE FROM projects;
    DELETE FROM operators;
    DELETE FROM geographies;
    DELETE FROM geography_groups;
    DELETE FROM extraction_rules;
    DELETE FROM field_evidence;
    DELETE FROM file_sources;
    DELETE FROM import_sources;
    DELETE FROM financing_rules;
    DELETE FROM document_requirements;
  `);
}

const upsertWorkspaceObject = db.prepare(`
  INSERT INTO workspace_objects(
    object_id, object_type, label, source_url, creation_note,
    created_at, updated_at, last_checked_at, import_key,
    values_json, evidence_json, manual_fields_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(object_id) DO UPDATE SET
    object_type = excluded.object_type,
    label = excluded.label,
    source_url = excluded.source_url,
    creation_note = excluded.creation_note,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    last_checked_at = excluded.last_checked_at,
    import_key = excluded.import_key,
    values_json = excluded.values_json,
    evidence_json = excluded.evidence_json,
    manual_fields_json = excluded.manual_fields_json
`);

const deleteWorkspaceObject = db.prepare(
  "DELETE FROM workspace_objects WHERE object_id = ?",
);

const selectWorkspaceObjectId = db.prepare(
  "SELECT db_id FROM workspace_objects WHERE object_id = ?",
);

function syncWorkspaceObjects(state) {
  const wanted = new Set(state.objects.map((object) => String(object.id)));
  const existing = db.prepare("SELECT object_id FROM workspace_objects").all();

  for (const row of existing) {
    if (!wanted.has(String(row.object_id))) {
      deleteWorkspaceObject.run(String(row.object_id));
    }
  }

  for (const object of state.objects) {
    upsertWorkspaceObject.run(
      String(object.id),
      String(object.type),
      object.label ?? null,
      object.sourceUrl ?? null,
      object.creationNote ?? null,
      object.createdAt ?? null,
      object.updatedAt ?? null,
      object.values?.last_checked_at ?? null,
      object.importKey ?? null,
      json(object.values ?? {}),
      object.evidence ? json(object.evidence) : null,
      object.manualFields ? json(object.manualFields) : null,
    );
  }
}

function objectDbId(objectId) {
  const row = selectWorkspaceObjectId.get(String(objectId));
  if (!row) throw new Error(`Missing workspace object ${String(objectId)}.`);
  return Number(row.db_id);
}

function syncGeographies(state) {
  const geographies = state.geographies ?? [];
  const groupByObject = new Map();

  const insertGroup = db.prepare(
    "INSERT INTO geography_groups(object_id) VALUES (?)",
  );
  const insertGeography = db.prepare(`
    INSERT INTO geographies(
      legacy_id, object_id, geography_group_id, type, role, geography_object_id, value
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const entry of geographies) {
    const objectId = String(entry.objectId);
    let groupId = groupByObject.get(objectId);
    if (!groupId) {
      groupId = Number(insertGroup.run(objectId).lastInsertRowid);
      groupByObject.set(objectId, groupId);
    }

    const table = geographyTable(String(entry.type));
    db.prepare(`INSERT OR IGNORE INTO ${table}(value) VALUES (?)`).run(
      String(entry.value),
    );
    const dictionary = db
      .prepare(`SELECT id FROM ${table} WHERE value = ?`)
      .get(String(entry.value));
    if (!dictionary) throw new Error("Could not resolve geography dictionary row.");

    insertGeography.run(
      String(entry.id),
      objectId,
      groupId,
      String(entry.type),
      String(entry.role),
      Number(dictionary.id),
      String(entry.value),
    );
  }

  return groupByObject;
}

function syncBusinessTables(state, groupByObject) {
  const projectIdByObject = new Map();
  const operatorIdByObject = new Map();

  const insertProject = db.prepare(`
    INSERT INTO projects(
      id, object_id, type, name, number, status,
      refund_percent_min, refund_percent_max,
      start_date, end_date, announcements_site_url,
      documents_url, documents_link_direct, notes, schedule_note, technical_notes,
      last_checked_at, geography_group_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOperator = db.prepare(`
    INSERT INTO operators(
      id, object_id, name, role, nip, address, website, notes, last_checked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProjectOperator = db.prepare(`
    INSERT INTO projects_operators(project_id, operator_id, operator_type)
    VALUES (?, ?, ?)
  `);
  const insertRecruitment = db.prepare(`
    INSERT INTO recruitments(
      id, object_id, project_id, operator_id,
      external_number, source_number, sequence_number, year, status,
      continuous, refund_percent_min, refund_percent_max,
      start_low_date, start_ceil_date, end_low_date, end_ceil_date,
      planned_start_date, planned_end_date,
      planned_start_year, planned_start_month, planned_start_quarter,
      planned_end_year, planned_end_month, planned_end_quarter,
      closed_status, status_reason, action_code,
      announcement_url, documents_url, data_source_url,
      direct_recruitment_link, notes, funding_rules,
      funding_verified_at, funding_verification_url,
      last_checked_at, geography_group_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  // Operators are materialized first because project.operator_id points to one.
  for (const object of state.objects.filter((entry) => entry.type === "operator")) {
    const id = objectDbId(object.id);
    const values = object.values ?? {};
    operatorIdByObject.set(String(object.id), id);
    insertOperator.run(
      id,
      String(object.id),
      nullableText(values.name) ?? object.label ?? "",
      nullableText(values.role),
      nullableText(values.nip),
      nullableText(values.address),
      nullableText(values.website),
      nullableText(values.notes),
      nullableText(values.last_checked_at),
    );
  }

  for (const object of state.objects.filter((entry) => entry.type === "project")) {
    const id = objectDbId(object.id);
    const values = object.values ?? {};
    projectIdByObject.set(String(object.id), id);
    insertProject.run(
      id,
      String(object.id),
      nullableText(values.type),
      nullableText(values.name) ?? object.label ?? "",
      nullableText(values.number),
      nullableText(values.status) ?? "PLANOWANY",
      nullableNumber(values.refund_percent_min),
      nullableNumber(values.refund_percent_max),
      nullableText(values.start_date),
      nullableText(values.end_date),
      nullableText(values.announcements_site_url),
      nullableText(values.documents_url),
      nullableBoolean(values.documents_link_direct),
      nullableText(values.notes),
      nullableText(values.schedule_note),
      nullableText(values.technical_notes),
      nullableText(values.last_checked_at),
      groupByObject.get(String(object.id)) ?? null,
    );

    const operatorId = operatorIdByObject.get(String(values.operator_id ?? ""));
    if (operatorId) insertProjectOperator.run(id, operatorId, "GLOWNY");
  }

  for (const object of state.objects.filter((entry) => entry.type === "recruitment")) {
    const values = object.values ?? {};
    insertRecruitment.run(
      objectDbId(object.id),
      String(object.id),
      projectIdByObject.get(String(values.project_id ?? "")) ?? null,
      operatorIdByObject.get(String(values.operator_id ?? "")) ?? null,
      nullableText(values.external_number),
      nullableText(values.source_number),
      nullableInt(values.sequence_number),
      nullableInt(values.year),
      nullableText(values.status) ?? "OGLOSZONY",
      nullableBoolean(values.continuous),
      nullableNumber(values.refund_percent_min),
      nullableNumber(values.refund_percent_max),
      nullableText(values.dataRozpoczeciaOd),
      nullableText(values.dataRozpoczeciaDo),
      nullableText(values.dataZakonczeniaOd),
      nullableText(values.dataZakonczeniaDo),
      nullableText(values.planned_start_date),
      nullableText(values.planned_end_date),
      nullableInt(values.planowanyStartRok),
      nullableInt(values.planowanyStartMiesiac),
      nullableInt(values.planowanyStartKwartal),
      nullableInt(values.planowanyKoniecRok),
      nullableInt(values.planowanyKoniecMiesiac),
      nullableInt(values.planowanyKoniecKwartal),
      nullableText(values.statusZakonczenia),
      nullableText(values.powodStatusu),
      nullableText(values.action_code),
      nullableText(values.urlOgloszenia),
      nullableText(values.documents_url),
      nullableText(values.data_source_url),
      nullableBoolean(values.direct_recruitment_link),
      nullableText(values.notes),
      nullableText(values.funding_rules),
      nullableText(values.funding_verified_at),
      nullableText(values.funding_verification_url),
      nullableText(values.last_checked_at),
      groupByObject.get(String(object.id)) ?? null,
    );
  }
}

function syncOperatorContacts(state) {
  const insert = db.prepare(`
    INSERT INTO operator_contacts(
      contact_id, object_id, kind, variant_no, value
    ) VALUES (?, ?, ?, ?, ?)
  `);

  for (const contact of state.operatorContacts ?? []) {
    if (!["EMAIL", "PHONE"].includes(String(contact.kind))) {
      throw new Error(`Unsupported operator contact kind: ${String(contact.kind)}.`);
    }
    const value = String(contact.value ?? "").trim();
    if (!value) continue;
    insert.run(
      String(contact.id),
      String(contact.objectId),
      String(contact.kind),
      Number(contact.variant_no),
      value,
    );
  }
}

function syncExtractionRules(state) {
  const insert = db.prepare(`
    INSERT INTO extraction_rules(
      rule_id, object_id, field, page_url, selector_json, extraction_json,
      sample_value, last_sample_value, last_extracted_at,
      target_kind, target_id, transform_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rule of state.rules) {
    insert.run(
      String(rule.id),
      String(rule.objectId),
      String(rule.field),
      String(rule.pageUrl),
      rule.selector === null || rule.selector === undefined
        ? null
        : json(rule.selector),
      json(rule.extraction),
      rule.sampleValue ?? null,
      rule.lastSampleValue ?? null,
      rule.lastExtractedAt ?? null,
      rule.target?.kind ?? null,
      rule.target?.id ?? null,
      rule.transform ? json(rule.transform) : null,
      rule.createdAt ?? null,
    );
  }
}

function syncFieldEvidence(state) {
  const insert = db.prepare(`
    INSERT INTO field_evidence(
      evidence_id, object_id, field, target_kind, target_id,
      page_url, selector_json, selector_fallbacks_json, extraction_json,
      raw_value, value_at_capture_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const evidence of state.fieldEvidence ?? []) {
    insert.run(
      String(evidence.id),
      String(evidence.objectId),
      String(evidence.field),
      evidence.target?.kind ?? null,
      evidence.target?.id ?? null,
      String(evidence.pageUrl),
      evidence.selector === null || evidence.selector === undefined
        ? null
        : json(evidence.selector),
      evidence.selectorFallbacks ? json(evidence.selectorFallbacks) : null,
      json(evidence.extraction),
      String(evidence.rawValue),
      Object.prototype.hasOwnProperty.call(evidence, "valueAtCapture")
        ? json(evidence.valueAtCapture)
        : null,
      String(evidence.createdAt),
    );
  }
}

function syncFileSources(state) {
  const insert = db.prepare(`
    INSERT INTO file_sources(
      source_id, object_id, file_type, url, name, source_page_url, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const source of state.fileSources ?? []) {
    insert.run(
      String(source.id),
      String(source.objectId),
      String(source.fileType),
      String(source.url),
      String(source.name),
      String(source.sourcePageUrl),
      String(source.addedAt),
    );
  }
}

function syncImportSources(state) {
  const insert = db.prepare(`
    INSERT INTO import_sources(
      source_id, import_key, source_type, url, snapshot_json, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const source of state.importSources ?? []) {
    insert.run(
      String(source.id),
      String(source.importKey),
      String(source.type),
      source.url ?? null,
      json(source.snapshot),
      String(source.importedAt),
    );
  }
}

function syncPayloadRows(table, prefix, records) {
  const insert = db.prepare(
    `INSERT INTO ${table}(row_key, object_id, position, payload_json) VALUES (?, ?, ?, ?)`,
  );

  records.forEach((record, position) => {
    const objectId = String(record.objectId ?? "");
    if (!objectId) return;
    const stable =
      record.id ?? record.variant_no ?? record.document_type_key ?? position;
    insert.run(
      `${prefix}:${objectId}:${String(stable)}:${position}`,
      objectId,
      position,
      json(record),
    );
  });
}

const persistStateTransaction = db.transaction((state) => {
  assertState(state);
  clearMaterializedTables();
  syncWorkspaceObjects(state);
  const groupByObject = syncGeographies(state);
  syncBusinessTables(state, groupByObject);
  syncOperatorContacts(state);
  syncExtractionRules(state);
  syncFieldEvidence(state);
  syncFileSources(state);
  syncImportSources(state);
  syncPayloadRows("financing_rules", "funding", state.financingRules ?? []);
  syncPayloadRows(
    "document_requirements",
    "document",
    state.documentRequirements ?? [],
  );

  db.prepare(`
    INSERT INTO workspace_state(id, revision, state_json, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      revision = excluded.revision,
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(state.revision, JSON.stringify(state), new Date().toISOString());
});

function loadState() {
  const row = db
    .prepare("SELECT state_json FROM workspace_state WHERE id = 1")
    .get();
  if (!row) return null;
  const state = JSON.parse(String(row.state_json));
  assertState(state);
  return state;
}

function saveState(state) {
  persistStateTransaction(state);
}

const resetTransaction = db.transaction(() => {
  clearMaterializedTables();
  db.exec(`
    DELETE FROM workspace_objects;
    DELETE FROM workspace_state;
    DELETE FROM polska_objects;
    DELETE FROM wojewodztwo_objects;
    DELETE FROM podregion_objects;
    DELETE FROM powiat_objects;
    DELETE FROM gmina_objects;
    DELETE FROM miasto_na_prawach_powiatu_objects;
  `);
});

function resetState() {
  resetTransaction();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
}

function databaseBytes() {
  let total = 0;
  for (const path of [DATABASE_PATH, `${DATABASE_PATH}-wal`, `${DATABASE_PATH}-shm`]) {
    if (existsSync(path)) total += statSync(path).size;
  }
  return total;
}

function info() {
  const state = loadState();
  return {
    engine: "sqlite-file",
    schemaVersion: Number(db.pragma("user_version", { simple: true }) || 0),
    bytes: databaseBytes(),
    path: DATABASE_PATH,
    revision: state?.revision ?? 0,
    objects: Number(
      db.prepare("SELECT COUNT(*) AS count FROM workspace_objects").get().count,
    ),
    rules: Number(
      db.prepare("SELECT COUNT(*) AS count FROM extraction_rules").get().count,
    ),
  };
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && !origin.startsWith("moz-extension://")) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only the Burbot extension may access this service." }));
    return false;
  }

  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  return true;
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) throw new Error("Request body is required.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  try {
    if (!setCors(req, res)) return;
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = new URL(req.url || "/", `http://${HOST}:${PORT}`).pathname;

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, ...info() });
      return;
    }

    if (req.method === "GET" && pathname === "/info") {
      sendJson(res, 200, info());
      return;
    }

    if (req.method === "GET" && pathname === "/state") {
      const state = loadState();
      if (!state) {
        res.writeHead(204);
        res.end();
      } else {
        sendJson(res, 200, state);
      }
      return;
    }

    if (req.method === "PUT" && pathname === "/state") {
      const state = await readJsonBody(req);
      saveState(state);
      sendJson(res, 200, { ok: true, revision: state.revision });
      return;
    }

    if (req.method === "DELETE" && pathname === "/state") {
      resetState();
      res.writeHead(204);
      res.end();
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Burbot DB service: http://${HOST}:${PORT}`);
  console.log(`SQLite file: ${DATABASE_PATH}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
