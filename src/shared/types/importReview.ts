import type { LegacyStorageState } from "./legacy-storage";

export type ImportReviewObjectStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ImportReviewEditorType = "text" | "number" | "date" | "select";

export interface ImportReviewSession {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  previewState: LegacyStorageState;
  objectOrder: string[];
  statusByObjectId: Record<string, ImportReviewObjectStatus>;
  approvedObjectIdByImportKey: Record<string, string>;
  importedFieldsByObjectId: Record<string, string[]>;
  importedFinancingFieldsByObjectId: Record<string, Record<string, string[]>>;
  selectedObjectId: string | null;
}

export interface ImportReviewEditorOption {
  value: string;
  label: string;
}

export interface ImportReviewFieldView {
  field: string;
  label: string;
  value: string;
  editorType: ImportReviewEditorType;
  editorValue: string;
  options?: ImportReviewEditorOption[];
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

export interface ImportReviewFileView {
  id: string;
  name: string;
  displayName?: string;
  url: string;
  sourcePageUrl: string;
  documentKind?: string;
  purpose?: string;
  hasFields?: boolean;
  intendedUse?: string;
  clientRequirement?: string;
  signatureRequirement?: string;
  deliveryMethod?: string;
}

export interface ImportReviewFinancingFieldView {
  field: string;
  label: string;
  value: string;
  editorType: ImportReviewEditorType;
  editorValue: string;
  options?: ImportReviewEditorOption[];
}

export interface ImportReviewFinancingView {
  id: string;
  key: string;
  companySize: string;
  companySizeLabel: string;
  variantNo: number;
  fields: ImportReviewFinancingFieldView[];
}

export interface ImportReviewObjectView {
  id: string;
  type: string;
  label: string;
  status: ImportReviewObjectStatus;
  fieldCount: number;
  evidenceCount: number;
  fileCount: number;
  financingCount: number;
}

export interface ImportReviewView {
  active: boolean;
  id?: string;
  fileName?: string;
  createdAt?: string;
  selectedObjectId?: string | null;
  pendingCount?: number;
  approvedCount?: number;
  rejectedCount?: number;
  objects: ImportReviewObjectView[];
  fields: ImportReviewFieldView[];
  evidence: ImportReviewEvidenceView[];
  files: ImportReviewFileView[];
  financing: ImportReviewFinancingView[];
}
