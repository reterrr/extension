import type {
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";

const RELATED_COLLECTIONS = [
  "rules",
  "geographies",
  "fileSources",
  "financingRules",
  "documentRequirements",
] as const;

type RelatedCollection = (typeof RELATED_COLLECTIONS)[number];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function comparableObject(object: LegacyStoredObject): LegacyStoredObject {
  const copy = clone(object);
  if (copy.values) delete copy.values.last_checked_at;
  return copy;
}

function rowsForObject(
  state: LegacyStorageState,
  collection: RelatedCollection,
  objectId: string,
): unknown[] {
  const rows = (state[collection] ?? []) as readonly unknown[];
  return rows.filter(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      "objectId" in row &&
      String((row as { objectId?: unknown }).objectId ?? "") === objectId,
  );
}

function changedForObject(
  base: LegacyStorageState,
  working: LegacyStorageState,
  object: LegacyStoredObject,
): boolean {
  const previous = base.objects.find((entry) => entry.id === object.id);
  if (!previous) return true;

  if (
    JSON.stringify(comparableObject(previous)) !==
    JSON.stringify(comparableObject(object))
  ) {
    return true;
  }

  return RELATED_COLLECTIONS.some(
    (collection) =>
      JSON.stringify(rowsForObject(base, collection, object.id)) !==
      JSON.stringify(rowsForObject(working, collection, object.id)),
  );
}

/**
 * Produces the state that will be persisted by a final commit.
 *
 * last_checked_at is updated only for new/changed objects. Unrelated objects
 * keep their previous timestamp even though SQLite materializes the whole state
 * in one transaction.
 */
export function stampLastCheckedAt(
  base: LegacyStorageState,
  working: LegacyStorageState,
  now: string,
): LegacyStorageState {
  const timestamp = new Date(now);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("last_checked_at requires a valid date-time.");
  }
  const iso = timestamp.toISOString();
  const committed = clone(working);

  for (const object of committed.objects) {
    const source = working.objects.find((entry) => entry.id === object.id);
    if (!source || !changedForObject(base, working, source)) continue;
    object.values ||= {};
    object.values.last_checked_at = iso;
  }

  return committed;
}
