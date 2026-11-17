import { newSelectorUuid } from "./uuid.js";
import type {
  LegacyStorageState,
  LegacyStoredRule,
} from "../types/legacy-storage";
import type {
  SelectorTree,
  SelectorVersion,
  SelectorEvaluationResult,
} from "../types/selectors";
import {
  validateSelectorTree,
  validateSelectorTransition,
  validateSelectorEvaluation,
} from "./validation.js";
import { migrateLegacySelectors } from "./migration.js";

export const SELECTOR_WRITE_OPERATIONS = [
  "SELECTOR_CREATE_DRAFT",
  "SELECTOR_SAVE_DRAFT",
  "SELECTOR_ACTIVATE_DRAFT",
  "SELECTOR_REJECT_DRAFT",
  "SELECTOR_IMPORT_TREE",
  "SELECTOR_RECORD_EVALUATIONS",
] as const;

export const ordered = <T extends { order: number }>(
  items: readonly T[],
): T[] => [...items].sort((a, b) => a.order - b.order);

export function activeSelectorVersion(
  tree: SelectorTree,
): SelectorVersion | undefined {
  return tree.versions.find(
    (version) =>
      version.uuid === tree.selector.activeVersionUuid &&
      version.status === "active",
  );
}

export function createSelectorDraft(
  tree: SelectorTree,
  now = new Date().toISOString(),
): SelectorTree {
  validateSelectorTree(tree);
  const next = structuredClone(tree);
  const source = activeSelectorVersion(next) ?? next.versions.at(-1)!;
  const draft = structuredClone(source);
  draft.uuid = newSelectorUuid();
  draft.versionNo =
    Math.max(...next.versions.map((version) => version.versionNo)) + 1;
  draft.status = "draft";
  draft.createdAt = now;
  delete draft.reviewedAt;
  delete draft.reviewedBy;
  for (const recipe of draft.recipes) {
    recipe.uuid = newSelectorUuid();
    for (const part of recipe.parts) {
      part.uuid = newSelectorUuid();
      for (const locator of part.locators) locator.uuid = newSelectorUuid();
    }
  }
  next.versions.push(draft);
  validateSelectorTransition(tree, next);
  return next;
}

export function saveSelectorDraft(
  tree: SelectorTree,
  version: SelectorVersion,
): SelectorTree {
  const previous = tree.versions.find((item) => item.uuid === version.uuid);
  if (!previous || previous.status !== "draft" || version.status !== "draft")
    throw new Error("Only a draft version can be edited.");
  const next = structuredClone(tree);
  next.versions[next.versions.findIndex((item) => item.uuid === version.uuid)] =
    structuredClone(version);
  validateSelectorTransition(tree, next);
  return next;
}

export function reviewSelectorDraft(
  tree: SelectorTree,
  versionUuid: string,
  approve: boolean,
  now = new Date().toISOString(),
): SelectorTree {
  const next = structuredClone(tree);
  const draft = next.versions.find((version) => version.uuid === versionUuid);
  if (!draft || draft.status !== "draft")
    throw new Error("Review requires a draft version.");
  draft.status = approve ? "active" : "rejected";
  draft.reviewedAt = now;
  if (approve) {
    const active = activeSelectorVersion(next);
    if (active && active.uuid !== draft.uuid) active.status = "superseded";
    next.selector.activeVersionUuid = draft.uuid;
  }
  validateSelectorTransition(tree, next);
  return next;
}

export function exportSelectorTree(tree: SelectorTree): string {
  validateSelectorTree(tree);
  return JSON.stringify(tree, null, 2);
}

export function importSelectorTree(value: string | unknown): SelectorTree {
  const tree =
    typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  validateSelectorTree(tree);
  return tree as SelectorTree;
}

