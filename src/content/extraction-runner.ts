import type {
  ElementExtractionSpec,
  ExecutableElementExtractionRule,
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

function isElementRule(
  rule: ExecutableExtractionRule,
): rule is ExecutableElementExtractionRule {
  return ["text", "selection", "attribute"].includes(rule.extraction.type);
}

function selectorCandidates(rule: ExecutableElementExtractionRule): string[] {
  return Array.from(
    new Set([rule.selector, ...(rule.selectorFallbacks ?? [])].filter(Boolean)),
  );
}

function extractElementRule(
  rule: ExecutableElementExtractionRule,
  runtime: ExtractionRuntime,
): string {
  const diagnostics: string[] = [];

  for (const selector of selectorCandidates(rule)) {
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

      if (rule.pageUrl !== runtime.pageUrl) {
        throw new Error("Open the original source page.");
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
