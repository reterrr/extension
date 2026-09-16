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

export interface CommitSessionObject {
  id: string;
  type: "project" | "operator" | "recruitment" | "nabor";
  label: string;
  status: CommitObjectStatus;
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
