import { importDocumentIntoState } from "./format";
import type { ImportApprovalPlan } from "./review";
import type { LegacyStorageState } from "../types/legacy-storage";

export interface StagedImportReviewResult {
  state: LegacyStorageState;
  stagedObjectId: string;
}

export function stageImportReviewObject(
  original: LegacyStorageState,
  plan: ImportApprovalPlan,
  uuid: () => string,
  now: string,
): StagedImportReviewResult {
  if (
    original.objects.some(
      (object) => object.importKey === plan.selectedImportKey,
    )
  ) {
    throw new Error(
      `Imported object ${plan.selectedImportKey} is already present in the active commit.`,
    );
  }

  const beforeIds = new Set(original.objects.map((object) => object.id));
  let state = importDocumentIntoState(
    original,
    plan.document,
    original.revision,
    uuid,
    now,
  );

  const imported = state.objects.filter((object) => !beforeIds.has(object.id));
  const selected = imported.find(
    (object) => object.importKey === plan.selectedImportKey,
  );
  if (!selected) {
    throw new Error("Could not resolve the reviewed object after import.");
  }

  for (const patch of plan.referencePatches) {
    if (!state.objects.some((object) => object.id === patch.targetObjectId)) {
      throw new Error("A referenced approved object is no longer in the active commit.");
    }
    state = BurbotCore.mutate(
      state,
      {
        op: "EDIT",
        expectedRevision: state.revision,
        objectId: selected.id,
        field: patch.field,
        value: patch.targetObjectId,
      },
      uuid,
      now,
    );
  }

  for (const importKey of plan.temporaryDependencyImportKeys) {
    const temporary = imported.find(
      (object) =>
        object.id !== selected.id && object.importKey === importKey,
    );
    if (!temporary) continue;
    state = BurbotCore.mutate(
      state,
      {
        op: "DELETE",
        expectedRevision: state.revision,
        objectId: temporary.id,
      },
      uuid,
      now,
    );
  }

  return { state, stagedObjectId: selected.id };
}
