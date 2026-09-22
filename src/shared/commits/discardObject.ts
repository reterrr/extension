import type { DraftCommit } from "../types/commit";

type ObjectOwnedRow = { objectId: string; [key: string]: unknown };

function restoreOwnedRows<T extends ObjectOwnedRow>(
  working: T[] | undefined,
  base: T[] | undefined,
  objectId: string,
): T[] {
  return [
    ...(working ?? []).filter((row) => String(row.objectId) !== objectId),
    ...(base ?? [])
      .filter((row) => String(row.objectId) === objectId)
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
    working.rules as ObjectOwnedRow[],
    draft.baseState.rules as ObjectOwnedRow[],
    objectId,
  ) as typeof working.rules;
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
    working.financingRules as ObjectOwnedRow[] | undefined,
    draft.baseState.financingRules as ObjectOwnedRow[] | undefined,
    objectId,
  );
  working.documentRequirements = restoreOwnedRows(
    working.documentRequirements as ObjectOwnedRow[] | undefined,
    draft.baseState.documentRequirements as ObjectOwnedRow[] | undefined,
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
