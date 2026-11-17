export type UUID = string;
export type SelectorVersionStatus =
  "draft" | "active" | "superseded" | "rejected";

export interface SelectorTarget {
  objectId: string;
  field: string;
  target?: { kind: string; id: string };
}

export interface Selector {
  uuid: UUID;
  target: SelectorTarget;
  sourceUuid?: UUID;
  pageUrl?: string;
  activeVersionUuid?: UUID | null;
  createdAt: string;
  migration?: { legacyRuleId: string; provenance: "unverified" };
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export type ExtractionSpec =
  | { type: "text" }
  | { type: "attribute"; name: string }
  | { type: "selection"; quote: TextQuote };

/** Local reserved contracts. Map against backend models before REST serialization. */
export interface DomPathPayload {
  root: "document";
  segments: Array<{ tagName: string; siblingIndex: number }>;
}

export interface DomRangePayload {
  start: { path: DomPathPayload; textNodeIndex: number; offset: number };
  end: { path: DomPathPayload; textNodeIndex: number; offset: number };
  offsetUnit: "utf16_code_unit";
}

/** Positions are unusable without the exact representation and its digest. */
export interface TextCoordinates {
  representation: "raw_html" | "rendered_dom_text";
  representationVersion: string;
  offsetUnit: "unicode_codepoint" | "utf16_code_unit" | "utf8_byte";
  contentHash: { algorithm: "sha256"; value: string };
}

export interface TextPositionPayload {
  start: number;
  end: number;
  coordinates: TextCoordinates;
}

export interface ExactPositionPayload extends TextPositionPayload {
  exact: string;
}

export interface TextFragmentPayload {
  textStart: string;
  textEnd?: string;
  prefix?: string;
  suffix?: string;
}

interface LocatorBase {
  uuid: UUID;
  order: number;
}
export type SelectorLocator = LocatorBase &
  (
    | { kind: "css_path"; selector: string }
    | { kind: "xpath"; expression: string }
    | { kind: "element_id"; elementId: string }
    | { kind: "text_quote"; quote: TextQuote }
    | { kind: "dom_path"; payload: DomPathPayload }
    | { kind: "dom_range"; payload: DomRangePayload }
    | { kind: "exact_pos"; payload: ExactPositionPayload }
    | { kind: "text_position"; payload: TextPositionPayload }
    | { kind: "text_fragment"; payload: TextFragmentPayload }
  );

export interface SelectorPart {
  uuid: UUID;
  order: number;
  extraction: ExtractionSpec;
  locators: SelectorLocator[];
  /** Separator inserted BEFORE this part; ignored for the first part. */
  joinWith?: string;
}

export interface SelectorRecipe {
  uuid: UUID;
  order: number;
  parts: SelectorPart[];
}

export interface SelectorVersion {
  uuid: UUID;
  selectorUuid: UUID;
  versionNo: number;
  status: SelectorVersionStatus;
  createdFromSnapshotUuid?: UUID | null;
  artifactType?: "raw_html" | "rendered_dom" | null;
  recipes: SelectorRecipe[];
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

/** Portable definition: no SQLite keys, captured samples, or runtime diagnostics. */
export interface SelectorTree {
  selector: Selector;
  versions: SelectorVersion[];
}

export type EvaluationStatus =
  "success" | "not_found" | "ambiguous" | "conflict" | "error" | "unsupported";

export interface LocatorEvaluationResult {
  locatorUuid: UUID;
  status: EvaluationStatus;
  matchCount: number;
  rawValue?: string;
  diagnostic?: string;
}

export interface PartEvaluationResult {
  partUuid: UUID;
  status: EvaluationStatus;
  rawValue?: string;
  locatorResults: LocatorEvaluationResult[];
  diagnostic?: string;
}

export interface RecipeEvaluationResult {
  recipeUuid: UUID;
  status: EvaluationStatus;
  rawValue?: string;
  partResults: PartEvaluationResult[];
  diagnostic?: string;
}

export interface SelectorEvaluationResult {
  selectorVersionUuid: UUID;
  status: EvaluationStatus;
  rawValue?: string;
  recipeResults: RecipeEvaluationResult[];
  diagnostic?: string;
}

export interface StoredSelectorEvaluation {
  uuid: UUID;
  evaluatedAt: string;
  pageUrl: string;
  result: SelectorEvaluationResult;
}

/** Future API inputs only; no network requests or snapshot creation here. */
export type CreateSelectorDTO = Omit<Selector, "migration">;
export type CreateSelectorVersionDTO = SelectorVersion;
