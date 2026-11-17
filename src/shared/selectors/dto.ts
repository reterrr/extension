import type {
  CreateSelectorDTO,
  CreateSelectorVersionDTO,
  SelectorTree,
} from "../types/selectors";
import { validateSelectorTree } from "./validation.js";

/** Future transport boundary; local migration/evaluation data never reaches it. */
export function selectorTreeDTO(tree: SelectorTree): {
  selector: CreateSelectorDTO;
  versions: CreateSelectorVersionDTO[];
} {
  validateSelectorTree(tree);
  const { migration: _migration, ...selector } = structuredClone(tree.selector);
  return { selector, versions: structuredClone(tree.versions) };
}
