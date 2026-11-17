import type {
  ElementExtractionSpec,
  ExecutableElementExtractionRule,
  ExecutableExtractionRule,
  ExecutablePageUrlExtractionRule,
  ExtractionRuleRunResult,
  SelectionExtraction,
} from "../shared/types/extraction";
import { activeSelectorVersion } from "../shared/selectors/repository";
import {
  createDOMSelectorRuntime,
  evaluateSelectorVersion,
  type SelectorRuntime,
} from "./selector-resolver";
import type {
  ExtractionSpec as SelectorExtractionSpec,
  SelectorLocator,
} from "../shared/types/selectors";
export {
  evaluateLocator,
  evaluatePart,
  evaluateRecipe,
  evaluateSelectorVersion,
} from "./selector-resolver";

export interface ExtractionRuntime {
  pageUrl: string;
  selectAll(selector: string): Element[];
  readElement(element: Element, extraction: ElementExtractionSpec): string;
  readSelectionFromPage?(extraction: SelectionExtraction): string;
  selectorRuntime?: SelectorRuntime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPageUrlRule(
  rule: ExecutableExtractionRule,
): rule is ExecutablePageUrlExtractionRule {
  return rule.extraction.type === "pageUrl";
}

function isElementRule(
  rule: ExecutableExtractionRule,
): rule is ExecutableElementExtractionRule {
  return ["text", "selection", "attribute"].includes(rule.extraction.type);
}

function selectorCandidates(rule: ExecutableElementExtractionRule): string[] {
  const fallbacks =
    rule.selectorFallbacks ?? rule.extraction.selectorFallbacks ?? [];
  return Array.from(new Set([rule.selector, ...fallbacks].filter(Boolean)));
}

function globalSelectionFallback(
  rule: ExecutableElementExtractionRule,
  runtime: ExtractionRuntime,
): string | null {
  if (
    rule.extraction.type !== "selection" ||
    !runtime.readSelectionFromPage
  ) {
    return null;
  }

  try {
    const raw = runtime.readSelectionFromPage(rule.extraction);
    return raw && raw.length <= 100000 ? raw : null;
  } catch {
    return null;
  }
}

function extractElementRule(
  rule: ExecutableElementExtractionRule,
  runtime: ExtractionRuntime,
): string {
  const candidates = selectorCandidates(rule);

  if (candidates.length === 1) {
    const elements = runtime.selectAll(candidates[0]);
    if (elements.length === 1) {
      try {
        return runtime.readElement(elements[0], rule.extraction);
      } catch (error) {
        const fallback = globalSelectionFallback(rule, runtime);
        if (fallback !== null) return fallback;
        throw error;
      }
    }

    const fallback = globalSelectionFallback(rule, runtime);
    if (fallback !== null) return fallback;
    throw new Error(`Selector matched ${elements.length} elements.`);
  }

  const diagnostics: string[] = [];

  for (const selector of candidates) {
    let elements: Element[];
    try {
      elements = runtime.selectAll(selector);
    } catch {
      diagnostics.push(`${selector}: invalid`);
      continue;
    }

    if (elements.length !== 1) {
      diagnostics.push(`${selector}: ${elements.length} matches`);
      continue;
    }

    try {
      const raw = runtime.readElement(elements[0], rule.extraction);
      if (!raw || raw.length > 100000) {
        diagnostics.push(`${selector}: empty/too large`);
        continue;
      }
      return raw;
    } catch (error) {
      diagnostics.push(`${selector}: ${errorMessage(error)}`);
    }
  }

  const fallback = globalSelectionFallback(rule, runtime);
  if (fallback !== null) return fallback;

  const detail = diagnostics.slice(0, 3).join("; ");
  throw new Error(
    detail
      ? `Could not resolve durable selector. ${detail}`
      : "Could not resolve durable selector.",
  );
}

export function runExtractionRules(
  rules: ExecutableExtractionRule[],
  runtime: ExtractionRuntime,
): ExtractionRuleRunResult[] {
  return rules.map((rule) => {
    try {
      if (rule.extraction.type === "pdfText") {
        throw new Error("PDF extraction rules run in the Burbot PDF reader.");
      }

      if ((rule.selectorTree?.selector.pageUrl ?? rule.pageUrl) !== runtime.pageUrl) {
        throw new Error("Open the original source page.");
      }

      if (rule.selectorTree) {
        const version = activeSelectorVersion(rule.selectorTree);
        if (!version)
          throw new Error("Selector has no active version. Approve a draft first.");
        const resolver = runtime.selectorRuntime ??
          (typeof document !== "undefined"
            ? createDOMSelectorRuntime(document)
            : {
                resolve: (locator: SelectorLocator) =>
                  locator.kind === "css_path" ? runtime.selectAll(locator.selector) : null,
                read: (target: Element | Range, extraction: SelectorExtractionSpec) =>
                  runtime.readElement(target as Element, (
                    extraction.type === "attribute"
                      ? { type: "attribute", attribute: extraction.name }
                      : extraction
                  ) as ElementExtractionSpec),
              });
        const evaluation = evaluateSelectorVersion(version, resolver);
        if (evaluation.status !== "success") return {
          ruleId: rule.id,
          error: `${evaluation.status}: ${evaluation.diagnostic ?? "Selector evaluation failed."}`,
          evaluation,
        };
        return { ruleId: rule.id, raw: evaluation.rawValue!, evaluation };
      }

      let raw: string;

      if (isPageUrlRule(rule)) {
        raw = runtime.pageUrl;
      } else if (isElementRule(rule)) {
        raw = extractElementRule(rule, runtime);
      } else {
        throw new Error("Unsupported webpage extraction rule.");
      }

      if (!raw || raw.length > 100000) {
        throw new Error("Extracted value is empty or too large.");
      }

      return { ruleId: rule.id, raw };
    } catch (error) {
      return { ruleId: rule.id, error: errorMessage(error) };
    }
  });
}
