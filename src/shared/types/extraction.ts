export type ExtractionRuleId = string | number;
export type RuntimeExtractionRuleId = string;

export type SupportedExtractionAttribute =
  | "href"
  | "src"
  | "datetime"
  | "title"
  | "alt"
  | "content";

/**
 * Compatibility mirror for the current legacy domain core, which copies the
 * extraction object verbatim but reconstructs the rule envelope. The canonical
 * rule-level location remains `selector` + `selectorFallbacks`.
 */
export interface WebLocatorMetadata {
  selectorFallbacks?: string[];
}

export interface TextExtraction extends WebLocatorMetadata {
  type: "text";
}

export interface AttributeExtraction extends WebLocatorMetadata {
  type: "attribute";
  attribute: SupportedExtractionAttribute;
}

export interface SelectionQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface SelectionExtraction extends WebLocatorMetadata {
  type: "selection";
  quote: SelectionQuote;
}

export interface PageUrlExtraction {
  type: "pageUrl";
}

/**
 * Selector inside a canonical PDF text page.
 *
 * `pageNumber` is 1-based. The quote is evaluated against the canonical text
 * produced by Burbot's PDF text extractor for that page.
 */
export interface PdfTextSelector {
  pageNumber: number;
  quote: SelectionQuote;
}

/**
 * Durable PDF extraction strategy. `sourceId` points to a stored remote PDF
 * source; no local file path and no DOM/CSS selector is involved.
 */
export interface PdfTextExtraction {
  type: "pdfText";
  sourceId: string;
  selector: PdfTextSelector;
}

export type ElementExtractionSpec =
  | TextExtraction
  | AttributeExtraction
  | SelectionExtraction;

export type ExtractionSpec =
  | ElementExtractionSpec
  | PageUrlExtraction
  | PdfTextExtraction;

interface ExtractionRuleBase {
  id?: ExtractionRuleId;
  pageUrl: string;
}

export interface ElementExtractionRule extends ExtractionRuleBase {
  /** Best CSS selector at capture time. */
  selector: string;
  /**
   * Additional selectors that matched the same element uniquely at capture
   * time. They let the runner survive small DOM/layout changes without silently
   * accepting an ambiguous selector.
   */
  selectorFallbacks?: string[];
  extraction: ElementExtractionSpec;
}

export interface PageUrlExtractionRule extends ExtractionRuleBase {
  selector: null;
  extraction: PageUrlExtraction;
}

export interface PdfTextExtractionRule extends ExtractionRuleBase {
  selector: null;
  extraction: PdfTextExtraction;
}

/**
 * Durable extraction definition. `raw` is intentionally absent: raw text is an
 * execution result, not part of the rule definition.
 */
export type ExtractionRule =
  | ElementExtractionRule
  | PageUrlExtractionRule
  | PdfTextExtractionRule;

export type ExecutableElementExtractionRule = Omit<
  ElementExtractionRule,
  "id"
> & { id: RuntimeExtractionRuleId };

export type ExecutablePageUrlExtractionRule = Omit<
  PageUrlExtractionRule,
  "id"
> & { id: RuntimeExtractionRuleId };

export type ExecutablePdfTextExtractionRule = Omit<
  PdfTextExtractionRule,
  "id"
> & { id: RuntimeExtractionRuleId };

export type ExecutableExtractionRule =
  | ExecutableElementExtractionRule
  | ExecutablePageUrlExtractionRule
  | ExecutablePdfTextExtractionRule;

/**
 * Local-only payload consumed by the current storage/domain compatibility layer.
 * It keeps the captured sample next to the durable rule without making `raw`
 * part of ExtractionRule itself.
 */
export type CapturedExtractionInput =
  | (Omit<ElementExtractionRule, "id"> & { raw: string })
  | (Omit<PageUrlExtractionRule, "id"> & { raw: string })
  | (Omit<PdfTextExtractionRule, "id"> & { raw: string });

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
