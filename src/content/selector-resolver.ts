import type {
  ExtractionErrorCode,
  ExtractionSpec,
  LocatorEvaluationResult,
  PartEvaluationResult,
  RecipeEvaluationResult,
  SelectorEvaluationResult,
  SelectorLocator,
  SelectorPart,
  SelectorRecipe,
  SelectorVersion,
  TextQuote,
} from "../shared/types/selectors";
import {
  isSafeCandidateText,
  maxCandidateLength,
  maxRawLength,
  privateTextSelector,
  summarizePart,
  summarizeRecipe,
  summarizeVersion,
} from "../shared/selectors/evaluation.js";
import { ordered } from "../shared/selectors/repository";

export { normalizeConsensusValue } from "../shared/selectors/evaluation.js";

export type LocatorTarget = Element | Range;
export interface SelectorRuntime {
  resolve(locator: SelectorLocator): LocatorTarget[] | null;
  read(target: LocatorTarget, extraction: ExtractionSpec): string;
  readCandidate?(target: LocatorTarget): string | undefined;
}

export interface ConsensusOptions {
  normalize?: (rawValue: string) => string;
}

class ExtractionFailure extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function evaluateLocator(
  locator: SelectorLocator,
  extraction: ExtractionSpec,
  runtime: SelectorRuntime,
): LocatorEvaluationResult {
  const base = { locatorUuid: locator.uuid, matchCount: 0 };
  let targets: LocatorTarget[] | null;
  try {
    targets = runtime.resolve(locator);
  } catch (error) {
    return { ...base, status: "error", diagnostic: message(error) };
  }
  if (targets === null)
    return {
      ...base,
      status: "unsupported",
      diagnostic: "No runtime resolver for " + locator.kind + ".",
    };
  const matchCount = targets.length;
  if (matchCount !== 1)
    return {
      ...base,
      matchCount,
      status: matchCount === 0 ? "not_found" : "ambiguous",
      diagnostic: "Locator matched " + matchCount + " fragments.",
    };
  const target = targets[0];
  try {
    const rawValue = runtime.read(target, extraction);
    if (!rawValue)
      throw new ExtractionFailure("empty_value", "Extracted value is empty.");
    if (rawValue.length > maxRawLength)
      throw new ExtractionFailure(
        "value_too_large",
        "Extracted value is too large.",
      );
    return { ...base, matchCount, status: "success", rawValue };
  } catch (error) {
    let rawText: string | undefined;
    try {
      rawText = runtime.readCandidate?.(target);
    } catch {
      // Candidate collection is optional. Keep the original extraction error.
    }
    return {
      ...base,
      matchCount,
      status: "error",
      diagnostic: message(error),
      extractionError:
        error instanceof ExtractionFailure ? error.code : "extraction_failed",
      ...(rawText && {
        candidate: { rawText, source: "matched_element_text", verified: false },
      }),
    };
  }
}

export function evaluatePart(
  part: SelectorPart,
  runtime: SelectorRuntime,
  options: ConsensusOptions = {},
): PartEvaluationResult {
  const locatorResults = ordered(part.locators).map((locator) =>
    evaluateLocator(locator, part.extraction, runtime),
  );
  return {
    partUuid: part.uuid,
    locatorResults,
    ...summarizePart(locatorResults, options.normalize),
  };
}

export function evaluateRecipe(
  recipe: SelectorRecipe,
  runtime: SelectorRuntime,
  options: ConsensusOptions = {},
): RecipeEvaluationResult {
  const parts = ordered(recipe.parts);
  const partResults = parts.map((part) => evaluatePart(part, runtime, options));
  return {
    recipeUuid: recipe.uuid,
    partResults,
    ...summarizeRecipe(parts, partResults),
  };
}

export function evaluateSelectorVersion(
  version: SelectorVersion,
  runtime: SelectorRuntime,
  options: ConsensusOptions = {},
): SelectorEvaluationResult {
  const recipeResults = ordered(version.recipes).map((recipe) =>
    evaluateRecipe(recipe, runtime, options),
  );
  return {
    selectorVersionUuid: version.uuid,
    recipeResults,
    ...summarizeVersion(recipeResults, options.normalize),
  };
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
type Boundary = { node: Text; offset: number };
interface DOMText {
  text: string;
  starts: Boundary[];
  ends: Boundary[];
}

/** An ephemeral DOM text index, never a Snapshot coordinate system. */
function domText(root: Node, doc: Document): DOMText {
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let text = "";
  const starts: Boundary[] = [],
    ends: Boundary[] = [];
  let whitespace: { start: Boundary; end: Boundary } | undefined;
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    if (
      node.parentElement?.closest(
        "script,style,noscript,template,[data-burbot-selector-highlight],[data-burbot-picker]",
      )
    )
      continue;
    for (let offset = 0; offset < node.data.length; offset++) {
      const start = { node, offset },
        end = { node, offset: offset + 1 };
      if (/\s/.test(node.data[offset])) {
        if (text) whitespace = { start: whitespace?.start ?? start, end };
        continue;
      }
      if (whitespace) {
        text += " ";
        starts.push(whitespace.start);
        ends.push(whitespace.end);
        whitespace = undefined;
      }
      text += node.data[offset];
      starts.push(start);
      ends.push(end);
    }
  }
  return { text, starts, ends };
}

