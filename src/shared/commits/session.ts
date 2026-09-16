import type { DraftCommit, CommitSessionObject, CommitSessionView } from "../types/commit";
import type { LegacyStoredObject } from "../types/legacy-storage";

function stableObject(value: LegacyStoredObject | undefined): string {
  if (!value) return "";
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete copy.updatedAt;
  return JSON.stringify(copy);
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

export function projectCommitObjects(draft: DraftCommit): CommitSessionObject[] {
  const baseById = new Map(draft.baseState.objects.map((object) => [object.id, object]));
  return draft.workingState.objects.map((object) => {
    const base = baseById.get(object.id);
    return {
      id: object.id,
      type: object.type,
      label: labelOf(object),
      status: !base
        ? "NEW"
        : stableObject(base) === stableObject(object)
          ? "UNCHANGED"
          : "MODIFIED",
    } satisfies CommitSessionObject;
  });
}

export function commitSessionView(draft: DraftCommit | null): CommitSessionView {
  if (!draft) {
    return { active: false, dirty: false, objects: [] };
  }

  const objects = projectCommitObjects(draft);
  const dirty = JSON.stringify(draft.baseState) !== JSON.stringify(draft.workingState);
  return {
    active: true,
    id: draft.id,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    baseRevision: draft.baseRevision,
    workingRevision: draft.workingState.revision,
    dirty,
    objects,
  };
}
