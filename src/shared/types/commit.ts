import type { LegacyStorageState } from "./legacy-storage";

export interface DraftCommit {
  id: string;
  createdAt: string;
  updatedAt: string;
  baseRevision: number;
  baseState: LegacyStorageState;
  workingState: LegacyStorageState;
}

export type CommitObjectStatus = "UNCHANGED" | "MODIFIED" | "NEW" | "DELETED";
export type CommitValueChangeStatus = "ADDED" | "MODIFIED" | "REMOVED";

export interface CommitValueChange {
  field: string;
  status: CommitValueChangeStatus;
  before?: string;
  after?: string;
}

export interface CommitRelatedChange {
  key: string;
  label: string;
  added: number;
  modified: number;
  removed: number;
}

export interface CommitSessionObject {
  id: string;
  type: "project" | "operator" | "recruitment" | "nabor";
  label: string;
  status: CommitObjectStatus;
  changes: CommitValueChange[];
  relatedChanges: CommitRelatedChange[];
}

export interface CommitSessionView {
  active: boolean;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  baseRevision?: number;
  workingRevision?: number;
  dirty: boolean;
  objects: CommitSessionObject[];
}
