import type {
  EvaluationStatus,
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
import { ordered } from "../shared/selectors/repository";

export type LocatorTarget = Element | Range;
export interface SelectorRuntime {
  resolve(locator: SelectorLocator): LocatorTarget[] | null;
  read(target: LocatorTarget, extraction: ExtractionSpec): string;
}

export interface ConsensusOptions {
  normalize?: (rawValue: string) => string;
}

/** Exact comparison by default: case, punctuation and number formatting matter. */
export function normalizeConsensusValue(value: string): string {
  return value;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const failureStatus = (
  results: Array<{ status: EvaluationStatus }>,
): EvaluationStatus =>
  (
    ["conflict", "ambiguous", "error", "unsupported", "not_found"] as const
  ).find((status) => results.some((result) => result.status === status)) ??
  "error";

export function evaluateLocator(
  locator: SelectorLocator,
  extraction: ExtractionSpec,
  runtime: SelectorRuntime,
): LocatorEvaluationResult {
  const base = { locatorUuid: locator.uuid, matchCount: 0 };
  let matchCount = 0;
  try {
    const targets = runtime.resolve(locator);
    if (targets === null)
      return {
        ...base,
        status: "unsupported",
        diagnostic: `No runtime resolver for ${locator.kind}.`,
      };
    matchCount = targets.length;
    if (targets.length !== 1)
      return {
        ...base,
        matchCount,
        status: targets.length === 0 ? "not_found" : "ambiguous",
        diagnostic: `Locator matched ${targets.length} fragments.`,
      };
    const rawValue = runtime.read(targets[0], extraction);
    if (!rawValue || rawValue.length > 100000)
      return {
        ...base,
        matchCount,
        status: "error",
        diagnostic: "Extracted value is empty or too large.",
      };
    return { ...base, matchCount, status: "success", rawValue };
  } catch (error) {
    return { ...base, matchCount, status: "error", diagnostic: message(error) };
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
  const successes = locatorResults.filter(
    (result) => result.status === "success",
  );
  const base = { partUuid: part.uuid, locatorResults };
  if (!successes.length)
    return {
      ...base,
      status: failureStatus(locatorResults),
      diagnostic: "No locator resolved this part uniquely.",
    };
  const normalize = options.normalize ?? normalizeConsensusValue;
  if (
    new Set(successes.map((result) => normalize(result.rawValue!))).size !== 1
  )
    return {
      ...base,
      status: "conflict",
      diagnostic: "Successful locators disagree about this part's value.",
    };
  // Failed/ambiguous alternatives remain visible in locatorResults; they are
  // never treated as successful matches or allowed to choose an arbitrary node.
  return { ...base, status: "success", rawValue: successes[0].rawValue };
}

export function evaluateRecipe(
  recipe: SelectorRecipe,
  runtime: SelectorRuntime,
  options: ConsensusOptions = {},
): RecipeEvaluationResult {
  const parts = ordered(recipe.parts);
  const partResults = parts.map((part) => evaluatePart(part, runtime, options));
  const base = { recipeUuid: recipe.uuid, partResults };
  if (
    !partResults.length ||
    partResults.some((result) => result.status !== "success")
  )
    return {
      ...base,
      status: failureStatus(partResults),
      diagnostic: "Recipe did not produce every part.",
    };
  const rawValue = partResults
    .map(
      (result, index) =>
        (index ? (parts[index].joinWith ?? "") : "") + result.rawValue!,
    )
    .join("");
  if (rawValue.length > 100000)
    return {
      ...base,
      status: "error",
      diagnostic: "Assembled recipe value is too large.",
    };
  return { ...base, status: "success", rawValue };
}

export function evaluateSelectorVersion(
  version: SelectorVersion,
  runtime: SelectorRuntime,
  options: ConsensusOptions = {},
): SelectorEvaluationResult {
  const recipeResults = ordered(version.recipes).map((recipe) =>
    evaluateRecipe(recipe, runtime, options),
  );
  const base = { selectorVersionUuid: version.uuid, recipeResults };
  const successes = recipeResults.filter(
    (result) => result.status === "success",
  );
  const normalize = options.normalize ?? normalizeConsensusValue;
  if (new Set(successes.map((result) => normalize(result.rawValue!))).size > 1)
    return {
      ...base,
      status: "conflict",
      diagnostic: "Independent recipes disagree.",
    };
  if (
    !recipeResults.length ||
    recipeResults.some((result) => result.status !== "success")
  )
    return {
      ...base,
      status: failureStatus(recipeResults),
      diagnostic: "Every independent recipe must produce a complete result.",
    };
  return { ...base, status: "success", rawValue: recipeResults[0].rawValue };
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

function selectionRanges(
  index: DOMText,
  quote: TextQuote,
  doc: Document,
): Range[] {
  const prefix = clean(quote.prefix ?? ""),
    suffix = clean(quote.suffix ?? "");
  if (!prefix || !suffix)
    return quoteRanges(index, { exact: quote.exact }, doc);
  const starts: number[] = [],
    ends: number[] = [];
  for (
    let i = index.text.indexOf(prefix);
    i >= 0 && starts.length <= 200;
    i = index.text.indexOf(prefix, i + 1)
  )
    starts.push(i + prefix.length);
  for (
    let i = index.text.indexOf(suffix);
    i >= 0 && ends.length <= 200;
    i = index.text.indexOf(suffix, i + 1)
  )
    ends.push(i);
  if (starts.length > 200 || ends.length > 200)
    throw new Error("Selection context is too repetitive.");
  const pairs = starts.flatMap((start) =>
    ends.filter((end) => end >= start).map((end) => ({ start, end })),
  );
  if (pairs.length !== 1)
    throw new Error("Selection context changed or is ambiguous.");
  let { start, end } = pairs[0];
  while (start < end && /\s/.test(index.text[start])) start++;
  while (end > start && /\s/.test(index.text[end - 1])) end--;
  if (end <= start) throw new Error("Selected text is now empty.");
  const range = doc.createRange();
  range.setStart(index.starts[start].node, index.starts[start].offset);
  range.setEnd(index.ends[end - 1].node, index.ends[end - 1].offset);
  return [range];
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
    read(target, extraction) {
      const isElement = "getAttribute" in target;
      if (extraction.type === "attribute") {
        if (!isElement)
          throw new Error("Attribute extraction requires an element locator.");
        const owner =
          extraction.name === "href"
            ? (target.closest("a[href]") ?? target)
            : target;
        const attribute = owner.getAttribute(extraction.name);
        if (attribute === null)
          throw new Error(`Missing attribute: ${extraction.name}.`);
        // Preserve the extension's existing absolute href/src behavior.
        if (["href", "src"].includes(extraction.name))
          return new URL(attribute, owner.baseURI).href;
        return attribute;
      }
      if (extraction.type === "text")
        return isElement ? index(target).text : clean(target.toString());
      if (isElement) {
        const ranges = selectionRanges(index(target), extraction.quote, doc);
        if (ranges.length !== 1)
          throw new Error(
            `Selection quote matched ${ranges.length} fragments.`,
          );
        return clean(ranges[0].toString());
      }
      const raw = clean(target.toString());
      if (raw !== clean(extraction.quote.exact))
        throw new Error("Text locator and selection extraction disagree.");
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
