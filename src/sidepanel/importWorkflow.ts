import { publishUiState } from "../shared/api/storage";
import {
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import {
  buildImportApprovalPlan,
  markImportObjectLinked,
  markImportObjectStaged,
} from "../shared/import/review";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import {
  stageImportReviewObject,
  type ImportApprovalPlanWithRules,
  type ReviewedImportRule,
} from "../shared/import/stageReview";
import {
  addObjectToView,
  normalizeObjectView,
  OBJECT_VIEW_STORAGE_KEY,
} from "../shared/search/objectView.js";
import type { ImportReviewSession } from "../shared/types/importReview";
import type { LegacyStoredRule } from "../shared/types/legacy-storage";

function reviewedRules(
  current: ImportReviewSession,
  objectId: string,
): ReviewedImportRule[] {
  return current.previewState.rules
    .filter((rule) => rule.objectId === objectId)
    .map((rule: LegacyStoredRule) => {
      if (rule.target?.kind !== "funding") return { ...rule };
      const row = (current.previewState.financingRules ?? []).find(
        (entry) =>
          entry.objectId === objectId && String(entry.id) === rule.target!.id,
      );
      if (!row?.importKey) {
        throw new Error("Nie udało się zmapować reguły wariantu finansowania.");
      }
      return { ...rule, targetImportKey: String(row.importKey) };
    });
}

async function ensureDraft(): Promise<
  NonNullable<Awaited<ReturnType<typeof readActiveDraft>>>
> {
  let draft = await readActiveDraft();
  if (draft) return draft;

  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op: "ENSURE",
  })) as { ok?: boolean; error?: string };
  if (!response?.ok) {
    throw new Error(response?.error ?? "Nie udało się rozpocząć commita.");
  }
  draft = await readActiveDraft();
  if (!draft) throw new Error("Nie udało się utworzyć aktywnego commita.");
  return draft;
}

async function keepStagedObjectInView(
  objectId: string,
  objects: Array<{ id: string }>,
): Promise<void> {
  const stored = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
  const current = normalizeObjectView(
    stored[OBJECT_VIEW_STORAGE_KEY],
    objects,
  );
  if (!current) return;

  const next = addObjectToView(
    current,
    objectId,
    objects,
    new Date().toISOString(),
  );
  if (next) {
    await browser.storage.session.set({
      [OBJECT_VIEW_STORAGE_KEY]: next,
    });
  }
}

export async function stageImportedObjectToCommit(
  previewObjectId: string,
): Promise<{ stagedObjectId: string }> {
  const current = await readImportReview();
  if (!current) throw new Error("Nie ma aktywnego importu.");

  const status = current.statusByObjectId[previewObjectId] ?? "PENDING";
  if (status !== "IN_VIEW") {
    throw new Error(
      status === "STAGED"
        ? "Ten obiekt jest już w commicie."
        : "Najpierw zaakceptuj obiekt do Widoku.",
    );
  }

  const draft = await ensureDraft();
  const plan: ImportApprovalPlanWithRules = {
    ...buildImportApprovalPlan(
      current,
      previewObjectId,
      draft.workingState,
    ),
    reviewRules: reviewedRules(current, previewObjectId),
  };
  const now = new Date().toISOString();
  const staged = stageImportReviewObject(
    draft.workingState,
    plan,
    () => crypto.randomUUID(),
    now,
  );

  draft.workingState = staged.state;
  draft.updatedAt = now;
  await writeActiveDraft(draft);
  await publishUiState(draft.workingState);

  for (const link of plan.existingReferenceLinks) {
    markImportObjectLinked(
      current,
      link.importKey,
      link.targetObjectId,
      now,
    );
  }
  markImportObjectStaged(
    current,
    previewObjectId,
    staged.stagedObjectId,
    now,
  );
  await writeImportReview(current);
  await keepStagedObjectInView(
    staged.stagedObjectId,
    staged.state.objects,
  );

  window.dispatchEvent(new Event("burbot:commit-changed"));
  window.dispatchEvent(
    new CustomEvent("burbot:import-review-changed"),
  );
  window.dispatchEvent(new Event("burbot:object-view-changed"));
  return { stagedObjectId: staged.stagedObjectId };
}

export async function ensureObjectEditableInCommit(
  objectId: string,
): Promise<void> {
  await ensureDraft();
  const window = await browser.windows.getCurrent();
  if (window.id === undefined) throw new Error("Nie udało się ustalić okna.");

  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op: "FOCUS",
    windowId: window.id,
    objectId,
  })) as { ok?: boolean; error?: string };
  if (!response?.ok) {
    throw new Error(response?.error ?? "Nie udało się otworzyć obiektu.");
  }
  window.dispatchEvent(new Event("burbot:commit-changed"));
}
