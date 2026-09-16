import type { ExecutableExtractionRule } from "./extraction";
import type { SourceFileType } from "./source";

/**
 * Pre-SQLite browser.storage.local format.
 *
 * This file exists only to keep the current extension working during migration.
 * New frontend/domain code must use Projekt / Operator / Nabor from business.ts.
 */
export type LegacyObjectType = "project" | "recruitment" | "operator" | "nabor";
export type ImportSourceType = "HTML" | "PDF" | "XLSX";

export interface ImportedSourceSnapshot {
  text: string;
  capturedAt?: string;
  contentHash?: string;
  parserVersion?: string;
}

export interface ImportedSource {
  id: string;
  importKey: string;
  type: ImportSourceType;
  url?: string;
  snapshot: ImportedSourceSnapshot;
  importedAt: string;
}

export interface ImportedEvidence {
  sourceId: string;
  charStart: number;
  charEnd: number;
  rawValue: string;
  normalizedValue?: unknown;
}

export interface LegacyStoredObject {
  id: string;
  type: LegacyObjectType;
  label?: string;
  values: Record<string, unknown>;
  sourceUrl?: string;
  creationNote?: string;
  createdAt?: string;
  updatedAt?: string;
  importKey?: string;
  evidence?: Record<string, ImportedEvidence[]>;
  manualFields?: Record<string, boolean>;
}

/** Temporary local representation until geography is persisted in SQLite tables. */
export interface LegacyStoredGeography {
  id: string;
  objectId: string;
  type: string;
  role: string;
  value: string;
}

/**
 * Temporary local representation of an object-level remote file source.
 * The URL is intentionally remote-only: never `file:`, `blob:` or a filesystem path.
 */
export interface LegacyStoredFileSource {
  id: string;
  objectId: string;
  fileType: SourceFileType;
  url: string;
  name: string;
  sourcePageUrl: string;
  addedAt: string;
}

export type LegacyStoredRule = ExecutableExtractionRule & {
  objectId: string;
  field: string;
  sampleValue?: string;
  lastSampleValue?: string;
  lastExtractedAt?: string;
  target?: { kind: string; id: string };
  transform?: { sample: string; value: unknown };
  createdAt?: string;
};

export interface LegacyStorageState {
  version: 1;
  revision: number;
  objects: LegacyStoredObject[];
  rules: LegacyStoredRule[];
  geographies?: LegacyStoredGeography[];
  fileSources?: LegacyStoredFileSource[];
  importSources?: ImportedSource[];
  financingRules?: Array<Record<string, unknown>>;
  documentRequirements?: Array<Record<string, unknown>>;
}
