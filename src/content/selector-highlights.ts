import { selectorColor } from "../shared/selectorPalette";
import type { SelectorHighlight } from "../shared/messaging/picker";
import type { SelectionQuote } from "../shared/types/extraction";

type SelectorHighlightMessage = {
  type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS";
  highlights: SelectorHighlight[];
};

type SelectorHighlighterRuntime = {
  dispose(): void;
};

type Boundary = {
  node: Text;
  offset: number;
};

type CanonicalText = {
  text: string;
  starts: Boundary[];
  ends: Boundary[];
};

type HighlightEntry = {
  id: string;
  selector: string;
  target: Element | Range;
  overlays: HTMLDivElement[];
};

declare global {
  var __burbotSelectorHighlighterRuntime: SelectorHighlighterRuntime | undefined;
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

function isHighlight(value: unknown): value is SelectorHighlight {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.selector === "string" &&
    value.selector.length > 0 &&
    (value.selectorFallbacks === undefined ||
      (Array.isArray(value.selectorFallbacks) &&
        value.selectorFallbacks.every((entry) => typeof entry === "string"))) &&
    (value.quote === undefined || isQuote(value.quote))
  );
}

function isHighlightMessage(value: unknown): value is SelectorHighlightMessage {
  return (
    isRecord(value) &&
    value.type === "BURBOT_SHOW_SELECTOR_HIGHLIGHTS" &&
    Array.isArray(value.highlights) &&
    value.highlights.every(isHighlight)
  );
}

function selectorCandidates(highlight: SelectorHighlight): string[] {
  return Array.from(
    new Set([highlight.selector, ...(highlight.selectorFallbacks ?? [])].filter(Boolean)),
  );
}

function resolveElement(highlight: SelectorHighlight): Element | null {
  for (const selector of selectorCandidates(highlight)) {
    try {
      const matches = document.querySelectorAll(selector);
      if (matches.length === 1) return matches[0];
    } catch {
      // Try the next durable fallback selector.
    }
  }
  return null;
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

    const value = node.data;
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset];
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
  const result: number[] = [];
  if (!exact) return result;
  let offset = 0;
  while (offset <= text.length - exact.length) {
    const index = text.indexOf(exact, offset);
    if (index < 0) break;
    result.push(index);
    offset = index + Math.max(1, exact.length);
  }
  return result;
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
  return value
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

function quoteRange(root: Element, quote: SelectionQuote): Range | null {
  const index = canonicalText(root);
  const positions = occurrences(index.text, quote.exact);
  if (!positions.length || quote.exact.length === 0) return null;

  let selected = positions.length === 1 ? positions[0] : null;
  if (selected === null) {
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const start of positions) {
      const end = start + quote.exact.length;
      const before = index.text.slice(Math.max(0, start - 180), start);
      const after = index.text.slice(end, Math.min(index.text.length, end + 180));
      const exactPrefix = Boolean(quote.prefix) && before.endsWith(quote.prefix);
      const exactSuffix = Boolean(quote.suffix) && after.startsWith(quote.suffix);

      let score = 0;
      if (exactPrefix) score += 4000;
      if (exactSuffix) score += 4000;
      score += commonSuffixLength(before, quote.prefix) * 7;
      score += commonPrefixLength(after, quote.suffix) * 7;
      score += tokenOverlapScore(before, quote.prefix) * 3;
      score += tokenOverlapScore(after, quote.suffix) * 3;
      score += semanticScore(index.starts[start]?.node.parentElement ?? null);

      if (score > bestScore) {
        bestScore = score;
        selected = start;
      }
    }
  }
  if (selected === null) return null;

  const startBoundary = index.starts[selected];
  const endBoundary = index.ends[selected + quote.exact.length - 1];
  if (!startBoundary || !endBoundary) return null;

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
}

function targetConnected(target: Element | Range): boolean {
  if (target instanceof Element) return target.isConnected;
  return target.commonAncestorContainer.isConnected;
}

