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

function pruneUnusedNewImportSources(
  working: DraftCommit["workingState"],
  base: DraftCommit["baseState"],
): void {
  const baseIds = new Set(
    (base.importSources ?? []).map((source) => String(source.id)),
  );
  const usedIds = new Set<string>();
  const usedKeys = new Set<string>();

  for (const object of working.objects) {
    for (const entries of Object.values(object.evidence ?? {})) {
      for (const evidence of entries) usedIds.add(String(evidence.sourceId));
    }
  }
  for (const file of working.fileSources ?? []) {
    if (file.sourceImportKey) usedKeys.add(String(file.sourceImportKey));
    if (file.sourcePageImportKey) {
      usedKeys.add(String(file.sourcePageImportKey));
    }
  }

  working.importSources = (working.importSources ?? []).filter(
    (source) =>
      baseIds.has(String(source.id)) ||
      usedIds.has(String(source.id)) ||
      usedKeys.has(String(source.importKey)),
  );
}

function semanticallyEqual(
  left: DraftCommit["baseState"],
  right: DraftCommit["workingState"],
): boolean {
  const a = structuredClone(left);
  const b = structuredClone(right);
  a.revision = 0;
  b.revision = 0;
  return JSON.stringify(a) === JSON.stringify(b);
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
    const dependants = working.objects.filter(
      (object) =>
        String(object.id) !== objectId &&
        Object.values(object.values ?? {}).some(
          (value) => String(value ?? "") === objectId,
        ),
    );
    if (dependants.length) {
      const labels = dependants
        .slice(0, 3)
        .map((object) => String(object.label ?? object.values?.name ?? object.id))
        .join(", ");
      throw new Error(
        "Nie można odrzucić tego nowego obiektu, ponieważ odwołują się do niego inne staged obiekty: " +
          labels +
          ". Najpierw odrzuć obiekty zależne.",
      );
    }
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
  pruneUnusedNewImportSources(working, draft.baseState);

  working.revision = semanticallyEqual(draft.baseState, working)
    ? draft.baseState.revision
    : working.revision + 1;
  return {
    ...draft,
    updatedAt: now,
    workingState: working,
  };
}