function quoteRanges(index: DOMText, quote: TextQuote, doc: Document): Range[] {
  const exact = clean(quote.exact);
  if (!exact) return [];
  const result: Range[] = [];
  let from = 0;
  while (from <= index.text.length - exact.length) {
    const start = index.text.indexOf(exact, from);
    if (start < 0) break;
    from = start + 1;
    const end = start + exact.length;
    if (
      quote.prefix &&
      !index.text.slice(0, start).trimEnd().endsWith(quote.prefix.trimEnd())
    )
      continue;
    if (
      quote.suffix &&
      !index.text.slice(end).trimStart().startsWith(quote.suffix.trimStart())
    )
      continue;
    const range = doc.createRange();
    range.setStart(index.starts[start].node, index.starts[start].offset);
    range.setEnd(index.ends[end - 1].node, index.ends[end - 1].offset);
    result.push(range);
  }
  return result;
}

/** Find a single ordered pair in the normalized element text. */
function boundarySpan(text: string, prefix: string, suffix: string) {
  const starts: number[] = [],
    ends: number[] = [];
  for (
    let i = text.indexOf(prefix);
    i >= 0 && starts.length <= 200;
    i = text.indexOf(prefix, i + 1)
  )
    starts.push(i + prefix.length);
  for (
    let i = text.indexOf(suffix);
    i >= 0 && ends.length <= 200;
    i = text.indexOf(suffix, i + 1)
  )
    ends.push(i);
  if (starts.length > 200 || ends.length > 200) return "ambiguous";
  const pairs = starts.flatMap((start) =>
    ends.filter((end) => end >= start).map((end) => ({ start, end })),
  );
  if (pairs.length !== 1) return pairs.length ? "ambiguous" : "missing";
  let { start, end } = pairs[0];
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

export function readTextBetween(
  text: string,
  extraction: Extract<ExtractionSpec, { type: "text_between" }>,
) {
  const span = boundarySpan(
    text,
    clean(extraction.start),
    clean(extraction.end),
  );
  if (span === "missing")
    throw new ExtractionFailure(
      "text_boundary_missing",
      "Text boundaries no longer match.",
    );
  if (span === "ambiguous")
    throw new ExtractionFailure(
      "text_boundary_ambiguous",
      "Multiple text boundary pairs match.",
    );
  return text.slice(span.start, span.end);
}

function selectionRanges(
  index: DOMText,
  quote: TextQuote,
  doc: Document,
): Range[] {
  const prefix = clean(quote.prefix ?? ""),
    suffix = clean(quote.suffix ?? "");
  if (!prefix || !suffix)
    return quoteRanges(index, { exact: quote.exact }, doc);
  const span = boundarySpan(index.text, prefix, suffix);
  if (span === "missing")
    throw new ExtractionFailure(
      "selection_context_mismatch",
      "Selection context no longer matches.",
    );
  if (span === "ambiguous")
    throw new ExtractionFailure(
      "selection_context_ambiguous",
      "Selection context is ambiguous.",
    );
  const { start, end } = span;
  if (end <= start)
    throw new ExtractionFailure("empty_value", "Selected text is now empty.");
  const range = doc.createRange();
  range.setStart(index.starts[start].node, index.starts[start].offset);
  range.setEnd(index.ends[end - 1].node, index.ends[end - 1].offset);
  return [range];
}

function readCandidateText(target: LocatorTarget, doc: Document) {
  if (
    !("getAttribute" in target) ||
    /^(?:html|head|body)$/i.test(target.localName)
  )
    return undefined;
  const walker = doc.createTreeWalker(target, 4 /* SHOW_TEXT */);
  let text = "";
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    if (node.parentElement?.closest(privateTextSelector)) continue;
    if (text.length + node.data.length > maxCandidateLength) return undefined;
    text += node.data;
  }
  return isSafeCandidateText(text) ? text : undefined;
}

export function resolveSelectionRange(
  element: Element,
  quote: TextQuote,
): Range | null {
  try {
    return (
      selectionRanges(
        domText(element, element.ownerDocument),
        quote,
        element.ownerDocument,
      )[0] ?? null
    );
  } catch {
    return null;
  }
}

