import { findExistingImportObjectMatch } from "./review";
import { createObjectView } from "../search/objectView.js";
import type { ImportReviewSession } from "../types/importReview";
import type {
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";

export interface ImportViewResolution {
  view: {
    version: 1;
    objectIds: string[];
    query: string;
    type: string;
    createdAt: string;
  };
  matchedObjects: LegacyStoredObject[];
  unresolvedObjects: LegacyStoredObject[];
}

function approvedTarget(
  session: ImportReviewSession,
  imported: LegacyStoredObject,
  state: LegacyStorageState,
): LegacyStoredObject | undefined {
  if (!imported.importKey) return undefined;
  const targetId = session.approvedObjectIdByImportKey[imported.importKey];
  if (!targetId) return undefined;
  return state.objects.find((object) => object.id === targetId);
}

/**
 * Resolves an Import Review document to the objects that already exist in the
 * current workspace. This deliberately does not stage, approve or otherwise
 * mutate imported data: it only builds an Active View selection.
 */
export function createObjectViewFromImportReview(
  session: ImportReviewSession,
  state: LegacyStorageState,
  now = new Date().toISOString(),
): ImportViewResolution {
  const matchedObjects: LegacyStoredObject[] = [];
  const unresolvedObjects: LegacyStoredObject[] = [];
  const seenTargetIds = new Set<string>();

  for (const previewId of session.objectOrder) {
    const imported = session.previewState.objects.find(
      (object) => object.id === previewId,
    );
    if (!imported) continue;

    const target =
      approvedTarget(session, imported, state) ??
      findExistingImportObjectMatch(imported, state);

    if (!target) {
      unresolvedObjects.push(imported);
      continue;
    }
    if (seenTargetIds.has(target.id)) continue;
    seenTargetIds.add(target.id);
    matchedObjects.push(target);
  }

  if (!matchedObjects.length) {
    throw new Error(
      "Żaden obiekt z tego pliku nie istnieje w bieżącej bazie. Ustawienie View nie importuje nowych obiektów ani nie zmienia danych.",
    );
  }

  return {
    view: createObjectView(
      matchedObjects,
      "",
      "all",
      now,
    ) as ImportViewResolution["view"],
    matchedObjects,
    unresolvedObjects,
  };
}


export interface JsonViewSelector {
  key: string;
  type?: string;
}

export interface JsonViewResolution {
  view: ImportViewResolution["view"];
  matchedObjects: LegacyStoredObject[];
  unresolvedSelectors: JsonViewSelector[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonObjectRows(document: unknown): unknown[] {
  const root = record(document);
  if (!root) return [];

  if (Array.isArray(root.objects)) return root.objects;

  const data = record(root.data);
  if (data && Array.isArray(data.objects)) return data.objects;

  const completeState = record(root.complete_state);
  if (completeState && Array.isArray(completeState.objects)) {
    return completeState.objects;
  }

  return [];
}

function selectorFromJsonObject(value: unknown): {
  selector: JsonViewSelector;
  identifiers: string[];
} | undefined {
  const object = record(value);
  if (!object) return undefined;

  const data = record(object.data);
  const identifiers = [
    cleanIdentifier(object.id),
    cleanIdentifier(object.importKey),
    cleanIdentifier(object.key),
    cleanIdentifier(data?.id),
  ].filter((entry, index, all) => entry && all.indexOf(entry) === index);

  if (!identifiers.length) return undefined;

  const type = cleanIdentifier(object.type);
  return {
    selector: {
      key: identifiers[0],
      ...(type ? { type } : {}),
    },
    identifiers,
  };
}

function existingObjectForSelector(
  state: LegacyStorageState,
  identifiers: string[],
  type?: string,
): LegacyStoredObject | undefined {
  const candidates = type
    ? state.objects.filter((object) => object.type === type)
    : state.objects;

  for (const identifier of identifiers) {
    const byId = candidates.filter(
      (object) => String(object.id) === identifier,
    );
    if (byId.length === 1) return byId[0];
  }

  for (const identifier of identifiers) {
    const byImportKey = candidates.filter(
      (object) => String(object.importKey ?? "") === identifier,
    );
    if (byImportKey.length === 1) return byImportKey[0];
  }

  return undefined;
}

/**
 * Builds Active View directly from identifiers present in JSON.
 *
 * This path intentionally does NOT parse or validate portable business data.
 * The JSON is only a list of selectors. Every selector is resolved to the
 * existing workspace/database object by runtime id or importKey, and the View
 * then reads the full current object data from the workspace state.
 */
export function createObjectViewFromJsonDocument(
  document: unknown,
  state: LegacyStorageState,
  now = new Date().toISOString(),
): JsonViewResolution {
  const rows = jsonObjectRows(document);
  if (!rows.length) {
    throw new Error(
      "Ten plik nie zawiera listy objects[]. Ustawienie View wymaga identyfikatorów istniejących obiektów.",
    );
  }

  const matchedObjects: LegacyStoredObject[] = [];
  const unresolvedSelectors: JsonViewSelector[] = [];
  const seenTargetIds = new Set<string>();

  for (const row of rows) {
    const parsed = selectorFromJsonObject(row);
    if (!parsed) continue;

    const target = existingObjectForSelector(
      state,
      parsed.identifiers,
      parsed.selector.type,
    );

    if (!target) {
      unresolvedSelectors.push(parsed.selector);
      continue;
    }

    if (seenTargetIds.has(target.id)) continue;
    seenTargetIds.add(target.id);
    matchedObjects.push(target);
  }

  if (!matchedObjects.length) {
    throw new Error(
      "Żaden identyfikator z tego pliku nie odpowiada obiektowi w bieżącej bazie. View nie importuje danych z JSON — używa go tylko do wskazania istniejących obiektów.",
    );
  }

  return {
    view: createObjectView(
      matchedObjects,
      "",
      "all",
      now,
    ) as ImportViewResolution["view"],
    matchedObjects,
    unresolvedSelectors,
  };
}
