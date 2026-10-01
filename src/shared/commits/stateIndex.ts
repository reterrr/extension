import type { LegacyStorageState } from "../types/legacy-storage";

type Row = Record<string, unknown>;
const EMPTY_ROWS: Row[] = [];

/** Operation-local: draft edits can share a revision and mutate rows in place. */
export function indexReviewState(state: LegacyStorageState) {
  const collections = new Map<string, Map<string, Row[]>>();
  const rowIndexes = new Map<Row[], Map<string, Row>>();
  return {
    objects: new Map(state.objects.map((object) => [object.id, object])),
    rows(key: string, objectId: string): Row[] {
      let byObject = collections.get(key);
      if (!byObject) {
        byObject = new Map();
        const value = (state as unknown as Row)[key];
        for (const row of (Array.isArray(value) ? value : []) as Row[]) {
          if (!row || row.objectId === undefined) continue;
          const id = String(row.objectId);
          const entries = byObject.get(id);
          if (entries) entries.push(row);
          else byObject.set(id, [row]);
        }
        collections.set(key, byObject);
      }
      return byObject.get(objectId) ?? EMPTY_ROWS;
    },
    row(
      key: string,
      objectId: string,
      id: string,
      identify: (row: Row) => string,
    ) {
      const rows = this.rows(key, objectId);
      let byId = rowIndexes.get(rows);
      if (!byId) {
        byId = new Map();
        // Preserve the previous Array.find behaviour for legacy duplicates.
        for (const row of rows)
          if (!byId.has(identify(row))) byId.set(identify(row), row);
        rowIndexes.set(rows, byId);
      }
      return byId.get(id);
    },
  };
}

export type ReviewStateIndex = ReturnType<typeof indexReviewState>;