function xpathTargets(doc: Document, expression: string): Element[] {
  const result = doc.evaluate(
    expression,
    doc,
    null,
    7 /* ORDERED_NODE_SNAPSHOT_TYPE */,
    null,
  );
  const targets: Element[] = [];
  for (let i = 0; i < result.snapshotLength; i++) {
    const node = result.snapshotItem(i);
    if (node?.nodeType !== 1) throw new Error("XPath must resolve elements.");
    targets.push(node as Element);
  }
  return targets;
}

/** One runtime per evaluation shares its document text index across locators. */
export function createDOMSelectorRuntime(
  doc: Document = document,
): SelectorRuntime {
  const indexes = new Map<Node, DOMText>();
  const index = (root: Node) => {
    let value = indexes.get(root);
    if (!value) {
      value = domText(root, doc);
      indexes.set(root, value);
    }
    return value;
  };
  return {
    resolve(locator) {
      switch (locator.kind) {
        case "css_path":
          return Array.from(doc.querySelectorAll(locator.selector));
        case "xpath":
          return xpathTargets(doc, locator.expression);
        case "element_id":
          // getElementById would hide duplicate ids.
          return Array.from(doc.querySelectorAll("[id]")).filter(
            (element) => element.id === locator.elementId,
          );
        case "text_quote":
          return quoteRanges(
            index(doc.body ?? doc.documentElement),
            locator.quote,
            doc,
          );
        default:
          return null;
      }
    },
    readCandidate(target) {
      return readCandidateText(target, doc);
    },
    read(target, extraction) {
      const isElement = "getAttribute" in target;
      if (extraction.type === "attribute") {
        if (!isElement)
          throw new ExtractionFailure(
            "element_required",
            "Attribute extraction requires an element locator.",
          );
        const owner =
          extraction.name === "href"
            ? (target.closest("a[href]") ?? target)
            : target;
        const attribute = owner.getAttribute(extraction.name);
        if (attribute === null)
          throw new ExtractionFailure(
            "attribute_missing",
            "The configured attribute was not found.",
          );
        // Preserve the extension's existing absolute href/src behavior.
        if (["href", "src"].includes(extraction.name))
          return new URL(attribute, owner.baseURI).href;
        return attribute;
      }
      if (extraction.type === "text")
        return isElement ? index(target).text : clean(target.toString());
      if (extraction.type === "text_between") {
        if (!isElement)
          throw new ExtractionFailure(
            "element_required",
            "Text boundaries require an element locator.",
          );
        return readTextBetween(index(target).text, extraction);
      }
      if (isElement) {
        const ranges = selectionRanges(index(target), extraction.quote, doc);
        if (ranges.length === 0)
          throw new ExtractionFailure(
            "selection_quote_mismatch",
            "The selection quote no longer matches.",
          );
        if (ranges.length > 1)
          throw new ExtractionFailure(
            "selection_quote_ambiguous",
            "The selection quote matches multiple fragments.",
          );
        return clean(ranges[0].toString());
      }
      const raw = clean(target.toString());
      if (raw !== clean(extraction.quote.exact))
        throw new ExtractionFailure(
          "selection_quote_mismatch",
          "Text locator and selection extraction disagree.",
        );
      return raw;
    },
  };
}

export function resolvePartTarget(
  part: SelectorPart,
  runtime: SelectorRuntime,
): LocatorTarget | null {
  const result = evaluatePart(part, runtime);
  if (result.status !== "success") return null;
  const successful = new Set(
    result.locatorResults
      .filter((item) => item.status === "success")
      .map((item) => item.locatorUuid),
  );
  for (const locator of ordered(part.locators)) {
    if (successful.has(locator.uuid))
      return runtime.resolve(locator)?.[0] ?? null;
  }
  return null;
}

/** Capture a quote only when its exact text/context uniquely anchors the fragment. */
export function captureTextQuote(
  element: Element,
  exact: string,
  doc: Document = document,
  expectedRange?: Range,
): TextQuote | null {
  const index = domText(doc.body ?? doc.documentElement, doc);
  const text = clean(exact);
  if (!text) return null;
  let from = 0;
  while (from <= index.text.length - text.length) {
    const start = index.text.indexOf(text, from);
    if (start < 0) break;
    from = start + 1;
    const end = start + text.length;
    if (
      !element.contains(index.starts[start].node) ||
      !element.contains(index.ends[end - 1].node)
    )
      continue;
    if (
      expectedRange &&
      (!expectedRange.isPointInRange(
        index.starts[start].node,
        index.starts[start].offset,
      ) ||
        !expectedRange.isPointInRange(
          index.ends[end - 1].node,
          index.ends[end - 1].offset,
        ))
    )
      continue;
    const quote = {
      exact: text,
      prefix: index.text.slice(Math.max(0, start - 60), start),
      suffix: index.text.slice(end, end + 60),
    };
    if (quoteRanges(index, quote, doc).length === 1) return quote;
  }
  return null;
}