/** All writes remain ordinary rule attachments in the existing View/Commit flow. */
export function mutateSelectorState(
  original: LegacyStorageState,
  message: Record<string, unknown>,
  now: string,
): LegacyStorageState {
  if (message.expectedRevision !== original.revision)
    throw new Error("Data changed. Refresh the selector editor.");
  const state = structuredClone(original);
  migrateLegacySelectors(state);
  let rule = state.rules.find(
    (row) => row.id === message.ruleId && row.objectId === message.objectId,
  );
  if (message.op === "SELECTOR_IMPORT_TREE") {
    const imported = importSelectorTree(message.tree);
    if (
      imported.selector.target.objectId !== message.objectId ||
      !state.objects.some((object) => object.id === message.objectId)
    )
      throw new Error("Imported selector must target this workspace object.");
    rule = state.rules.find(
      (row) => row.selectorTree?.selector.uuid === imported.selector.uuid,
    );
    if (rule) {
      validateSelectorTransition(rule.selectorTree, imported);
      const changedDrafts = new Set(
        rule
          .selectorTree!.versions.filter(
            (version) =>
              version.status === "draft" &&
              JSON.stringify(version.recipes) !==
                JSON.stringify(
                  imported.versions.find((item) => item.uuid === version.uuid)
                    ?.recipes,
                ),
          )
          .map((version) => version.uuid),
      );
      if (rule.selectorEvaluations)
        rule.selectorEvaluations = rule.selectorEvaluations.filter(
          (entry) => !changedDrafts.has(entry.result.selectorVersionUuid),
        );
      rule.selectorTree = imported;
      rule.pageUrl = imported.selector.pageUrl ?? rule.pageUrl;
    } else {
      const part = (activeSelectorVersion(imported) ?? imported.versions[0])
        .recipes[0].parts[0];
      const css = part.locators.find((locator) => locator.kind === "css_path");
      rule = {
        id: newSelectorUuid(),
        objectId: imported.selector.target.objectId,
        field: imported.selector.target.field,
        target: imported.selector.target.target,
        pageUrl: imported.selector.pageUrl ?? "",
        selector: css?.kind === "css_path" ? css.selector : "body",
        extraction: { type: "text" },
        createdAt: now,
        selectorTree: imported,
      } as LegacyStoredRule;
      state.rules.push(rule);
    }
  } else {
    if (message.op === "SELECTOR_RECORD_EVALUATIONS") {
      if (!Array.isArray(message.evaluations))
        throw new Error("Invalid selector evaluations.");
      for (const entry of message.evaluations as Array<{
        ruleId: string;
        evaluation: SelectorEvaluationResult;
      }>) {
        const targetRule = state.rules.find(
          (item) =>
            item.id === entry.ruleId && item.objectId === message.objectId,
        );
        if (
          !targetRule?.selectorTree ||
          !targetRule.selectorTree.versions.some(
            (version) => version.uuid === entry.evaluation?.selectorVersionUuid,
          )
        )
          throw new Error("Evaluation belongs to an unknown selector version.");
        validateSelectorEvaluation(
          entry.evaluation,
          targetRule.selectorTree.versions.find(
            (version) => version.uuid === entry.evaluation.selectorVersionUuid,
          )!,
        );
        targetRule.selectorEvaluations = [
          ...(targetRule.selectorEvaluations ?? []),
          {
            uuid: newSelectorUuid(),
            evaluatedAt: now,
            pageUrl: String(message.pageUrl ?? targetRule.pageUrl),
            result: structuredClone(entry.evaluation),
          },
        ].slice(-20);
      }
      state.revision++;
      return state;
    }
    if (!rule?.selectorTree) throw new Error("Selector rule was not found.");
    if (message.op === "SELECTOR_CREATE_DRAFT")
      rule.selectorTree = createSelectorDraft(rule.selectorTree, now);
    else if (message.op === "SELECTOR_SAVE_DRAFT") {
      rule.selectorTree = saveSelectorDraft(
        rule.selectorTree,
        message.version as SelectorVersion,
      );
      if (rule.selectorEvaluations)
        rule.selectorEvaluations = rule.selectorEvaluations.filter(
          (entry) =>
            entry.result.selectorVersionUuid !==
            (message.version as SelectorVersion).uuid,
        );
    } else if (
      message.op === "SELECTOR_ACTIVATE_DRAFT" ||
      message.op === "SELECTOR_REJECT_DRAFT"
    )
      rule.selectorTree = reviewSelectorDraft(
        rule.selectorTree,
        String(message.versionUuid),
        message.op === "SELECTOR_ACTIVATE_DRAFT",
        now,
      );
    else throw new Error("Unsupported selector operation.");
  }
  state.revision++;
  return state;
}
