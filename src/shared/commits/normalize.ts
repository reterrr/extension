import type { DraftCommit } from "../types/commit";

/**
 * Draft edits are staging operations, not committed workspace revisions.
 * Keep the working snapshot on the SQLite revision the commit started from;
 * only Commit to SQLite advances that revision.
 */
export function normalizeDraftWorkingRevision(draft: DraftCommit): DraftCommit {
  draft.workingState.revision = draft.baseRevision;
  return draft;
}
