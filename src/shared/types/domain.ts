import type { ExecutableExtractionRule } from "./extraction";

export type ObjectType = "project" | "recruitment" | "operator" | "nabor";
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

export interface BurbotObject {
  id: string;
  type: ObjectType;
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

export type BurbotRule = ExecutableExtractionRule & {
  objectId: string;
  field: string;
  sampleValue?: string;
  lastSampleValue?: string;
  lastExtractedAt?: string;
  target?: { kind: string; id: string };
  transform?: { sample: string; value: unknown };
  createdAt?: string;
};

export interface BurbotState {
  version: 1;
  revision: number;
  objects: BurbotObject[];
  rules: BurbotRule[];
  importSources?: ImportedSource[];
  financingRules?: Array<Record<string, unknown>>;
  documentRequirements?: Array<Record<string, unknown>>;
}

export interface FocusPayload {
  objectId?: string;
  tabId?: number;
  stamp: string;
  note?: string;
  error?: string;
}
