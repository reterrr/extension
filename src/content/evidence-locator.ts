import {
  buildDurableSelectors,
  selectionContainer,
  selectorCandidates,
} from "./durable-selector";
import type { SelectionQuote } from "../shared/types/extraction";

type CachedLocator = {
  pageUrl?: string;
  selector: string;
  selectorFallbacks?: string[];
  quote?: SelectionQuote;
};

type EvidenceAnchorRequest = {
  key: string;
  objectId: string;
  field: string;
  sourceUrl: string;
  quote: SelectionQuote;
  cached?: CachedLocator;
};

type EvidenceLocator = {
  key: string;
  pageUrl: string;
  selector: string;
  selectorFallbacks?: string[];
  quote: SelectionQuote;
  resolvedAt: string;
};

type MaterializeRequest = {
  type: "BURBOT_MATERIALIZE_IMPORT_EVIDENCE";
  items: EvidenceAnchorRequest[];
};

type MaterializeResponse = {
  ok: true;
  locators: EvidenceLocator[];
};

type Boundary = { node: Text; offset: number };
type CanonicalText = {
  text: string;
  starts: Boundary[];
  ends: Boundary[];
};

type EvidenceLocatorRuntime = {
  dispose(): void;
};

declare global {
  var __burbotEvidenceLocatorRuntime: EvidenceLocatorRuntime | undefined;
}

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuote(value: unknown): value is SelectionQuote {
  return (
    isRecord(value) &&
    typeof value.exact === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string"
  );
}

function isRequest(value: unknown): value is MaterializeRequest {
  return (
    isRecord(value) &&
    value.type === "BURBOT_MATERIALIZE_IMPORT_EVIDENCE" &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.key === "string" &&
        typeof item.objectId === "string" &&
        typeof item.field === "string" &&
        typeof item.sourceUrl === "string" &&
        isQuote(item.quote),
    )
  );
}

function canonicalText(root: Element): CanonicalText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  const starts: Boundary[] = [];
  const ends: Boundary[] = [];
  let emitted = false;
  let whitespaceStart: Boundary | null = null;
  let whitespaceEnd: Boundary | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const parent = node.parentElement;
    if (parent?.closest("script,style,noscript,template")) continue;

    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset];
      if (/\s/.test(character)) {
        if (emitted) {
          whitespaceStart ??= { node, offset };
          whitespaceEnd = { node, offset: offset + 1 };
        }
        continue;
      }

      if (whitespaceStart && whitespaceEnd && emitted) {
        text += " ";
        starts.push(whitespaceStart);
        ends.push(whitespaceEnd);
      }
      whitespaceStart = null;
      whitespaceEnd = null;

      text += character;
      starts.push({ node, offset });
      ends.push({ node, offset: offset + 1 });
      emitted = true;
    }
  }

  return { text, starts, ends };
}

function occurrences(text: string, exact: string): number[] {
  const positions: number[] = [];
  if (!exact) return positions;
  let offset = 0;
  while (offset <= text.length - exact.length) {
    const index = text.indexOf(exact, offset);
    if (index < 0) break;
    positions.push(index);
    offset = index + Math.max(1, exact.length);
  }
  return positions;
}

