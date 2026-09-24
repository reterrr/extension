import { importDocumentIntoState } from "./format";
import type { ImportApprovalPlan } from "./review";
import type {
  LegacyStorageState,
  LegacyStoredObject,
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
  updatedExisting: boolean;
}

function cloneState(state: LegacyStorageState): LegacyStorageState {
  return JSON.parse(JSON.stringify(state)) as LegacyStorageState;
}

function ruleTargetKey(target?: { kind: string; id: string }): string {
  return target?.kind && target.kind !== "object"
    ? `${target.kind}:${target.id}`
    : "object";
}

function reviewedRuleForTarget(
  reviewedRule: ReviewedImportRule,
  objectId: string,
  fundingIdByImportKey: Map<string, string>,
  referencePatches: ImportApprovalPlan["referencePatches"],
  uuid: () => string,
  now: string,
): LegacyStoredRule {
  let target = reviewedRule.target;

  if (target?.kind === "funding") {
    if (!reviewedRule.targetImportKey) {
      throw new Error("Could not remap reviewed funding extraction rule.");
    }
    const fundingId = fundingIdByImportKey.get(reviewedRule.targetImportKey);
    if (!fundingId) {
      throw new Error(
        `Could not resolve reviewed financing variant ${reviewedRule.targetImportKey}.`,
      );
    }
    target = { kind: "funding", id: fundingId };
  } else if (target?.kind && target.kind !== "object") {
    throw new Error(`Unsupported reviewed extraction target: ${target.kind}.`);
  }

  const referencePatch =
    !target || target.kind === "object"
      ? referencePatches.find(
          (patch) => patch.field === reviewedRule.field,
        )
      : undefined;
  const transform =
    reviewedRule.transform && referencePatch
      ? { ...reviewedRule.transform, value: referencePatch.targetObjectId }
      : reviewedRule.transform;

  const { targetImportKey: _targetImportKey, ...rule } = reviewedRule;
  return {
    ...rule,
    ...(transform ? { transform } : { transform: undefined }),
    id: uuid(),
    objectId,
    ...(target?.kind && target.kind !== "object"
      ? { target }
      : { target: undefined }),
    createdAt: now,
  };
}

function replaceReviewedRules(
  state: LegacyStorageState,
  objectId: string,
  plan: ImportApprovalPlanWithRules,
  fundingIdByImportKey: Map<string, string>,
  uuid: () => string,
  now: string,
): void {
  for (const reviewedRule of plan.reviewRules ?? []) {
    const copied = reviewedRuleForTarget(
      reviewedRule,
      objectId,
      fundingIdByImportKey,
      plan.referencePatches,
      uuid,
      now,
    );
    const targetKey = ruleTargetKey(copied.target);
    state.rules = state.rules.filter(
      (rule) =>
        !(
          rule.objectId === objectId &&
          rule.field === copied.field &&
          ruleTargetKey(rule.target) === targetKey
        ),
    );
    state.rules.push(copied);
  }
}

function nextVariantNo(
  state: LegacyStorageState,
  objectId: string,
  companySize: string,
): number {
  return (
    Math.max(
      0,
      ...(state.financingRules ?? [])
        .filter(
          (row) =>
            row.objectId === objectId &&
            String(row.company_size) === companySize,
        )
        .map((row) => Number(row.variant_no) || 0),
    ) + 1
  );
}

