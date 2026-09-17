import { importDocumentIntoState } from "./format";
import type { ImportApprovalPlan } from "./review";
import type {
  LegacyStorageState,
  LegacyStoredRule,
} from "../types/legacy-storage";

export interface ReviewedImportRule extends LegacyStoredRule {
  /** Stable financing key used to remap preview row ids after staging. */
  targetImportKey?: string;
}

export interface ImportApprovalPlanWithRules extends ImportApprovalPlan {
  reviewRules?: ReviewedImportRule[];
}

export interface StagedImportReviewResult {
  state: LegacyStorageState;
  stagedObjectId: string;
}

export function stageImportReviewObject(
  original: LegacyStorageState,
  plan: ImportApprovalPlanWithRules,
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

  const copiedRules: LegacyStoredRule[] = [];
  for (const reviewedRule of plan.reviewRules ?? []) {
    let target = reviewedRule.target;

    if (target?.kind === "funding") {
      if (!reviewedRule.targetImportKey) {
        throw new Error("Could not remap reviewed funding extraction rule.");
      }
      const funding = (state.financingRules ?? []).find(
        (row) =>
          row.objectId === selected.id &&
          String(row.importKey ?? "") === reviewedRule.targetImportKey,
      );
      if (!funding?.id) {
        throw new Error(
          `Could not resolve reviewed financing variant ${reviewedRule.targetImportKey}.`,
        );
      }
      target = { kind: "funding", id: String(funding.id) };
    } else if (target?.kind && target.kind !== "object") {
      throw new Error(`Unsupported reviewed extraction target: ${target.kind}.`);
    }

    const referencePatch =
      !target || target.kind === "object"
        ? plan.referencePatches.find((patch) => patch.field === reviewedRule.field)
        : undefined;
    const transform =
      reviewedRule.transform && referencePatch
        ? { ...reviewedRule.transform, value: referencePatch.targetObjectId }
        : reviewedRule.transform;

    const { targetImportKey: _targetImportKey, ...rule } = reviewedRule;
    copiedRules.push({
      ...rule,
      ...(transform ? { transform } : { transform: undefined }),
      id: uuid(),
      objectId: selected.id,
      ...(target?.kind && target.kind !== "object" ? { target } : { target: undefined }),
      createdAt: now,
    });
  }

  if (copiedRules.length) {
    state.rules.push(...copiedRules);
    state.revision++;
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
