export type ExtractionRuleId = string | number;
export type RuntimeExtractionRuleId = string;

export type SupportedExtractionAttribute =
  | "href"
  | "src"
  | "datetime"
  | "title"
  | "alt"
  | "content";

export interface TextExtraction {
  type: "text";
}

export interface AttributeExtraction {
  type: "attribute";
  attribute: SupportedExtractionAttribute;
}

export interface SelectionQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface SelectionExtraction {
  type: "selection";
  quote: SelectionQuote;
}

export interface PageUrlExtraction {
  type: "pageUrl";
}

export type ElementExtractionSpec =
  | TextExtraction
  | AttributeExtraction
  | SelectionExtraction;

export type ExtractionSpec = ElementExtractionSpec | PageUrlExtraction;

interface ExtractionRuleBase {
  id?: ExtractionRuleId;
  pageUrl: string;
}

export interface ElementExtractionRule extends ExtractionRuleBase {
  selector: string;
  extraction: ElementExtractionSpec;
}

export interface PageUrlExtractionRule extends ExtractionRuleBase {
  selector: null;
  extraction: PageUrlExtraction;
}

/**
 * Durable extraction definition. `raw` is intentionally absent: raw text is an
 * execution result, not part of the rule definition.
 */
export type ExtractionRule = ElementExtractionRule | PageUrlExtractionRule;

export type ExecutableElementExtractionRule = Omit<
  ElementExtractionRule,
  "id"
> & { id: RuntimeExtractionRuleId };

export type ExecutablePageUrlExtractionRule = Omit<
  PageUrlExtractionRule,
  "id"
> & { id: RuntimeExtractionRuleId };

export type ExecutableExtractionRule =
  | ExecutableElementExtractionRule
  | ExecutablePageUrlExtractionRule;

/**
 * Local-only payload consumed by the current storage/domain compatibility layer.
 * It keeps the captured sample next to the durable rule without making `raw`
 * part of ExtractionRule itself.
 */
export type CapturedExtractionInput =
  | (Omit<ElementExtractionRule, "id"> & { raw: string })
  | (Omit<PageUrlExtractionRule, "id"> & { raw: string });

export type ExtractionRuleRunResult =
  | {
      ruleId: RuntimeExtractionRuleId;
      raw: string;
      error?: never;
    }
  | {
      ruleId: RuntimeExtractionRuleId;
      error: string;
      raw?: never;
    };