function commonSuffixLength(left: string, right: string, limit = 96): number {
  const max = Math.min(left.length, right.length, limit);
  let length = 0;
  while (
    length < max &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function commonPrefixLength(left: string, right: string, limit = 96): number {
  const max = Math.min(left.length, right.length, limit);
  let length = 0;
  while (length < max && left[length] === right[length]) length += 1;
  return length;
}

function usefulTokens(value: string): string[] {
  return clean(value)
    .toLocaleLowerCase("pl")
    .split(/[^\p{L}\p{N}/.-]+/u)
    .filter((token) => token.length >= 3 || /\d/.test(token))
    .slice(-10);
}

function tokenOverlapScore(windowText: string, context: string): number {
  const haystack = windowText.toLocaleLowerCase("pl");
  return usefulTokens(context).reduce(
    (score, token, index) =>
      score + (haystack.includes(token) ? Math.min(24, token.length * 2 + index) : 0),
    0,
  );
}

function semanticScore(element: Element | null): number {
  if (!element) return 0;
  let score = 0;
  const tag = element.tagName.toLowerCase();
  if (/^h[1-3]$/.test(tag) || element.closest("h1,h2,h3")) score += 45;
  if (
    element.closest(
      "main,article,[role='main'],.entry-content,.post-content,.page-content,.content-area",
    )
  ) {
    score += 25;
  }
  if (element.closest("p,li,td,th,dt,dd")) score += 8;
  if (
    element.closest(
      "nav,header,footer,aside,[role='navigation'],.menu,.sidebar,.breadcrumb,.breadcrumbs",
    )
  ) {
    score -= 45;
  }
  return score;
}

function rangeAt(index: CanonicalText, start: number, length: number): Range | null {
  if (length <= 0) return null;
  const first = index.starts[start];
  const last = index.ends[start + length - 1];
  if (!first || !last) return null;

  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return range;
}

function bestRange(index: CanonicalText, quote: SelectionQuote): Range | null {
  const exact = clean(quote.exact);
  const prefix = clean(quote.prefix);
  const suffix = clean(quote.suffix);
  const positions = occurrences(index.text, exact);
  if (!positions.length || !exact) return null;
  if (positions.length === 1) return rangeAt(index, positions[0], exact.length);

  let bestStart: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const start of positions) {
    const end = start + exact.length;
    const before = index.text.slice(Math.max(0, start - 180), start);
    const after = index.text.slice(end, Math.min(index.text.length, end + 180));

    let score = 0;
    if (prefix && before.endsWith(prefix)) score += 4000;
    if (suffix && after.startsWith(suffix)) score += 4000;
    score += commonSuffixLength(before, prefix) * 7;
    score += commonPrefixLength(after, suffix) * 7;
    score += tokenOverlapScore(before, prefix) * 3;
    score += tokenOverlapScore(after, suffix) * 3;
    score += semanticScore(index.starts[start]?.node.parentElement ?? null);

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return bestStart === null ? null : rangeAt(index, bestStart, exact.length);
}

function rangeWithinElement(element: Element, quote: SelectionQuote): Range | null {
  return bestRange(canonicalText(element), quote);
}

function localQuote(container: Element, range: Range): SelectionQuote | null {
  const full = clean(container.textContent);
  const exact = clean(range.toString());
  if (!full || !exact) return null;

  const preceding = document.createRange();
  preceding.selectNodeContents(container);
  try {
    preceding.setEnd(range.startContainer, range.startOffset);
  } catch {
    return null;
  }

  const before = clean(preceding.toString());
  const positions = occurrences(full, exact).filter(
    (index) => clean(full.slice(0, index)) === before,
  );
  const start = positions.length === 1 ? positions[0] : full.indexOf(exact);
  if (start < 0) return null;
  const end = start + exact.length;

  return {
    exact,
    prefix: full.slice(Math.max(0, start - 80), start),
    suffix: full.slice(end, end + 80),
  };
}

function locatorFor(
  item: EvidenceAnchorRequest,
  range: Range,
): EvidenceLocator | null {
  const container = selectionContainer(range);
  if (!container) return null;

  let selectors;
  try {
    selectors = buildDurableSelectors(container);
  } catch {
    return null;
  }

  const quote = localQuote(container, range) ?? item.quote;
  return {
    key: item.key,
    pageUrl: location.href,
    selector: selectors.primary,
    ...(selectors.fallbacks.length
      ? { selectorFallbacks: selectors.fallbacks }
      : {}),
    quote,
    resolvedAt: new Date().toISOString(),
  };
}

function cachedLocator(item: EvidenceAnchorRequest): EvidenceLocator | null {
  const cached = item.cached;
  if (!cached?.selector) return null;

  for (const selector of selectorCandidates(
    cached.selector,
    cached.selectorFallbacks,
  )) {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    if (matches.length !== 1) continue;

    const quote = cached.quote ?? item.quote;
    const range = rangeWithinElement(matches[0], quote);
    if (!range) continue;

    // Rebuild selectors from the live element so a valid fallback can promote
    // itself to the new primary when the old primary disappeared.
    return locatorFor(item, range);
  }

  return null;
}

function materialize(items: EvidenceAnchorRequest[]): EvidenceLocator[] {
  const result: EvidenceLocator[] = [];
  const unresolved: EvidenceAnchorRequest[] = [];

  for (const item of items) {
    const cached = cachedLocator(item);
    if (cached) result.push(cached);
    else unresolved.push(item);
  }

  if (!unresolved.length) return result;

  // The expensive page text index is built once for the whole batch, not once
  // per imported field.
  const root = document.body ?? document.documentElement;
  const index = canonicalText(root);

  for (const item of unresolved) {
    const range = bestRange(index, item.quote);
    if (!range) continue;
    const locator = locatorFor(item, range);
    if (locator) result.push(locator);
  }

  return result;
}

globalThis.__burbotEvidenceLocatorRuntime?.dispose();

const onMessage = (
  message: unknown,
): undefined | Promise<MaterializeResponse> => {
  if (!isRequest(message)) return undefined;
  return Promise.resolve({
    ok: true,
    locators: materialize(message.items),
  });
};

browser.runtime.onMessage.addListener(onMessage);

globalThis.__burbotEvidenceLocatorRuntime = {
  dispose() {
    browser.runtime.onMessage.removeListener(onMessage);
  },
};

export {};
