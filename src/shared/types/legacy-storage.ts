import type { ExecutableExtractionRule } from "./extraction";

/**
 * Temporary compatibility contract for the pre-SQLite browser.storage.local
 * snapshot. New application/domain code must use Projekt / Operator / Nabor
 * from business.ts instead of these generic records.
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

/**
 * Version 1 is intentionally frozen. It will be read only for migration once
 * the SQLite repository becomes the source of truth.
 */
export interface LegacyStorageState {
  version: 1;
  revision: number;
  objects: LegacyStoredObject[];
  rules: LegacyStoredRule[];
  importSources?: ImportedSource[];
  financingRules?: Array<Record<string, unknown>>;
  documentRequirements?: Array<Record<string, unknown>>;
}
