import { migrateFundingRefundRanges } from "../domain/stateMigrations";
import type { DraftCommit } from "../types/commit";

/**
 * Draft edits are staging operations, not committed workspace revisions.
 * Keep the working snapshot on the SQLite revision the commit started from;
 * only Commit to SQLite advances that revision.
 */
export function normalizeDraftWorkingRevision(draft: DraftCommit): DraftCommit {
  migrateFundingRefundRanges(draft.workingState);
  draft.stagedObjectIds = Array.isArray(draft.stagedObjectIds)
    ? [...new Set(draft.stagedObjectIds.map(String))]
    : [];
  draft.workingState.revision = draft.baseRevision;
  return draft;
}
