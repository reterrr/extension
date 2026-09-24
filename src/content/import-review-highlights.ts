import { selectorColor } from "../shared/selectorPalette";

type ReviewHighlight = {
  id: string;
  exact: string;
  prefix: string;
  suffix: string;
  colorKey: string;
};

type ReviewMessage = {
  type: "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS";
  highlights: ReviewHighlight[];
  focusId?: string;
};

type Boundary = { node: Text; offset: number };
type IndexedSegment =
  | {
      kind: "text";
      start: number;
      end: number;
      node: Text;
      nodeStart: number;
    }
  | {
      kind: "space";
      start: number;
      end: number;
      startBoundary: Boundary;
      endBoundary: Boundary;
    };
type IndexedText = { text: string; segments: IndexedSegment[] };
type ResolvedRange = {
  range: Range;
  id: string;
  colorKey: string;
  focused: boolean;
};

declare global {
  var __burbotImportReviewHighlighterDispose: (() => void) | undefined;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalText(root: Element): IndexedText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: IndexedSegment[] = [];
  let text = "";
  let whitespaceStart: Boundary | null = null;
  let whitespaceEnd: Boundary | null = null;

  const flushWhitespace = () => {
    if (!whitespaceStart || !whitespaceEnd || !text.length) {
      whitespaceStart = null;
      whitespaceEnd = null;
      return;
    }
    const start = text.length;
    text += " ";
    segments.push({
      kind: "space",
      start,
      end: start + 1,
      startBoundary: whitespaceStart,
      endBoundary: whitespaceEnd,
    });
    whitespaceStart = null;
    whitespaceEnd = null;
  };

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (!(current instanceof Text)) continue;
    if (current.parentElement?.closest("script,style,noscript,template")) continue;

    let runStart = -1;
    const flushRun = (runEnd: number) => {
      if (runStart < 0 || runEnd <= runStart) return;
      flushWhitespace();
      const chunk = current.data.slice(runStart, runEnd);
      const start = text.length;
      text += chunk;
      segments.push({
        kind: "text",
        start,
        end: start + chunk.length,
        node: current,
        nodeStart: runStart,
      });
      runStart = -1;
    };

    for (let offset = 0; offset < current.data.length; offset += 1) {
      const character = current.data[offset];
      if (/\s/.test(character)) {
        flushRun(offset);
        if (text.length) {
          whitespaceStart ??= { node: current, offset };
          whitespaceEnd = { node: current, offset: offset + 1 };
        }
        continue;
      }
      if (runStart < 0) runStart = offset;
    }
    flushRun(current.data.length);
  }

  return { text, segments };
}

function segmentAt(index: IndexedText, position: number): IndexedSegment | undefined {
  let low = 0;
  let high = index.segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = index.segments[middle];
    if (position < segment.start) {
      high = middle - 1;
    } else if (position >= segment.end) {
      low = middle + 1;
    } else {
      return segment;
    }
  }
  return undefined;
}

function boundaryAt(
  segment: IndexedSegment,
  position: number,
  side: "start" | "end",
): Boundary {
  if (segment.kind === "space") {
    return side === "start" ? segment.startBoundary : segment.endBoundary;
  }
  const relative = position - segment.start;
  return {
    node: segment.node,
    offset: segment.nodeStart + relative + (side === "end" ? 1 : 0),
  };
}

function occurrences(text: string, exact: string): number[] {
  const positions: number[] = [];
  if (!exact) return positions;
  for (
    let index = text.indexOf(exact);
    index !== -1;
    index = text.indexOf(exact, index + Math.max(1, exact.length))
  ) {
    positions.push(index);
  }
  return positions;
}

function rangeAt(index: IndexedText, start: number, exactLength: number): Range | null {
  if (exactLength <= 0) return null;
  const endPosition = start + exactLength - 1;
  const startSegment = segmentAt(index, start);
  const endSegment = segmentAt(index, endPosition);
  if (!startSegment || !endSegment) return null;

  const startBoundary = boundaryAt(startSegment, start, "start");
  const endBoundary = boundaryAt(endSegment, endPosition, "end");
  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
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
  if (element.closest("main,article,[role='main'],.entry-content,.post-content,.page-content,.content-area")) {
    score += 25;
  }
  if (element.closest("p,li,td,th,dt,dd")) score += 8;
  if (element.closest("nav,header,footer,aside,[role='navigation'],.menu,.sidebar,.breadcrumb,.breadcrumbs")) {
    score -= 45;
  }
  if (element.closest("a") && !element.closest("h1,h2,h3")) score -= 5;
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) score += 4;
  return score;
}

