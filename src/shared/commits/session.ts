import type {
  CommitRelatedChange,
  CommitSessionObject,
  CommitSessionView,
  CommitValueChange,
  DraftCommit,
} from "../types/commit";
import type {
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";
import { changedObjectIds } from "./staging";

function stable(value: unknown): string {
  return JSON.stringify(value ?? null) ?? String(value);
}

function stableObject(value: LegacyStoredObject | undefined): string {
  return value ? (JSON.stringify(value) ?? "") : "";
}

function labelOf(object: LegacyStoredObject): string {
  const values = object.values ?? {};
  const candidate =
    values.name ??
    values.external_number ??
    values.externalNumber ??
    object.label ??
    object.id;
  return String(candidate);
}

function displayValue(value: unknown, state: LegacyStorageState): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Tak" : "Nie";
  if (typeof value === "string") {
    const referenced = state.objects.find((object) => object.id === value);
    return referenced ? labelOf(referenced) : value;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => displayValue(item, state)).join(", ");
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function valueChanges(
  base: LegacyStoredObject | undefined,
  working: LegacyStoredObject | undefined,
  baseState: LegacyStorageState,
  workingState: LegacyStorageState,
): CommitValueChange[] {
  if (!working) return [];

  const before = base?.values ?? {};
  const after = working.values ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: CommitValueChange[] = [];

  for (const field of [...keys].sort((a, b) => a.localeCompare(b))) {
    const oldValue = before[field];
    const newValue = after[field];
    if (stable(oldValue) === stable(newValue)) continue;

    const oldText = displayValue(oldValue, baseState);
    const newText = displayValue(newValue, workingState);
    changes.push({
      field,
      status:
        oldText === ""
          ? "ADDED"
          : newText === ""
            ? "REMOVED"
            : "MODIFIED",
      ...(oldText !== "" ? { before: oldText } : {}),
      ...(newText !== "" ? { after: newText } : {}),
    });
  }

  if ((base?.sourceUrl ?? "") !== (working.sourceUrl ?? "")) {
    changes.push({
      field: "sourceUrl",
      status: !base?.sourceUrl
        ? "ADDED"
        : !working.sourceUrl
          ? "REMOVED"
          : "MODIFIED",
      ...(base?.sourceUrl ? { before: base.sourceUrl } : {}),
      ...(working.sourceUrl ? { after: working.sourceUrl } : {}),
    });
  }

  return changes;
}

type RelatedRow = Record<string, unknown>;

function rowId(row: RelatedRow, index: number): string {
  const value =
    row.id ??
    row.ruleId ??
    row.evidenceId ??
    row.sourceId ??
    row.row_key ??
    row.document_type_key;
  return value === undefined || value === null
    ? `index:${index}:${stable(row)}`
    : String(value);
}

function collectionDelta(
  baseRows: RelatedRow[],
  workingRows: RelatedRow[],
): Pick<CommitRelatedChange, "added" | "modified" | "removed"> {
  const before = new Map(baseRows.map((row, index) => [rowId(row, index), row]));
  const after = new Map(workingRows.map((row, index) => [rowId(row, index), row]));
  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const [id, row] of after) {
    const old = before.get(id);
    if (!old) added += 1;
    else if (stable(old) !== stable(row)) modified += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed += 1;
  }
  return { added, modified, removed };
}

function relatedRows(
  state: LegacyStorageState,
  key: keyof LegacyStorageState,
  objectId: string,
): RelatedRow[] {
  const value = state[key];
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .filter(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "objectId" in row &&
        String((row as RelatedRow).objectId) === objectId,
    )
    .map((row) => row as RelatedRow);
}

const RELATED_COLLECTIONS: Array<{
  key: keyof LegacyStorageState;
  label: string;
}> = [
  { key: "geographies", label: "Geografia" },
  { key: "operatorAssignments", label: "Operatorzy" },
  { key: "operatorContacts", label: "Kontakty" },
  { key: "financingRules", label: "Dofinansowanie" },
  { key: "documentRequirements", label: "Dokumenty" },
  { key: "fileSources", label: "Pliki" },
  { key: "rules", label: "Reguły ekstrakcji" },
  { key: "fieldEvidence", label: "Evidence" },
  { key: "importTargetEvidence", label: "Evidence oznaczeń" },
];

function relatedChanges(
  draft: DraftCommit,
  objectId: string,
): CommitRelatedChange[] {
  const changes: CommitRelatedChange[] = [];

  for (const collection of RELATED_COLLECTIONS) {
    const delta = collectionDelta(
      relatedRows(draft.baseState, collection.key, objectId),
      relatedRows(draft.workingState, collection.key, objectId),
    );
    if (!delta.added && !delta.modified && !delta.removed) continue;
    changes.push({
      key: String(collection.key),
      label: collection.label,
      ...delta,
    });
  }

  return changes;
}

export function projectCommitObjects(draft: DraftCommit): CommitSessionObject[] {
  const baseById = new Map(draft.baseState.objects.map((object) => [object.id, object]));
  const workingById = new Map(
    draft.workingState.objects.map((object) => [object.id, object]),
  );

  const working = draft.workingState.objects.map((object) => {
    const base = baseById.get(object.id);
    const nestedChanges = relatedChanges(draft, object.id);
    return {
      id: object.id,
      type: object.type,
      label: labelOf(object),
      status: !base
        ? "NEW"
        : stableObject(base) === stableObject(object) && nestedChanges.length === 0
          ? "UNCHANGED"
          : "MODIFIED",
      changes: valueChanges(
        base,
        object,
        draft.baseState,
        draft.workingState,
      ),
      relatedChanges: nestedChanges,
      staged: (draft.stagedObjectIds ?? []).includes(object.id),
    } satisfies CommitSessionObject;
  });

  const deleted = draft.baseState.objects
    .filter((object) => !workingById.has(object.id))
    .map(
      (object) =>
        ({
          id: object.id,
          type: object.type,
          label: labelOf(object),
          status: "DELETED",
          changes: [],
          relatedChanges: relatedChanges(draft, object.id),
          staged: (draft.stagedObjectIds ?? []).includes(object.id),
        }) satisfies CommitSessionObject,
    );

  return [...working, ...deleted];
}

export function commitSessionView(draft: DraftCommit | null): CommitSessionView {
  if (!draft) {
    return { active: false, dirty: false, objects: [] };
  }

  const objects = projectCommitObjects(draft);
  const changedIds = new Set(changedObjectIds(draft));
  const stagedIds = new Set(draft.stagedObjectIds ?? []);
  const dirty = [...stagedIds].some((id) => changedIds.has(id));
  return {
    active: true,
    id: draft.id,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    baseRevision: draft.baseRevision,
    workingRevision: draft.workingState.revision,
    dirty,
    pendingViewCount: [...changedIds].filter((id) => !stagedIds.has(id)).length,
    objects,
  };
}
