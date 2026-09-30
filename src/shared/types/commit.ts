import type { LegacyStorageState } from "./legacy-storage";

export interface DraftCommit {
  id: string;
  createdAt: string;
  updatedAt: string;
  baseRevision: number;
  baseState: LegacyStorageState;
  workingState: LegacyStorageState;
  /** Legacy object staging, retained for compatibility with earlier drafts. */
  stagedObjectIds: string[];
  /** New drafts review each field/related row automatically. */
  reviewVersion?: 1;
  reviewDecisions?: Record<
    string,
    { fingerprint: string; selection: "save" | "later" }
  >;
  discardedChanges?: Record<string, StoredReviewChange>;
}

export interface ReviewTarget {
  kind: "field" | "property" | "row" | "object";
  key: string;
  collection?: string;
}

export interface StoredReviewChange {
  id: string;
  objectId: string;
  objectType: CommitSessionObject["type"];
  objectLabel: string;
  target: ReviewTarget;
  group: string;
  label: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface CommitReviewItem {
  id: string;
  objectId: string;
  group: string;
  label: string;
  status: CommitValueChangeStatus;
  selection: "save" | "later" | "discarded";
  fingerprint: string;
  details: CommitValueChange[];
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
  staged: boolean;
  reviewItems?: CommitReviewItem[];
}

export interface CommitSessionView {
  active: boolean;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  baseRevision?: number;
  workingRevision?: number;
  /** True when at least one pending change is selected for saving. */
  dirty: boolean;
  /** Number of changed objects with all pending changes deferred. */
  pendingViewCount?: number;
  objects: CommitSessionObject[];
}