/**
 * Fact-projection snapshots preserve the evidence text and nearby business
 * facts, but not necessarily the live DOM order. Resolve exactly one best live
 * occurrence instead of painting every repeated string on the page.
 *
 * Ranking prefers:
 * 1. exact prefix/suffix context when it survives;
 * 2. partial nearby context/token similarity;
 * 3. semantic main-content/headline locations over navigation/sidebar copies.
 */
function resolveBestRange(index: IndexedText, highlight: ReviewHighlight): Range | null {
  const exact = clean(highlight.exact);
  const prefix = clean(highlight.prefix);
  const suffix = clean(highlight.suffix);
  const positions = occurrences(index.text, exact);
  if (!positions.length || !exact) return null;
  if (positions.length === 1) return rangeAt(index, positions[0], exact.length);

  let bestStart: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const start of positions) {
    const end = start + exact.length;
    const before = index.text.slice(Math.max(0, start - 180), start);
    const after = index.text.slice(end, Math.min(index.text.length, end + 180));
    const exactPrefix = Boolean(prefix) && before.endsWith(prefix);
    const exactSuffix = Boolean(suffix) && after.startsWith(suffix);

    let score = 0;
    if (exactPrefix) score += 4000;
    if (exactSuffix) score += 4000;
    score += commonSuffixLength(before, prefix) * 7;
    score += commonPrefixLength(after, suffix) * 7;
    score += tokenOverlapScore(before, prefix) * 3;
    score += tokenOverlapScore(after, suffix) * 3;
    const segment = segmentAt(index, start);
    const semanticNode =
      segment?.kind === "text"
        ? segment.node
        : segment?.kind === "space"
          ? segment.startBoundary.node
          : null;
    score += semanticScore(semanticNode?.parentElement ?? null);

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return bestStart === null ? null : rangeAt(index, bestStart, exact.length);
}

globalThis.__burbotImportReviewHighlighterDispose?.();

let overlays: HTMLDivElement[] = [];
let ranges: ResolvedRange[] = [];
let frame: number | null = null;

function clear(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  overlays.forEach((overlay) => overlay.remove());
  overlays = [];
  ranges = [];
}

function draw(): void {
  frame = null;
  overlays.forEach((overlay) => overlay.remove());
  overlays = [];

  for (const entry of ranges) {
    const color = selectorColor(entry.colorKey);
    for (const rect of Array.from(entry.range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const overlay = document.createElement("div");
      overlay.dataset.burbotImportReviewHighlight = entry.id;
      overlay.dataset.burbotImportReviewFocused = entry.focused ? "true" : "false";
      overlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;" +
        `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;` +
        `border:${entry.focused ? 2.5 : 1.5}px solid ${color.border};background:${color.fill};` +
        `box-shadow:${
          entry.focused
            ? `0 0 0 4px ${color.soft},0 0 0 1px ${color.border} inset`
            : `0 0 0 1px ${color.soft} inset`
        };border-radius:2px;`;
      document.documentElement.append(overlay);
      overlays.push(overlay);
    }
  }
}

function schedule(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(draw);
}

function scrollToFocused(): void {
  const focused = ranges.find((entry) => entry.focused);
  if (!focused) return;
  const element =
    focused.range.startContainer instanceof Element
      ? focused.range.startContainer
      : focused.range.startContainer.parentElement;
  element?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  window.setTimeout(schedule, 120);
}

function show(highlights: ReviewHighlight[], focusId?: string): void {
  clear();
  const root = document.body ?? document.documentElement;
  const index = canonicalText(root);
  ranges = highlights.flatMap((highlight) => {
    const range = resolveBestRange(index, highlight);
    return range
      ? [
          {
            range,
            id: highlight.id,
            colorKey: highlight.colorKey,
            focused: highlight.id === focusId,
          },
        ]
      : [];
  });
  draw();
  if (focusId) scrollToFocused();
}

const listener = (message: unknown): undefined | Promise<{ ok: true }> => {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS"
  ) {
    return undefined;
  }
  const payload = message as ReviewMessage;
  show(Array.isArray(payload.highlights) ? payload.highlights : [], payload.focusId);
  return Promise.resolve({ ok: true });
};

browser.runtime.onMessage.addListener(listener);
window.addEventListener("scroll", schedule, true);
window.addEventListener("resize", schedule);

globalThis.__burbotImportReviewHighlighterDispose = () => {
  clear();
  browser.runtime.onMessage.removeListener(listener);
  window.removeEventListener("scroll", schedule, true);
  window.removeEventListener("resize", schedule);
};

export {};