function stageExistingObjectUpdate(
  original: LegacyStorageState,
  plan: ImportApprovalPlanWithRules,
  uuid: () => string,
  now: string,
): StagedImportReviewResult {
  const targetId = plan.existingTargetObjectId;
  if (!targetId) throw new Error("Existing update target is missing.");

  const currentTarget = original.objects.find((object) => object.id === targetId);
  if (!currentTarget) {
    throw new Error("The existing object is no longer present in the active commit.");
  }

  const importedState = importDocumentIntoState(
    BurbotCore.empty(),
    plan.document,
    0,
    uuid,
    now,
  );
  const importedObject = importedState.objects.find(
    (object) => object.importKey === plan.selectedImportKey,
  );
  if (!importedObject) {
    throw new Error("Could not resolve the reviewed object after import.");
  }
  if (importedObject.type !== currentTarget.type) {
    throw new Error("Imported object type does not match the existing object.");
  }

  const state = cloneState(original);
  const target = state.objects.find((object) => object.id === targetId)!;
  const schema = BurbotSchema[target.type];

  for (const patch of plan.referencePatches) {
    if (!state.objects.some((object) => object.id === patch.targetObjectId)) {
      throw new Error(
        "A referenced approved object is no longer in the active commit.",
      );
    }
  }

  if (importedState.importSources?.length) {
    (state.importSources ||= []).push(...importedState.importSources);
  }

  const referenceByField = new Map(
    plan.referencePatches.map((patch) => [patch.field, patch.targetObjectId]),
  );
  const fields = plan.selectedDataFields.length
    ? plan.selectedDataFields
    : Object.keys(importedObject.values);

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(importedObject.values, field)) {
      continue;
    }
    const definition = schema?.fields?.[field];
    if (!definition) continue;

    const referenceValue =
      definition.type === "reference" ? referenceByField.get(field) : undefined;
    target.values[field] =
      referenceValue ?? importedObject.values[field];

    if (target.manualFields) delete target.manualFields[field];

    if (importedObject.evidence?.[field]?.length) {
      (target.evidence ||= {})[field] = importedObject.evidence[field];
    } else if (target.evidence?.[field]) {
      // An approved imported value without evidence must not keep provenance
      // for the old value.
      delete target.evidence[field];
    }
  }

  if (target.evidence && !Object.keys(target.evidence).length) {
    delete target.evidence;
  }
  if (target.manualFields && !Object.keys(target.manualFields).length) {
    delete target.manualFields;
  }

  if (!target.importKey) target.importKey = plan.selectedImportKey;
  if (importedObject.sourceUrl) target.sourceUrl = importedObject.sourceUrl;
  if (schema?.primary && BurbotCore.hasValue(target.values[schema.primary])) {
    target.label = String(target.values[schema.primary]);
  }
  target.updatedAt = now;

  const fundingIdByImportKey = new Map<string, string>();
  const importedTargetIdMap = new Map<string, string>();
  const importedFunding = (importedState.financingRules ?? []).filter(
    (row) => row.objectId === importedObject.id,
  );

  for (const importedRow of importedFunding) {
    const importKey = String(importedRow.importKey ?? "");
    if (!importKey) continue;
    const selectedFields =
      plan.financingFieldsByImportKey[importKey] ??
      Object.keys(BurbotFunding.fields).filter((field) =>
        Object.prototype.hasOwnProperty.call(importedRow, field),
      );

    let row = (state.financingRules ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        String(candidate.importKey ?? "") === importKey,
    );

    if (!row) {
      const legacyCandidates = (state.financingRules ?? []).filter(
        (candidate) =>
          candidate.objectId === target.id &&
          !candidate.importKey &&
          String(candidate.company_size) ===
            String(importedRow.company_size) &&
          Number(candidate.variant_no) === Number(importedRow.variant_no),
      );
      if (legacyCandidates.length === 1) {
        row = legacyCandidates[0];
        row.importKey = importKey;
      }
    }

    if (!row) {
      row = {
        id: uuid(),
        objectId: target.id,
        importKey,
        company_size: importedRow.company_size,
        variant_no: nextVariantNo(
          state,
          target.id,
          String(importedRow.company_size),
        ),
        own_contribution_form: "UNSPECIFIED",
      };
      (state.financingRules ||= []).push(row);
    } else {
      row.company_size = importedRow.company_size;
    }

    for (const field of selectedFields) {
      if (Object.prototype.hasOwnProperty.call(importedRow, field)) {
        row[field] = importedRow[field];
      }
    }
    fundingIdByImportKey.set(importKey, String(row.id));
    importedTargetIdMap.set(
      `funding:${String(importedRow.id)}`,
      String(row.id),
    );
  }

  const importedFiles = (importedState.fileSources ?? []).filter(
    (file) => file.objectId === importedObject.id,
  );
  for (const importedFile of importedFiles) {
    let targetFile = (state.fileSources ?? []).find(
      (file) => file.objectId === target.id && file.url === importedFile.url,
    );
    if (targetFile) {
      targetFile.name = importedFile.name;
      targetFile.sourcePageUrl = importedFile.sourcePageUrl;
      targetFile.sourceImportKey = importedFile.sourceImportKey;
      targetFile.sourcePageImportKey = importedFile.sourcePageImportKey;
      targetFile.addedAt = now;

      for (const field of [
        "document_kind",
        "purpose",
        "has_fields",
        "intended_use",
        "client_requirement",
        "signature_requirement",
        "delivery_method",
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(importedFile, field)) {
          (targetFile as unknown as Record<string, unknown>)[field] =
            importedFile[field];
        }
      }
    } else {
      targetFile = {
        ...importedFile,
        id: uuid(),
        objectId: target.id,
        addedAt: now,
      };
      (state.fileSources ||= []).push(targetFile);
    }

    importedTargetIdMap.set(
      `file_source:${String(importedFile.id)}`,
      String(targetFile.id),
    );
  }

  const importedGeography = (importedState.geographies ?? []).filter(
    (row) => row.objectId === importedObject.id,
  );
  for (const importedRow of importedGeography) {
    let row = (state.geographies ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        importedRow.importKey &&
        candidate.importKey === importedRow.importKey,
    );
    row ??= (state.geographies ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        candidate.type === importedRow.type &&
        candidate.role === importedRow.role &&
        candidate.value === importedRow.value,
    );
    if (row) {
      row.importKey = importedRow.importKey;
      row.type = importedRow.type;
      row.role = importedRow.role;
      row.value = importedRow.value;
    } else {
      row = {
        ...importedRow,
        id: uuid(),
        objectId: target.id,
      };
      (state.geographies ||= []).push(row);
    }
    importedTargetIdMap.set(
      `geography:${String(importedRow.id)}`,
      String(row.id),
    );
  }

  const importedContacts = (importedState.operatorContacts ?? []).filter(
    (row) => row.objectId === importedObject.id,
  );
  for (const importedRow of importedContacts) {
    let row = (state.operatorContacts ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        importedRow.importKey &&
        candidate.importKey === importedRow.importKey,
    );
    row ??= (state.operatorContacts ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        candidate.kind === importedRow.kind &&
        Number(candidate.variant_no) === Number(importedRow.variant_no),
    );
    if (row) {
      row.importKey = importedRow.importKey;
      row.kind = importedRow.kind;
      row.variant_no = importedRow.variant_no;
      row.value = importedRow.value;
    } else {
      row = {
        ...importedRow,
        id: uuid(),
        objectId: target.id,
      };
      (state.operatorContacts ||= []).push(row);
    }
    importedTargetIdMap.set(
      `operator_contact:${String(importedRow.id)}`,
      String(row.id),
    );
  }

  const importedDocuments = (importedState.documentRequirements ?? []).filter(
    (row) => row.objectId === importedObject.id,
  );
  for (const importedRow of importedDocuments) {
    let row = (state.documentRequirements ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        importedRow.importKey &&
        candidate.importKey === importedRow.importKey,
    );
    row ??= (state.documentRequirements ?? []).find(
      (candidate) =>
        candidate.objectId === target.id &&
        candidate.document_type_key === importedRow.document_type_key,
    );
    if (!row) {
      row = {
        id: uuid(),
        objectId: target.id,
        importKey: importedRow.importKey,
        document_type_key: importedRow.document_type_key,
      };
      (state.documentRequirements ||= []).push(row);
    } else {
      row.importKey = importedRow.importKey;
      row.document_type_key = importedRow.document_type_key;
    }

    for (const field of Object.keys(BurbotDocuments.fields ?? {})) {
      if (Object.prototype.hasOwnProperty.call(importedRow, field)) {
        row[field] = importedRow[field];
      }
    }
    importedTargetIdMap.set(
      `document:${String(importedRow.document_type_key)}`,
      String(row.document_type_key),
    );
  }

  const importedNestedEvidence = (importedState.importTargetEvidence ?? []).filter(
    (entry) => entry.objectId === importedObject.id,
  );
  for (const evidence of importedNestedEvidence) {
    const mappedTargetId = importedTargetIdMap.get(
      `${evidence.target.kind}:${String(evidence.target.id)}`,
    );
    if (!mappedTargetId) continue;

    state.importTargetEvidence = (state.importTargetEvidence ?? []).filter(
      (entry) =>
        !(
          entry.objectId === target.id &&
          entry.field === evidence.field &&
          entry.target.kind === evidence.target.kind &&
          String(entry.target.id) === mappedTargetId
        ),
    );
    (state.importTargetEvidence ||= []).push({
      ...evidence,
      id: uuid(),
      objectId: target.id,
      target: {
        kind: evidence.target.kind,
        id: mappedTargetId,
      },
    });
  }

  replaceReviewedRules(
    state,
    target.id,
    plan,
    fundingIdByImportKey,
    uuid,
    now,
  );

  state.revision++;
  return {
    state,
    stagedObjectId: target.id,
    updatedExisting: true,
  };
}

