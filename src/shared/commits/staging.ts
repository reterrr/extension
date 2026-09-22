import type { DraftCommit } from "../types/commit";
import type { LegacyStorageState } from "../types/legacy-storage";

const OBJECT_SCOPED_KEYS = [
  "rules",
  "geographies",
  "operatorContacts",
  "fileSources",
  "financingRules",
  "documentRequirements",
  "fieldEvidence",
] as const;

function cloneState(state: LegacyStorageState): LegacyStorageState {
  return JSON.parse(JSON.stringify(state)) as LegacyStorageState;
}

function rowsFor(
  state: LegacyStorageState,
  key: (typeof OBJECT_SCOPED_KEYS)[number],
  objectId: string,
): Array<Record<string, unknown>> {
  const rows = (state as unknown as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "objectId" in row &&
        String((row as Record<string, unknown>).objectId) === objectId,
    )
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

function replaceScopedRows(
  target: LegacyStorageState,
  source: LegacyStorageState,
  objectId: string,
): void {
  for (const key of OBJECT_SCOPED_KEYS) {
    const rawExisting = (target as unknown as Record<string, unknown>)[key];
    const existing = Array.isArray(rawExisting) ? rawExisting : [];
    const preserved = existing.filter(
      (row) =>
        !(
          typeof row === "object" &&
          row !== null &&
          "objectId" in row &&
          String((row as Record<string, unknown>).objectId) === objectId
        ),
    );
    (target as unknown as Record<string, unknown>)[key] = [
      ...preserved,
      ...rowsFor(source, key, objectId),
    ];
  }
}

function replaceObject(
  target: LegacyStorageState,
  source: LegacyStorageState,
  objectId: string,
): void {
  const sourceObject = source.objects.find((object) => object.id === objectId);
  const index = target.objects.findIndex((object) => object.id === objectId);

  if (sourceObject) {
    const next = JSON.parse(JSON.stringify(sourceObject));
    if (index >= 0) target.objects[index] = next;
    else target.objects.push(next);
  } else if (index >= 0) {
    target.objects.splice(index, 1);
  }

  replaceScopedRows(target, source, objectId);
}

export function applyStagedObjects(draft: DraftCommit): LegacyStorageState {
  const committed = cloneState(draft.baseState);
  for (const objectId of draft.stagedObjectIds ?? []) {
    replaceObject(committed, draft.workingState, objectId);
  }

  // Keep committed provenance plus only new import sources actually used by
  // staged objects. Sources belonging exclusively to unstaged View objects stay
  // in the draft and do not leak into SQLite.
  const usedSourceIds = new Set<string>();
  const usedImportKeys = new Set<string>();
  const stagedIds = new Set(draft.stagedObjectIds ?? []);

  for (const object of draft.workingState.objects) {
    if (!stagedIds.has(object.id)) continue;
    for (const entries of Object.values(object.evidence ?? {})) {
      for (const evidence of entries) usedSourceIds.add(String(evidence.sourceId));
    }
  }

  for (const file of draft.workingState.fileSources ?? []) {
    if (!stagedIds.has(file.objectId)) continue;
    if (file.sourceImportKey) usedImportKeys.add(String(file.sourceImportKey));
    if (file.sourcePageImportKey) {
      usedImportKeys.add(String(file.sourcePageImportKey));
    }
  }

  const imported = new Map(
    (draft.baseState.importSources ?? []).map((row) => [String(row.id), row]),
  );
  for (const row of draft.workingState.importSources ?? []) {
    if (
      usedSourceIds.has(String(row.id)) ||
      usedImportKeys.has(String(row.importKey))
    ) {
      imported.set(String(row.id), row);
    }
  }
  committed.importSources = [...imported.values()].map((row) =>
    JSON.parse(JSON.stringify(row)),
  );

  return committed;
}

export function discardViewObject(
  draft: DraftCommit,
  objectId: string,
): DraftCommit {
  replaceObject(draft.workingState, draft.baseState, objectId);
  draft.stagedObjectIds = (draft.stagedObjectIds ?? []).filter(
    (id) => id !== objectId,
  );
  return draft;
}

export function stageObject(draft: DraftCommit, objectId: string): DraftCommit {
  if (!draft.stagedObjectIds.includes(objectId)) {
    draft.stagedObjectIds.push(objectId);
  }
  return draft;
}

export function unstageObject(draft: DraftCommit, objectId: string): DraftCommit {
  draft.stagedObjectIds = draft.stagedObjectIds.filter((id) => id !== objectId);
  return draft;
}

export function changedObjectIds(draft: DraftCommit): string[] {
  const ids = new Set<string>();
  const base = new Map(draft.baseState.objects.map((object) => [object.id, object]));
  const working = new Map(
    draft.workingState.objects.map((object) => [object.id, object]),
  );

  for (const id of new Set([...base.keys(), ...working.keys()])) {
    if (JSON.stringify(base.get(id)) !== JSON.stringify(working.get(id))) {
      ids.add(id);
    }
  }

  for (const key of OBJECT_SCOPED_KEYS) {
    const relatedIds = new Set<string>();
    for (const state of [draft.baseState, draft.workingState]) {
      const rows = (state as unknown as Record<string, unknown>)[key];
      for (const row of Array.isArray(rows) ? rows : []) {
        if (
          typeof row === "object" &&
          row !== null &&
          "objectId" in row
        ) {
          relatedIds.add(String((row as Record<string, unknown>).objectId));
        }
      }
    }
    for (const id of relatedIds) {
      if (
        JSON.stringify(rowsFor(draft.baseState, key, id)) !==
        JSON.stringify(rowsFor(draft.workingState, key, id))
      ) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

export function hasViewChanges(draft: DraftCommit): boolean {
  return changedObjectIds(draft).length > 0;
}


export interface MissingReference {
  objectId: string;
  field: string;
  targetId: string;
}

export function missingReferences(
  state: LegacyStorageState,
  schema: Record<
    string,
    { fields?: Record<string, { type?: string }> }
  >,
): MissingReference[] {
  const existing = new Set(state.objects.map((object) => object.id));
  const missing: MissingReference[] = [];

  for (const object of state.objects) {
    const fields = schema[object.type]?.fields ?? {};
    for (const [field, definition] of Object.entries(fields)) {
      if (definition.type !== "reference") continue;
      const targetId = object.values?.[field];
      if (
        typeof targetId === "string" &&
        targetId &&
        !existing.has(targetId)
      ) {
        missing.push({
          objectId: object.id,
          field,
          targetId,
        });
      }
    }
  }

  return missing;
}
