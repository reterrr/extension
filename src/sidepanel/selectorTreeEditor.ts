import { newSelectorUuid } from "../shared/selectors/uuid.js";
import type { LegacyStoredRule } from "../shared/types/legacy-storage";
import type {
  SelectorEvaluationResult,
  SelectorLocator,
  SelectorPart,
  SelectorVersion,
} from "../shared/types/selectors";
import {
  activeSelectorVersion,
  exportSelectorTree,
  ordered,
} from "../shared/selectors/repository";

interface EditorActions {
  write(op: string, payload: Record<string, unknown>): Promise<void>;
  evaluate(version: SelectorVersion): Promise<SelectorEvaluationResult>;
  error(error: unknown): void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderSelectorTreeEditor(
  root: HTMLElement,
  rule: LegacyStoredRule,
  actions: EditorActions,
): void {
  const tree = rule.selectorTree;
  if (!tree) return;
  root.classList.add("selector-tree-editor");
  const active = activeSelectorVersion(tree);
  root.append(
    node(
      "p",
      `Selector · Active version: ${active?.versionNo ?? "none"} · Target: ${tree.selector.target.objectId}.${tree.selector.target.field}`,
    ),
  );
  if (tree.selector.migration)
    root.append(
      node("small", "Migrated rule · Snapshot provenance unverified"),
    );
  const tools = node("div");
  const diagnostics = node("pre");
  diagnostics.className = "selector-diagnostics";
  diagnostics.setAttribute("aria-live", "polite");
  const last = rule.selectorEvaluations?.at(-1);
  if (last) diagnostics.textContent = JSON.stringify(last.result, null, 2);
  const button = (
    parent: HTMLElement,
    label: string,
    action: () => unknown | Promise<unknown>,
  ) => {
    const control = node("button", label);
    control.type = "button";
    control.onclick = async () => {
      control.disabled = true;
      try {
        await action();
      } catch (error) {
        actions.error(error);
      } finally {
        control.disabled = false;
      }
    };
    parent.append(control);
    return control;
  };
  const write = (op: string, payload: Record<string, unknown> = {}) =>
    actions.write(op, { ruleId: rule.id, objectId: rule.objectId, ...payload });
  button(tools, "Create draft", () => write("SELECTOR_CREATE_DRAFT"));
  button(tools, "Export selector JSON", () => {
    const url = URL.createObjectURL(
      new Blob([exportSelectorTree(tree)], { type: "application/json" }),
    );
    const link = node("a");
    link.href = url;
    link.download = `selector-${tree.selector.uuid}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  root.append(tools);
  const run = async (version: SelectorVersion, persist = false) => {
    const result = await actions.evaluate(version);
    diagnostics.textContent = JSON.stringify(result, null, 2);
    if (persist)
      await write("SELECTOR_RECORD_EVALUATIONS", {
        evaluations: [{ ruleId: rule.id, evaluation: result }],
        pageUrl: rule.pageUrl,
      });
  };
  for (const version of [...tree.versions].sort(
    (a, b) => b.versionNo - a.versionNo,
  )) {
    const section = node("details");
    section.open = version.status === "draft" || version.status === "active";
    section.append(
      node("summary", `Version ${version.versionNo} · ${version.status}`),
    );
    const versionTools = node("div");
    let approve: HTMLButtonElement | undefined;
    button(versionTools, "Test version", () => run(version, true));
    if (version.status === "draft") {
      approve = button(versionTools, "Approve draft", () =>
        write("SELECTOR_ACTIVATE_DRAFT", { versionUuid: version.uuid }),
      );
      button(versionTools, "Reject draft", () =>
        write("SELECTOR_REJECT_DRAFT", { versionUuid: version.uuid }),
      );
    }
    section.append(versionTools);
    const list = node("ol");
    for (const recipe of ordered(version.recipes)) {
      const recipeRow = node("li", `Recipe #${recipe.order + 1}`);
      button(recipeRow, "Test recipe", () =>
        run({ ...version, recipes: [recipe] }),
      );
      const parts = node("ol");
      for (const part of ordered(recipe.parts)) {
        const partRow = node(
          "li",
          `Part #${part.order + 1} · ${part.extraction.type} · separator ${JSON.stringify(part.joinWith ?? "")}`,
        );
        const locators = node("ol");
        for (const locator of ordered(part.locators)) {
          const row = node("li");
          row.append(
            node(
              "code",
              `${locator.kind}: ${locator.kind === "css_path" ? locator.selector : locator.kind === "xpath" ? locator.expression : locator.kind === "element_id" ? locator.elementId : locator.kind === "text_quote" ? JSON.stringify(locator.quote) : JSON.stringify(locator.payload)}`,
            ),
          );
          button(row, "Test locator", () =>
            run({
              ...version,
              recipes: [
                { ...recipe, parts: [{ ...part, locators: [locator] }] },
              ],
            }),
          );
          locators.append(row);
        }
        partRow.append(locators);
        parts.append(partRow);
      }
      recipeRow.append(parts);
      list.append(recipeRow);
    }
    section.append(list);
    if (version.status === "draft") {
      const label = node(
        "label",
        "Draft definition (JSON) · save to View before approval and Commit; saving clears earlier draft diagnostics",
      );
      const input = node("textarea");
      input.rows = 18;
      input.spellcheck = false;
      input.setAttribute(
        "aria-label",
        `Draft version ${version.versionNo} JSON`,
      );
      input.value = JSON.stringify(version, null, 2);
      const savedInput = input.value;
      input.oninput = () => {
        if (approve) approve.disabled = input.value !== savedInput;
      };
      label.append(input);
      section.append(label);
      const editTools = node("div");
      const update = (edit: (draft: SelectorVersion) => void) => {
        const draft = JSON.parse(input.value) as SelectorVersion;
        edit(draft);
        input.value = JSON.stringify(draft, null, 2);
        input.dispatchEvent(new Event("input"));
      };
      const part = (): SelectorPart => ({
        uuid: newSelectorUuid(),
        order: 0,
        extraction: { type: "text" },
        locators: [
          {
            uuid: newSelectorUuid(),
            order: 0,
            kind: "css_path",
            selector: "body",
          },
        ],
      });
      button(editTools, "Add recipe", () =>
        update((draft) =>
          draft.recipes.push({
            uuid: newSelectorUuid(),
            order: Math.max(...draft.recipes.map((recipe) => recipe.order)) + 1,
            parts: [part()],
          }),
        ),
      );
      button(editTools, "Add part to last recipe", () =>
        update((draft) => {
          const recipe = ordered(draft.recipes).at(-1)!;
          recipe.parts.push({
            ...part(),
            order: Math.max(...recipe.parts.map((item) => item.order)) + 1,
          });
        }),
      );
      button(editTools, "Add locator to last part", () =>
        update((draft) => {
          const item = ordered(ordered(draft.recipes).at(-1)!.parts).at(-1)!;
          const locator: SelectorLocator = {
            uuid: newSelectorUuid(),
            kind: "css_path",
            selector: "body",
            order: Math.max(...item.locators.map((entry) => entry.order)) + 1,
          };
          item.locators.push(locator);
        }),
      );
      button(editTools, "Remove last locator", () =>
        update((draft) => {
          const item = ordered(ordered(draft.recipes).at(-1)!.parts).at(-1)!;
          if (item.locators.length <= 1)
            throw new Error("Keep at least one locator per part.");
          const last = ordered(item.locators).at(-1)!;
          item.locators = item.locators.filter(
            (locator) => locator.uuid !== last.uuid,
          );
        }),
      );
      button(editTools, "Save draft to View", () =>
        write("SELECTOR_SAVE_DRAFT", { version: JSON.parse(input.value) }),
      );
      button(editTools, "Test edited draft", () =>
        run(JSON.parse(input.value)),
      );
      section.append(editTools);
    }
    root.append(section);
  }
  const importSection = node("details");
  importSection.append(node("summary", "Import selector JSON"));
  const imported = node("textarea");
  imported.rows = 8;
  imported.setAttribute("aria-label", "Selector JSON import");
  importSection.append(imported);
  button(importSection, "Import to View", () =>
    write("SELECTOR_IMPORT_TREE", { tree: JSON.parse(imported.value) }),
  );
  root.append(importSection, diagnostics);
}
