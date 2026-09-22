import type { DraftCommit } from "../types/commit";

function rowObjectId(row: unknown): string {
  if (!row || typeof row !== "object" || !("objectId" in row)) return "";
  return String((row as { objectId?: unknown }).objectId ?? "");
}

function restoreOwnedRows<T>(
  working: T[] | undefined,
  base: T[] | undefined,
  objectId: string,
): T[] {
  return [
    ...(working ?? []).filter((row) => rowObjectId(row) !== objectId),
    ...(base ?? [])
      .filter((row) => rowObjectId(row) === objectId)
      .map((row) => structuredClone(row)),
  ];
}

/**
 * Reverts one object's staged changes without discarding the rest of the draft.
 * Object-owned relations/provenance are restored together with the object row.
 */
export function discardObjectChanges(
  draft: DraftCommit,
  objectId: string,
  now: string,
): DraftCommit {
  const working = structuredClone(draft.workingState);
  const baseObject = draft.baseState.objects.find(
    (object) => String(object.id) === objectId,
  );
  const workingIndex = working.objects.findIndex(
    (object) => String(object.id) === objectId,
  );

  if (baseObject) {
    const restored = structuredClone(baseObject);
    if (workingIndex >= 0) working.objects[workingIndex] = restored;
    else working.objects.push(restored);
  } else if (workingIndex >= 0) {
    working.objects.splice(workingIndex, 1);
  } else {
    throw new Error("Object is not part of this commit.");
  }

  working.rules = restoreOwnedRows(
    working.rules,
    draft.baseState.rules,
    objectId,
  );
  working.geographies = restoreOwnedRows(
    working.geographies,
    draft.baseState.geographies,
    objectId,
  );
  working.operatorContacts = restoreOwnedRows(
    working.operatorContacts,
    draft.baseState.operatorContacts,
    objectId,
  );
  working.fileSources = restoreOwnedRows(
    working.fileSources,
    draft.baseState.fileSources,
    objectId,
  );
  working.financingRules = restoreOwnedRows(
    working.financingRules,
    draft.baseState.financingRules,
    objectId,
  );
  working.documentRequirements = restoreOwnedRows(
    working.documentRequirements,
    draft.baseState.documentRequirements,
    objectId,
  );
  working.fieldEvidence = restoreOwnedRows(
    working.fieldEvidence,
    draft.baseState.fieldEvidence,
    objectId,
  );

  working.revision += 1;
  return {
    ...draft,
    updatedAt: now,
    workingState: working,
  };
}