function targetRects(target: Element | Range): DOMRect[] {
  if (target instanceof Range) {
    return Array.from(target.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
  }

  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? [rect] : [];
}

function createOverlay(
  id: string,
  selector: string,
  exactText: boolean,
): HTMLDivElement {
  const color = id.startsWith("file-source:")
    ? {
        border: "#2f7659",
        fill: "#2f765924",
        soft: "#2f765933",
      }
    : selectorColor(selector);
  const overlay = document.createElement("div");
  overlay.dataset.burbotSelectorHighlight = id;
  overlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483645;box-sizing:border-box;" +
    `border:${exactText ? "1.5px" : "2px"} solid ${color.border};` +
    `background:${color.fill};box-shadow:0 0 0 1px ${color.soft} inset;` +
    `border-radius:${exactText ? "2px" : "4px"};`;
  document.documentElement.append(overlay);
  return overlay;
}

function syncOverlayRects(entry: HighlightEntry): void {
  const rects = targetConnected(entry.target) ? targetRects(entry.target) : [];

  while (entry.overlays.length < rects.length) {
    entry.overlays.push(
      createOverlay(entry.id, entry.selector, entry.target instanceof Range),
    );
  }
  while (entry.overlays.length > rects.length) {
    entry.overlays.pop()?.remove();
  }

  for (let index = 0; index < entry.overlays.length; index += 1) {
    const overlay = entry.overlays[index];
    const rect = rects[index];
    Object.assign(overlay.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
}

// Replace an older injected highlighter in-place. This deliberately does not
// share picker.ts's singleton guard, so rebuilding/reloading the extension can
// update overlays on tabs that were already open.
globalThis.__burbotSelectorHighlighterRuntime?.dispose();

let frame: number | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let entries: HighlightEntry[] = [];
let currentHighlights: SelectorHighlight[] = [];

function clearEntries(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  for (const entry of entries) {
    for (const overlay of entry.overlays) overlay.remove();
  }
  entries = [];
}

function clear(): void {
  if (rebuildTimer !== undefined) {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
  }
  currentHighlights = [];
  clearEntries();
}

function position(): void {
  frame = null;
  for (const entry of entries) syncOverlayRects(entry);
}

function schedulePosition(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(position);
}

function rebuild(): void {
  clearEntries();
  const pageRoot = document.body ?? document.documentElement;

  for (const highlight of currentHighlights) {
    const element = resolveElement(highlight);
    let target: Element | Range | null = null;

    if (highlight.quote) {
      // Prefer the resolved durable container, but if the page has rearranged
      // its wrappers entirely, the quote itself can still identify the exact
      // text globally.
      target =
        (element ? quoteRange(element, highlight.quote) : null) ??
        quoteRange(pageRoot, highlight.quote) ??
        element;
    } else {
      target = element;
    }

    if (!target) continue;

    const entry: HighlightEntry = {
      id: highlight.id,
      selector: highlight.selector,
      target,
      overlays: [],
    };
    entries.push(entry);
    syncOverlayRects(entry);
  }
}

function show(highlights: SelectorHighlight[]): void {
  currentHighlights = highlights;
  rebuild();
}

function scheduleRebuild(): void {
  if (rebuildTimer !== undefined) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    rebuild();
  }, 120);
}

const onMessage = (message: unknown): undefined | Promise<{ ok: true }> => {
  if (!isHighlightMessage(message)) return undefined;
  show(message.highlights);
  return Promise.resolve({ ok: true });
};

browser.runtime.onMessage.addListener(onMessage);
window.addEventListener("scroll", schedulePosition, true);
window.addEventListener("resize", schedulePosition);

function isOwnHighlightNode(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches("[data-burbot-selector-highlight]") ||
      Boolean(node.closest("[data-burbot-selector-highlight]")))
  );
}

function isOwnHighlightMutation(mutation: MutationRecord): boolean {
  const target =
    mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
  if (target?.closest("[data-burbot-selector-highlight]")) return true;

  if (mutation.type !== "childList") return false;
  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  return changed.length > 0 && changed.every(isOwnHighlightNode);
}

const observedRoot = document.body ?? document.documentElement;
const observer = new MutationObserver((mutations) => {
  if (mutations.every(isOwnHighlightMutation)) return;
  scheduleRebuild();
});
observer.observe(observedRoot, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["id", "class", "href", "src", "datetime", "title", "alt", "content"],
});

globalThis.__burbotSelectorHighlighterRuntime = {
  dispose() {
    clear();
    browser.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    observer.disconnect();
  },
};

export {};
