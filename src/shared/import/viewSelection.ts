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
