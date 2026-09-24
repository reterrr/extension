import type { ExecutableExtractionRule, ExtractionSpec } from "./extraction";
import type { SourceFileType } from "./source";

/**
 * Compatibility projection consumed by the existing workspace UI/domain engine.
 *
 * SQLite is the durable source of truth. The repository layer reconstructs this
 * shape while the sidepanel is being migrated to typed Projekt / Operator /
 * Nabor repositories. browser.storage.local may temporarily mirror this shape
 * only to wake existing storage.onChanged listeners.
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

export interface ImportedTargetEvidence extends ImportedEvidence {
  id: string;
  objectId: string;
  field: string;
  target: { kind: string; id: string };
  targetImportKey?: string;
}

export interface LegacyStoredFieldEvidence {
  id: string;
  objectId: string;
  field: string;
  target?: { kind: string; id: string };
  pageUrl: string;
  selector: string | null;
  selectorFallbacks?: string[];
  extraction: ExtractionSpec;
  rawValue: string;
  valueAtCapture?: unknown;
  createdAt: string;
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

export interface LegacyStoredOperatorContact {
  id: string;
  objectId: string;
  importKey?: string;
  kind: "EMAIL" | "PHONE";
  variant_no: number;
  value: string;
}

/** Compatibility shape for geography rows exposed to the current UI. */
export interface LegacyStoredGeography {
  id: string;
  objectId: string;
  importKey?: string;
  type: string;
  role: string;
  value: string;
}

/**
 * Compatibility shape for an object-level remote file source.
 * The URL is intentionally remote-only: never `file:`, `blob:` or a filesystem path.
 */
export interface LegacyStoredFileSource {
  id: string;
  objectId: string;
  fileType: SourceFileType;
  url: string;
  /** Always derived from the remote file URL / actual filename. */
  name: string;
  sourcePageUrl: string;
  addedAt: string;

  /** Free-form classification attached to this concrete file. */
  document_kind?: string;
  purpose?: string;
  has_fields?: boolean;
  intended_use?: string;
  client_requirement?: string;
  signature_requirement?: string;
  delivery_method?: string;

  /** Present during portable-import review so approval can rebuild `files[].source`. */
  sourceImportKey?: string;
  /** Optional portable-import source key for the page where the file link was found. */
  sourcePageImportKey?: string;
}

export type LegacyStoredRule = ExecutableExtractionRule & {
  objectId: string;
  field: string;
  /** Present for durable DOM rules; absent for page URL / PDF rules. */
  selectorFallbacks?: string[];
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
  operatorContacts?: LegacyStoredOperatorContact[];
  fileSources?: LegacyStoredFileSource[];
  importSources?: ImportedSource[];
  importTargetEvidence?: ImportedTargetEvidence[];
  financingRules?: Array<Record<string, unknown>>;
  documentRequirements?: Array<Record<string, unknown>>;
  fieldEvidence?: LegacyStoredFieldEvidence[];
}
