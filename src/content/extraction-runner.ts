import type {
  ElementExtractionSpec,
  ExecutableExtractionRule,
  ExecutablePageUrlExtractionRule,
  ExtractionRuleRunResult,
} from "../shared/types/extraction";

export interface ExtractionRuntime {
  pageUrl: string;
  selectAll(selector: string): Element[];
  readElement(element: Element, extraction: ElementExtractionSpec): string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPageUrlRule(
  rule: ExecutableExtractionRule,
): rule is ExecutablePageUrlExtractionRule {
  return rule.extraction.type === "pageUrl";
}

export function runExtractionRules(
  rules: ExecutableExtractionRule[],
  runtime: ExtractionRuntime,
): ExtractionRuleRunResult[] {
  return rules.map((rule) => {
    try {
      if (rule.pageUrl !== runtime.pageUrl) {
        throw new Error("Open the original source page.");
      }

      let raw: string;

      if (isPageUrlRule(rule)) {
        raw = runtime.pageUrl;
      } else {
        const elements = runtime.selectAll(rule.selector);

        if (elements.length !== 1) {
          throw new Error(`Selector matched ${elements.length} elements.`);
        }

        raw = runtime.readElement(elements[0], rule.extraction);
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
