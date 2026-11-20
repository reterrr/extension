import type { LegacyStoredRule } from "../types/legacy-storage";
import type { selectorTreeDTO } from "../selectors/dto";
import type { Identity, SelectorBinding, ServerId } from "./types";

export type SourceType = "HTML" | "PDF" | "XLSX";
export type BulkStatus =
  | "READY"
  | "ALREADY_SYNCED"
  | "SOURCE_MISSING"
  | "SOURCE_GRANT_REQUIRED"
  | "SOURCE_AMBIGUOUS"
  | "SOURCE_TYPE_MISMATCH"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_ORIGIN_DENIED"
  | "SOURCE_URL_INVALID"
  | "SOURCE_CHANGED"
  | "OBJECT_UNRESOLVED"
  | "FIELD_UNRESOLVED"
  | "SELECTOR_REVIEW_REQUIRED"
  | "SELECTOR_CONFLICT"
  | "UNSUPPORTED"
  | "SYNC_ERROR"
  | "PENDING"
  | "SYNCED"
  | "BLOCKED";

export interface LocalSourceCandidate {
  key: string;
  type: SourceType | "UNSUPPORTED";
  url: string | null;
  localKeys: string[];
  provenance: string[];
  selectorUuids: string[];
  issue?: "SOURCE_URL_INVALID" | "UNSUPPORTED";
}

export interface LocalSelectorCandidate {
  key: string;
  rule: LegacyStoredRule;
  sourceKeys: string[];
  pendingEvidence: number;
}

export interface Discovery {
  sources: LocalSourceCandidate[];
  selectors: LocalSelectorCandidate[];
  pendingEvidence: number;
}

export interface SourceRequest {
  clientKey: string;
  type: SourceType;
  url: string;
}

export interface ApprovedSource extends SourceRequest {
  allowCreate: boolean;
  allowGrantExisting: boolean;
  expectedSourceId?: ServerId;
}

export interface SourceResult {
  clientKey: string;
  status:
    | "EXISTING_SOURCE"
    | "RESOLVED"
    | "SOURCE_MISSING"
    | "SOURCE_GRANT_REQUIRED"
    | "SOURCE_TYPE_MISMATCH"
    | "SOURCE_UNAVAILABLE"
    | "SOURCE_ORIGIN_DENIED"
    | "SOURCE_URL_INVALID"
    | "SOURCE_CHANGED";
  canonicalUrl?: string;
  type?: SourceType;
  actualType?: SourceType;
  sourceId?: ServerId;
  requiresGrant?: boolean;
  canCreate?: boolean;
  canGrantExisting?: boolean;
}

export interface SelectorRequest {
  identity: Identity;
  tree: ReturnType<typeof selectorTreeDTO>;
  sourceId?: ServerId;
  sourceUrl?: string;
}

export interface SelectorResult {
  selectorUuid: string;
  status: BulkStatus;
  reason?: string;
  revision?: string | null;
  businessObjectFieldId?: ServerId;
  binding?: SelectorBinding | null;
}

export interface BulkRow {
  key: string;
  kind: "source" | "selector";
  label: string;
  provenance?: string[];
  url?: string;
  objectId?: string;
  businessObjectFieldId?: ServerId;
  status: BulkStatus;
  reason?: string;
  pendingEvidence?: number;
  sourceKey?: string;
  sourceId?: ServerId;
}

export interface SourceTask {
  key: string;
  kind: "source";
  request: ApprovedSource;
  localKeys: string[];
}

export interface SelectorTask {
  key: string;
  kind: "selector";
  request: SelectorRequest;
  sourceKey: string;
  expectedRevision: string | null;
  expectedBusinessObjectFieldId: ServerId;
  alreadySynced: boolean;
  publishReviewed: boolean;
}

export type BulkTask = SourceTask | SelectorTask;
export type BulkProgress = {
  key: string;
  status: "PENDING" | "SYNCED" | "BLOCKED" | "SELECTOR_CONFLICT" | "SYNC_ERROR";
  reason?: string;
  source?: SourceResult;
  selector?: SelectorBinding;
};

export interface BulkPlan {
  workspaceUuid: string;
  backendOrigin: string;
  localRevision: number;
  schemaRevisionId: ServerId;
  pendingEvidence: number;
  rows: BulkRow[];
  sources: SourceTask[];
  selectors: SelectorTask[];
}

export interface BulkJob {
  operationId: string;
  workspaceUuid: string;
  backendOrigin: string;
  localRevision: number;
  schemaRevisionId: ServerId;
  pendingEvidence: number;
  report: BulkRow[];
  tasks: BulkTask[];
}

export interface StoredBulkJob extends BulkJob {
  progress: BulkProgress[];
}

export interface SourceBinding {
  localSourceKey: string;
  canonicalUrl: string;
  type: SourceType;
  backendSourceId: ServerId;
  syncStatus: "SYNCED";
  lastSyncedAt: string;
}

export interface BulkJobSummary {
  operationId: string;
  localRevision: number;
  createdAt: string;
  pending: number;
  synced: number;
  failed: number;
}
