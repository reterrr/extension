import type { LegacyStorageState } from "./legacy-storage";

export type ImportReviewObjectStatus = "PENDING" | "APPROVED";

export interface ImportReviewSession {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  previewState: LegacyStorageState;
  objectOrder: string[];
  statusByObjectId: Record<string, ImportReviewObjectStatus>;
  selectedObjectId: string | null;
}

export interface ImportReviewFieldView {
  field: string;
  label: string;
  value: string;
  evidenceCount: number;
}

export interface ImportReviewEvidenceView {
  id: string;
  field: string;
  fieldLabel: string;
  rawValue: string;
  sourceUrl?: string;
  sourceType: string;
  exact: string;
  prefix: string;
  suffix: string;
}

export interface ImportReviewObjectView {
  id: string;
  type: string;
  label: string;
  status: ImportReviewObjectStatus;
  fieldCount: number;
  evidenceCount: number;
}

export interface ImportReviewView {
  active: boolean;
  id?: string;
  fileName?: string;
  createdAt?: string;
  selectedObjectId?: string | null;
  pendingCount?: number;
  approvedCount?: number;
  objects: ImportReviewObjectView[];
  fields: ImportReviewFieldView[];
  evidence: ImportReviewEvidenceView[];
}