function stageNewObject(
  original: LegacyStorageState,
  plan: ImportApprovalPlanWithRules,
  uuid: () => string,
  now: string,
): StagedImportReviewResult {
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
      throw new Error(
        "A referenced approved object is no longer in the active commit.",
      );
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

  const fundingIdByImportKey = new Map(
    (state.financingRules ?? [])
      .filter((row) => row.objectId === selected.id && row.importKey)
      .map((row) => [String(row.importKey), String(row.id)]),
  );

  if (plan.reviewRules?.length) {
    replaceReviewedRules(
      state,
      selected.id,
      plan,
      fundingIdByImportKey,
      uuid,
      now,
    );
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

  return {
    state,
    stagedObjectId: selected.id,
    updatedExisting: false,
  };
}

export function stageImportReviewObject(
  original: LegacyStorageState,
  plan: ImportApprovalPlanWithRules,
  uuid: () => string,
  now: string,
): StagedImportReviewResult {
  if (plan.existingTargetObjectId) {
    return stageExistingObjectUpdate(original, plan, uuid, now);
  }

  // Backward compatibility for older review sessions/plans: if the same
  // stable key is already present, treat it as an update instead of creating
  // a duplicate.
  const sameKey = original.objects.filter(
    (object) => object.importKey === plan.selectedImportKey,
  );
  if (sameKey.length > 1) {
    throw new Error(
      `More than one object uses import key ${plan.selectedImportKey}; choose the target explicitly before importing.`,
    );
  }
  if (sameKey.length === 1) {
    return stageExistingObjectUpdate(
      original,
      {
        ...plan,
        existingTargetObjectId: sameKey[0].id,
      },
      uuid,
      now,
    );
  }

  return stageNewObject(original, plan, uuid, now);
}
