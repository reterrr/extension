import { newSelectorUuid } from "../shared/selectors/uuid.js";
import type { LegacyStoredRule } from "../shared/types/legacy-storage";
import type {
  ExtractionSpec,
  SelectorEvaluationResult,
  SelectorLocator,
  SelectorPart,
  SelectorVersion,
} from "../shared/types/selectors";
import {
  elementLocatorKinds,
  maxBoundaryLength,
} from "../shared/selectors/evaluation.js";
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

const extractionLabels = {
  text: "Current element text (dynamic)",
  selection: "Exact selected text",
  text_between: "Text between markers (dynamic)",
  attribute: "Attribute value",
};

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
    const input = version.status === "draft" ? node("textarea") : undefined;
    const update = (edit: (draft: SelectorVersion) => void) => {
      if (!input) return;
      const draft = JSON.parse(input.value) as SelectorVersion;
      edit(draft);
      input.value = JSON.stringify(draft, null, 2);
      input.dispatchEvent(new Event("input"));
    };
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
        if (input) {
          const settings = node("details");
          settings.append(node("summary", "Change extraction method"));
          const method = node("select");
          const label = node("label", "Extraction method ");
          label.append(method);
          for (const [value, text] of Object.entries(extractionLabels))
            method.add(new Option(text, value));
          method.value = part.extraction.type;
          const field = (
            description: string,
            value: string,
            maxLength?: number,
          ) => {
            const label = node("label", description + " ");
            const input = node("input");
            input.value = value;
            if (maxLength) input.maxLength = maxLength;
            label.append(input);
            return { label, input };
          };
          const exact = field(
            "Original text",
            part.extraction.type === "selection"
              ? part.extraction.quote.exact
              : "",
          );
          const start = field(
            "Start marker",
            part.extraction.type === "text_between"
              ? part.extraction.start
              : "",
            maxBoundaryLength,
          );
          const end = field(
            "End marker",
            part.extraction.type === "text_between" ? part.extraction.end : "",
            maxBoundaryLength,
          );
          const attribute = field(
            "Attribute name",
            part.extraction.type === "attribute" ? part.extraction.name : "",
          );
          const hint = node("p");
          const refresh = () => {
            exact.label.hidden = method.value !== "selection";
            start.label.hidden = end.label.hidden =
              method.value !== "text_between";
            attribute.label.hidden = method.value !== "attribute";
            hint.textContent =
              {
                text: "Reads all current text from the located element. Preview the target before approval.",
                selection: "Requires the original text.",
                text_between:
                  "Reads the changing text inside one pair of markers in the located element.",
                attribute: "Reads the current value of the named attribute.",
              }[method.value] ?? "";
          };
          method.onchange = refresh;
          refresh();
          settings.append(
            label,
            exact.label,
            start.label,
            end.label,
            attribute.label,
            hint,
          );
          button(settings, "Set extraction method", () =>
            update((draft) => {
              const edited = draft.recipes
                .find(({ uuid }) => uuid === recipe.uuid)
                ?.parts.find(({ uuid }) => uuid === part.uuid);
              if (!edited)
                throw new Error("This part was removed from the draft.");
              const type = method.value as ExtractionSpec["type"];
              if (
                (type === "text" || type === "text_between") &&
                !edited.locators.some(
                  (locator) =>
                    elementLocatorKinds.includes(locator.kind) &&
                    (locator.kind !== "css_path" ||
                      !/^(?:html|body|head|:root)$/i.test(
                        locator.selector.trim(),
                      )),
                )
              ) {
                throw new Error(
                  "Add a locator for the intended element before using dynamic text.",
                );
              }
              switch (type) {
                case "text":
                  edited.extraction = { type };
                  break;
                case "selection":
                  if (!exact.input.value.trim())
                    throw new Error("Enter the original text.");
                  edited.extraction = {
                    type,
                    quote: { exact: exact.input.value },
                  };
                  break;
                case "text_between":
                  if (!start.input.value.trim() || !end.input.value.trim())
                    throw new Error("Enter both text markers.");
                  edited.extraction = {
                    type,
                    start: start.input.value,
                    end: end.input.value,
                  };
                  break;
                case "attribute":
                  if (!attribute.input.value.trim())
                    throw new Error("Enter the attribute name.");
                  edited.extraction = {
                    type,
                    name: attribute.input.value.trim(),
                  };
                  break;
              }
            }),
          );
          partRow.append(settings);
        }
        parts.append(partRow);
      }
      recipeRow.append(parts);
      list.append(recipeRow);
    }
    section.append(list);
    if (input) {
      const label = node(
        "label",
        "Draft definition (JSON) · save to View before approval and Commit; saving clears earlier draft diagnostics",
      );
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
