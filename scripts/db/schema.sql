PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_objects (
  db_id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL UNIQUE,
  object_type TEXT NOT NULL,
  label TEXT,
  source_url TEXT,
  creation_note TEXT,
  created_at TEXT,
  updated_at TEXT,
  last_checked_at TEXT,
  import_key TEXT,
  values_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT,
  manual_fields_json TEXT
);

CREATE INDEX IF NOT EXISTS ix_workspace_objects_import_key
ON workspace_objects(import_key);

CREATE TABLE IF NOT EXISTS geography_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE,
  type TEXT,
  name TEXT NOT NULL,
  number TEXT,
  status TEXT NOT NULL,
  refund_percent_min REAL,
  refund_percent_max REAL,
  start_date TEXT,
  end_date TEXT,
  announcements_site_url TEXT,
  documents_url TEXT,
  documents_link_direct INTEGER CHECK (documents_link_direct IN (0, 1)),
  notes TEXT,
  schedule_note TEXT,
  technical_notes TEXT,
  last_checked_at TEXT,
  geography_group_id INTEGER,
  FOREIGN KEY (id) REFERENCES workspace_objects(db_id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE,
  FOREIGN KEY (geography_group_id) REFERENCES geography_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT,
  nip TEXT,
  address TEXT,
  website TEXT,
  notes TEXT,
  last_checked_at TEXT,
  FOREIGN KEY (id) REFERENCES workspace_objects(db_id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recruitments (
  id INTEGER PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE,
  project_id INTEGER,
  operator_id INTEGER,
  external_number TEXT,
  source_number TEXT,
  sequence_number INTEGER,
  year INTEGER,
  status TEXT NOT NULL,
  continuous INTEGER CHECK (continuous IN (0, 1)),
  refund_percent_min REAL,
  refund_percent_max REAL,
  start_low_date TEXT,
  start_ceil_date TEXT,
  end_low_date TEXT,
  end_ceil_date TEXT,
  planned_start_date TEXT,
  planned_end_date TEXT,
  planned_start_year INTEGER,
  planned_start_month INTEGER,
  planned_start_quarter INTEGER,
  planned_end_year INTEGER,
  planned_end_month INTEGER,
  planned_end_quarter INTEGER,
  closed_status TEXT,
  status_reason TEXT,
  action_code TEXT,
  announcement_url TEXT,
  documents_url TEXT,
  data_source_url TEXT,
  direct_recruitment_link INTEGER CHECK (direct_recruitment_link IN (0, 1)),
  notes TEXT,
  funding_rules TEXT,
  funding_verified_at TEXT,
  funding_verification_url TEXT,
  last_checked_at TEXT,
  geography_group_id INTEGER,
  FOREIGN KEY (id) REFERENCES workspace_objects(db_id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (operator_id) REFERENCES operators(id),
  FOREIGN KEY (geography_group_id) REFERENCES geography_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS operator_contacts (
  contact_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('EMAIL', 'PHONE')),
  variant_no INTEGER NOT NULL CHECK (variant_no >= 1),
  value TEXT NOT NULL,
  UNIQUE(object_id, kind, variant_no),
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_operator_contacts_object_kind
ON operator_contacts(object_id, kind);

CREATE TABLE IF NOT EXISTS projects_operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  operator_id INTEGER NOT NULL,
  operator_type TEXT NOT NULL,
  UNIQUE(project_id, operator_id, operator_type),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS polska_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS wojewodztwo_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS podregion_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS powiat_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS gmina_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS miasto_na_prawach_powiatu_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS geographies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id TEXT NOT NULL UNIQUE,
  object_id TEXT NOT NULL,
  geography_group_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  role TEXT NOT NULL,
  geography_object_id INTEGER NOT NULL,
  value TEXT NOT NULL,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE,
  FOREIGN KEY (geography_group_id) REFERENCES geography_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_geographies_group ON geographies(geography_group_id);
CREATE INDEX IF NOT EXISTS ix_geographies_object ON geographies(object_id);

CREATE TABLE IF NOT EXISTS extraction_rules (
  rule_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  field TEXT NOT NULL,
  page_url TEXT NOT NULL,
  selector_json TEXT,
  extraction_json TEXT NOT NULL,
  sample_value TEXT,
  last_sample_value TEXT,
  last_extracted_at TEXT,
  target_kind TEXT,
  target_id TEXT,
  transform_json TEXT,
  created_at TEXT,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_extraction_rules_object ON extraction_rules(object_id);
CREATE INDEX IF NOT EXISTS ix_extraction_rules_target ON extraction_rules(target_kind, target_id);

CREATE TABLE IF NOT EXISTS field_evidence (
  evidence_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  field TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  page_url TEXT NOT NULL,
  selector_json TEXT,
  selector_fallbacks_json TEXT,
  extraction_json TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  value_at_capture_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_field_evidence_object_field
ON field_evidence(object_id, field);

CREATE INDEX IF NOT EXISTS ix_field_evidence_target
ON field_evidence(target_kind, target_id);

CREATE TABLE IF NOT EXISTS file_sources (
  source_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  file_type TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  source_page_url TEXT NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE(object_id, url),
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_sources (
  source_id TEXT PRIMARY KEY,
  import_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  snapshot_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financing_rules (
  row_key TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_requirements (
  row_key TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (object_id) REFERENCES workspace_objects(object_id) ON DELETE CASCADE
);

PRAGMA user_version = 6;
