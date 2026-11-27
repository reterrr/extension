export type ServerId = string;

export type Identity = {
  localObjectId: string;
  localType: string;
  target?: { kind: string; id: string };
};

export type ResolveAction = "preview" | "resolve" | "bind" | "create";
export type ObjectStatus =
  "LOCAL_ONLY" | "RESOLVING" | "SYNCED" | "CONFLICT" | "SYNC_ERROR";

export interface ValueDefinition {
  type: string;
  system?: boolean;
  nullable?: boolean;
  enum_values?: Array<string | number>;
  item?: ValueDefinition;
}

export interface FieldDefinition {
  localKey: string;
  key: string;
  persistentKey: string;
  label: string;
  businessEntityFieldId: ServerId;
  fieldVersionId: ServerId;
  definition: ValueDefinition;
  readonly?: boolean;
  references?: string;
  aliases?: Record<string, string | number>;
}

export interface Registry {
  workspaceUuid: string;
  businessModelId: ServerId;
  name: string;
  revisionId: ServerId;
  aliases: Record<string, { entity: string; fields: Record<string, string> }>;
  entities: EntityDefinition[];
  permissions: { create: boolean; bindExisting: boolean; commit: boolean };
  sources: Array<{
    sourceId: ServerId;
    url: string | null;
    type?: "HTML" | "PDF" | "XLSX";
  }>;
}

export interface EntityDefinition {
  localType: string;
  key: string;
  label: string;
  businessEntityId: ServerId;
  entityVersionId: ServerId;
  fields: FieldDefinition[];
  parents?: string[];
  unavailableLocalKeys?: string[];
}

export interface Slot {
  businessEntityFieldId: ServerId;
  businessObjectFieldId: ServerId;
  fieldVersionId: ServerId;
  valueId: ServerId | null;
  value: unknown;
  collectionRevision: number | null;
}

export interface ResolvedBusinessObject {
  identity: Identity;
  businessModelId: ServerId;
  schemaRevisionId: ServerId;
  businessEntityId: ServerId;
  businessObjectId: ServerId | null;
  status: ObjectStatus;
  objectFields: Record<string, Slot>;
  reason?: string;
}

export interface ResolvedBusinessField {
  businessModelId: ServerId;
  businessEntityId: ServerId;
  businessEntityFieldId: ServerId;
  businessObjectId: ServerId;
  businessObjectFieldId: ServerId;
  fieldVersionId: ServerId;
  persistentKey: string;
}

export interface FieldChange {
  persistentKey: string;
  businessObjectFieldId: ServerId;
  fieldVersionId: ServerId;
  expectedValueId: ServerId | null;
  expectedCollectionRevision?: number;
  value: unknown;
}

export interface CommitRequest {
  workspaceUuid: string;
  schemaRevisionId: ServerId;
  operationId: string;
  changes: Array<{
    identity: Identity;
    businessObjectId: ServerId;
    fields: FieldChange[];
  }>;
}

export interface CommitOperation {
  workspaceUuid: string;
  operationId: string;
  localRevision: number;
  request: CommitRequest | null;
  skipped: Array<{ identity: Identity; field: string; reason: string }>;
}

export interface CommitPreview {
  operation: CommitOperation | null;
  differences: Array<{
    identity: Identity;
    field: string;
    server: unknown;
    proposed: unknown;
  }>;
}

export interface OperationResult {
  operationId?: string;
  code?: string;
  message?: string;
  object?: ResolvedBusinessObject;
  objects?: ResolvedBusinessObject[];
}

export type StoredOperation = CommitOperation & {
  status: "LOCAL_ONLY" | "PENDING" | "SYNCED" | "SYNC_ERROR" | "CONFLICT";
  result: OperationResult | null;
};

export interface SelectorBinding {
  selectorUuid: string;
  revision?: ServerId;
  sourceId: ServerId;
  businessObjectId: ServerId;
  field: Slot;
  status: "SYNCED";
}

export interface SyncState {
  workspaceUuid: string;
  backendOrigin: string | null;
  registry: Registry | null;
  bindings: ResolvedBusinessObject[];
  selectors: SelectorBinding[];
  operations: StoredOperation[];
}

export interface SyncSettings {
  origin: string;
  token: string;
  syncApprovedCommits: boolean;
}

export interface ConfirmedHead {
  from: Slot | null;
  to: Slot;
}

export interface ContinuousIntent {
  identity: Identity;
  label: string;
  canCreate: boolean;
  operationId: string;
  localRevision: number;
  schemaRevisionId: ServerId;
  boundObjectId: ServerId | null;
  fields: Array<{ localKey: string; persistentKey: string | null; value: unknown }>;
  heads: Record<string, Slot>;
  request?: CommitRequest;
  anchors?: Record<string, Slot | null>;
}

export interface ContinuousJob {
  workspaceUuid: string;
  leaseId: string;
  registry: Registry;
  intent: ContinuousIntent;
  resolved: Record<string, ServerId>;
  missing: (OperationResult & { blocked?: boolean }) | null;
  confirmed: Record<string, ConfirmedHead>;
}

export type ContinuousStatus =
  "SYNCED" | "RETRY_PENDING" | "WAITING_DEPENDENCY" | "CONFLICT" | "BLOCKED";

export interface ContinuousSummary {
  mode: boolean | null;
  linked: boolean;
  pending: number;
  synced: number;
  conflicts: number;
  lastSuccess: string | null;
  running: boolean;
  problems: Array<{ id: string; label: string; status: ContinuousStatus; code?: string; message?: string }>;
}
