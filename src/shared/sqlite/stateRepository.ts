import type { Database, SqlValue } from "sql.js";
import type {
  ImportedEvidence,
  ImportedSource,
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredGeography,
  LegacyStoredObject,
  LegacyStoredRule,
} from "../types/legacy-storage";
import { getDatabase, persistDatabase } from "./database";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  return JSON.parse(value) as T;
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function nullableInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function rows(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): Array<Record<string, SqlValue>> {
  const statement = db.prepare(sql);
  try {
    if (params.length) statement.bind(params);
    const result: Array<Record<string, SqlValue>> = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

function scalar(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): SqlValue | undefined {
  const row = rows(db, sql, params)[0];
  return row ? Object.values(row)[0] : undefined;
}

function objectDbId(db: Database, objectId: string): number {
  const value = scalar(
    db,
    "SELECT db_id FROM workspace_objects WHERE object_id = ?",
    [objectId],
  );
  if (typeof value !== "number") throw new Error(`Missing workspace object ${objectId}.`);
  return value;
}

function geographyTable(type: string): string {
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
      throw new Error(`Unsupported geography type: ${type}.`);
  }
}

function ensureGeographyGroup(db: Database, objectId: string): number {
  db.run("INSERT OR IGNORE INTO geography_groups(object_id) VALUES (?)", [objectId]);
  const value = scalar(db, "SELECT id FROM geography_groups WHERE object_id = ?", [objectId]);
  if (typeof value !== "number") throw new Error("Could not create geography group.");
  return value;
}

function ensureGeographyObject(db: Database, type: string, value: string): number {
  const table = geographyTable(type);
  db.run(`INSERT OR IGNORE INTO ${table}(value) VALUES (?)`, [value]);
  const id = scalar(db, `SELECT id FROM ${table} WHERE value = ?`, [value]);
  if (typeof id !== "number") throw new Error("Could not create geography dictionary value.");
  return id;
}

function syncWorkspaceObjects(db: Database, state: LegacyStorageState): void {
  const wanted = new Set(state.objects.map((object) => object.id));
  for (const row of rows(db, "SELECT object_id FROM workspace_objects")) {
    const id = String(row.object_id ?? "");
    if (id && !wanted.has(id)) {
      db.run("DELETE FROM workspace_objects WHERE object_id = ?", [id]);
    }
  }

  for (const object of state.objects) {
    db.run(
      `INSERT INTO workspace_objects(
        object_id, object_type, label, source_url, creation_note,
        created_at, updated_at, import_key, values_json, evidence_json, manual_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET
        object_type = excluded.object_type,
        label = excluded.label,
        source_url = excluded.source_url,
        creation_note = excluded.creation_note,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        import_key = excluded.import_key,
        values_json = excluded.values_json,
        evidence_json = excluded.evidence_json,
        manual_fields_json = excluded.manual_fields_json`,
      [
        object.id,
        object.type,
        object.label ?? null,
        object.sourceUrl ?? null,
        object.creationNote ?? null,
        object.createdAt ?? null,
        object.updatedAt ?? null,
        object.importKey ?? null,
        json(object.values),
        object.evidence ? json(object.evidence) : null,
        object.manualFields ? json(object.manualFields) : null,
      ],
    );
  }
}

function syncGeographies(db: Database, state: LegacyStorageState): void {
  const geographies = state.geographies ?? [];
  const wantedIds = new Set(geographies.map((entry) => entry.id));
  const objectsWithGeography = new Set(geographies.map((entry) => entry.objectId));

  for (const row of rows(db, "SELECT legacy_id FROM geographies")) {
    const id = String(row.legacy_id ?? "");
    if (id && !wantedIds.has(id)) db.run("DELETE FROM geographies WHERE legacy_id = ?", [id]);
  }

  for (const entry of geographies) {
    const groupId = ensureGeographyGroup(db, entry.objectId);
    const geographyObjectId = ensureGeographyObject(db, entry.type, entry.value);
    db.run(
      `INSERT INTO geographies(
        legacy_id, object_id, geography_group_id, type, role, geography_object_id, value
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(legacy_id) DO UPDATE SET
        object_id = excluded.object_id,
        geography_group_id = excluded.geography_group_id,
        type = excluded.type,
        role = excluded.role,
        geography_object_id = excluded.geography_object_id,
        value = excluded.value`,
      [
        entry.id,
        entry.objectId,
        groupId,
        entry.type,
        entry.role,
        geographyObjectId,
        entry.value,
      ],
    );
  }

  for (const row of rows(db, "SELECT object_id FROM geography_groups")) {
    const objectId = String(row.object_id ?? "");
    if (objectId && !objectsWithGeography.has(objectId)) {
      db.run("DELETE FROM geography_groups WHERE object_id = ?", [objectId]);
    }
  }
}

function geographyGroupId(db: Database, objectId: string): number | null {
  const value = scalar(db, "SELECT id FROM geography_groups WHERE object_id = ?", [objectId]);
  return typeof value === "number" ? value : null;
}

function syncBusinessTables(db: Database, state: LegacyStorageState): void {
  db.run("DELETE FROM recruitments");
  db.run("DELETE FROM projects");
  db.run("DELETE FROM operators");

  for (const object of state.objects.filter((entry) => entry.type === "project")) {
    const values = object.values;
    const id = objectDbId(db, object.id);
    db.run(
      `INSERT INTO projects(
        id, object_id, type, name, number, status, start_date, end_date,
        announcements_site_url, geography_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        object.id,
        nullableText(values.type),
        nullableText(values.name) ?? object.label ?? "",
        nullableText(values.number),
        nullableText(values.status) ?? "PLANOWANY",
        nullableText(values.start_date),
        nullableText(values.end_date),
        nullableText(values.announcements_site_url),
        geographyGroupId(db, object.id),
      ],
    );
  }

  for (const object of state.objects.filter((entry) => entry.type === "operator")) {
    const values = object.values;
    const id = objectDbId(db, object.id);
    db.run(
      "INSERT INTO operators(id, object_id, name, nip) VALUES (?, ?, ?, ?)",
      [id, object.id, nullableText(values.name) ?? object.label ?? "", nullableText(values.nip)],
    );
  }

  for (const object of state.objects.filter((entry) => entry.type === "recruitment")) {
    const values = object.values;
    const id = objectDbId(db, object.id);
    const projectObjectId = nullableText(values.project_id);
    const projectId = projectObjectId
      ? scalar(db, "SELECT id FROM projects WHERE object_id = ?", [projectObjectId])
      : null;
    db.run(
      `INSERT INTO recruitments(
        id, object_id, project_id, external_number, sequence_number, year, status,
        start_low_date, start_ceil_date, end_low_date, end_ceil_date,
        planned_start_year, planned_start_month, planned_start_quarter,
        planned_end_year, planned_end_month, planned_end_quarter,
        closed_status, status_reason, announcement_url, geography_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        object.id,
        typeof projectId === "number" ? projectId : null,
        nullableText(values.external_number),
        nullableInt(values.sequence_number),
        nullableInt(values.year),
        nullableText(values.status) ?? "OGLOSZONY",
        nullableText(values.dataRozpoczeciaOd),
        nullableText(values.dataRozpoczeciaDo),
        nullableText(values.dataZakonczeniaOd),
        nullableText(values.dataZakonczeniaDo),
        nullableInt(values.planowanyStartRok),
        nullableInt(values.planowanyStartMiesiac),
        nullableInt(values.planowanyStartKwartal),
        nullableInt(values.planowanyKoniecRok),
        nullableInt(values.planowanyKoniecMiesiac),
        nullableInt(values.planowanyKoniecKwartal),
        nullableText(values.statusZakonczenia),
        nullableText(values.powodStatusu),
        nullableText(values.urlOgloszenia),
        geographyGroupId(db, object.id),
      ],
    );
  }
}

function syncRules(db: Database, rules: LegacyStoredRule[]): void {
  db.run("DELETE FROM extraction_rules");
  for (const rule of rules) {
    db.run(
      `INSERT INTO extraction_rules(
        rule_id, object_id, field, page_url, selector_json, extraction_json,
        sample_value, last_sample_value, last_extracted_at,
        target_kind, target_id, transform_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(rule.id),
        rule.objectId,
        rule.field,
        rule.pageUrl,
        rule.selector === null ? null : json(rule.selector),
        json(rule.extraction),
        rule.sampleValue ?? null,
        rule.lastSampleValue ?? null,
        rule.lastExtractedAt ?? null,
        rule.target?.kind ?? null,
        rule.target?.id ?? null,
        rule.transform ? json(rule.transform) : null,
        rule.createdAt ?? null,
      ],
    );
  }
}

function syncFileSources(db: Database, sources: LegacyStoredFileSource[]): void {
  db.run("DELETE FROM file_sources");
  for (const source of sources) {
    db.run(
      `INSERT INTO file_sources(
        source_id, object_id, file_type, url, name, source_page_url, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        source.objectId,
        source.fileType,
        source.url,
        source.name,
        source.sourcePageUrl,
        source.addedAt,
      ],
    );
  }
}

function syncImportSources(db: Database, sources: ImportedSource[]): void {
  db.run("DELETE FROM import_sources");
  for (const source of sources) {
    db.run(
      `INSERT INTO import_sources(
        source_id, import_key, source_type, url, snapshot_json, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        source.importKey,
        source.type,
        source.url ?? null,
        json(source.snapshot),
        source.importedAt,
      ],
    );
  }
}

function rowKey(prefix: string, row: Record<string, unknown>, position: number): string {
  const objectId = String(row.objectId ?? "unknown");
  const stable = row.id ?? row.variant_no ?? row.document_type_key ?? position;
  return `${prefix}:${objectId}:${String(stable)}:${position}`;
}

function syncJsonRows(
  db: Database,
  table: "financing_rules" | "document_requirements",
  prefix: string,
  records: Array<Record<string, unknown>>,
): void {
  db.run(`DELETE FROM ${table}`);
  records.forEach((record, position) => {
    const objectId = String(record.objectId ?? "");
    if (!objectId) return;
    db.run(
      `INSERT INTO ${table}(row_key, object_id, position, payload_json) VALUES (?, ?, ?, ?)`,
      [rowKey(prefix, record, position), objectId, position, json(record)],
    );
  });
}

function writeMeta(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO app_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function saveStateToSqlite(state: LegacyStorageState): Promise<void> {
  const db = await getDatabase();
  db.run("BEGIN IMMEDIATE");
  try {
    syncWorkspaceObjects(db, state);
    syncGeographies(db, state);
    syncBusinessTables(db, state);
    syncRules(db, state.rules);
    syncFileSources(db, state.fileSources ?? []);
    syncImportSources(db, state.importSources ?? []);
    syncJsonRows(db, "financing_rules", "funding", state.financingRules ?? []);
    syncJsonRows(
      db,
      "document_requirements",
      "document",
      state.documentRequirements ?? [],
    );
    writeMeta(db, "workspace_initialized", "1");
    writeMeta(db, "state_version", String(state.version));
    writeMeta(db, "revision", String(state.revision));
    db.run("COMMIT");
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
  await persistDatabase(db);
}

function loadObjects(db: Database): LegacyStoredObject[] {
  return rows(db, "SELECT * FROM workspace_objects ORDER BY db_id").map((row) => ({
    id: String(row.object_id),
    type: String(row.object_type) as LegacyStoredObject["type"],
    ...(row.label !== null ? { label: String(row.label) } : {}),
    values: parseJson<Record<string, unknown>>(row.values_json, {}),
    ...(row.source_url !== null ? { sourceUrl: String(row.source_url) } : {}),
    ...(row.creation_note !== null ? { creationNote: String(row.creation_note) } : {}),
    ...(row.created_at !== null ? { createdAt: String(row.created_at) } : {}),
    ...(row.updated_at !== null ? { updatedAt: String(row.updated_at) } : {}),
    ...(row.import_key !== null ? { importKey: String(row.import_key) } : {}),
    ...(row.evidence_json !== null
      ? { evidence: parseJson<Record<string, ImportedEvidence[]>>(row.evidence_json, {}) }
      : {}),
    ...(row.manual_fields_json !== null
      ? { manualFields: parseJson<Record<string, boolean>>(row.manual_fields_json, {}) }
      : {}),
  }));
}

function loadRules(db: Database): LegacyStoredRule[] {
  return rows(db, "SELECT * FROM extraction_rules ORDER BY rowid").map((row) => ({
    id: String(row.rule_id),
    objectId: String(row.object_id),
    field: String(row.field),
    pageUrl: String(row.page_url),
    selector: row.selector_json === null ? null : parseJson(row.selector_json, null),
    extraction: parseJson(row.extraction_json, { type: "text" }),
    ...(row.sample_value !== null ? { sampleValue: String(row.sample_value) } : {}),
    ...(row.last_sample_value !== null
      ? { lastSampleValue: String(row.last_sample_value) }
      : {}),
    ...(row.last_extracted_at !== null
      ? { lastExtractedAt: String(row.last_extracted_at) }
      : {}),
    ...(row.target_kind !== null && row.target_id !== null
      ? { target: { kind: String(row.target_kind), id: String(row.target_id) } }
      : {}),
    ...(row.transform_json !== null
      ? { transform: parseJson(row.transform_json, undefined) }
      : {}),
    ...(row.created_at !== null ? { createdAt: String(row.created_at) } : {}),
  })) as LegacyStoredRule[];
}

function loadGeographies(db: Database): LegacyStoredGeography[] {
  return rows(db, "SELECT * FROM geographies ORDER BY id").map((row) => ({
    id: String(row.legacy_id),
    objectId: String(row.object_id),
    type: String(row.type),
    role: String(row.role),
    value: String(row.value),
  }));
}

function loadFileSources(db: Database): LegacyStoredFileSource[] {
  return rows(db, "SELECT * FROM file_sources ORDER BY rowid").map((row) => ({
    id: String(row.source_id),
    objectId: String(row.object_id),
    fileType: String(row.file_type) as LegacyStoredFileSource["fileType"],
    url: String(row.url),
    name: String(row.name),
    sourcePageUrl: String(row.source_page_url),
    addedAt: String(row.added_at),
  }));
}

function loadImportSources(db: Database): ImportedSource[] {
  return rows(db, "SELECT * FROM import_sources ORDER BY rowid").map((row) => ({
    id: String(row.source_id),
    importKey: String(row.import_key),
    type: String(row.source_type) as ImportedSource["type"],
    ...(row.url !== null ? { url: String(row.url) } : {}),
    snapshot: parseJson(row.snapshot_json, { text: "" }),
    importedAt: String(row.imported_at),
  }));
}

function loadJsonRows(
  db: Database,
  table: "financing_rules" | "document_requirements",
): Array<Record<string, unknown>> {
  return rows(db, `SELECT payload_json FROM ${table} ORDER BY position`).map((row) =>
    parseJson<Record<string, unknown>>(row.payload_json, {}),
  );
}

export async function loadStateFromSqlite(): Promise<LegacyStorageState | null> {
  const db = await getDatabase();
  const initialized = scalar(
    db,
    "SELECT value FROM app_meta WHERE key = 'workspace_initialized'",
  );
  if (initialized !== "1") return null;

  const rawRevision = scalar(db, "SELECT value FROM app_meta WHERE key = 'revision'");
  const revision = Number(rawRevision ?? 0);
  return {
    version: 1,
    revision: Number.isSafeInteger(revision) ? revision : 0,
    objects: loadObjects(db),
    rules: loadRules(db),
    geographies: loadGeographies(db),
    fileSources: loadFileSources(db),
    importSources: loadImportSources(db),
    financingRules: loadJsonRows(db, "financing_rules"),
    documentRequirements: loadJsonRows(db, "document_requirements"),
  };
}
