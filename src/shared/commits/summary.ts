import { reviewItems } from "./review";
import { changedObjectIds } from "./staging";
import type { CommitSessionObject, DraftCommit } from "../types/commit";

export interface CommitSummary {
  active: boolean;
  objects: Array<Pick<CommitSessionObject, "id" | "status">>;
}

/** Navigation needs statuses, not field diffs, snapshots or evidence payloads. */
export function commitSummary(draft: DraftCommit | null): CommitSummary {
  if (!draft) return { active: false, objects: [] };
  const changed =
    draft.reviewVersion === 1
      ? new Set(
          reviewItems(draft)
            .filter((item) => item.selection !== "discarded")
            .map((item) => item.objectId),
        )
      : new Set(changedObjectIds(draft));
  const base = new Set(draft.baseState.objects.map((object) => object.id));
  const working = new Set(
    draft.workingState.objects.map((object) => object.id),
  );
  return {
    active: true,
    objects: [...changed].map((id) => ({
      id,
      status: !working.has(id) ? "DELETED" : !base.has(id) ? "NEW" : "MODIFIED",
    })),
  };
}
