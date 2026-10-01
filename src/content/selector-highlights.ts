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
  signature: string;
  element: Element | null;
  anchor: Node;
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

function quoteRange(index: CanonicalText, quote: SelectionQuote): Range | null {
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

function syncOverlayRects(entry: HighlightEntry, rects: DOMRect[]): void {
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
let pendingMutations: MutationRecord[] = [];
let observing = false;

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
  pendingMutations = [];
  observer.disconnect();
  observing = false;
  clearEntries();
}

function position(): void {
  frame = null;
  // Read all layout before writing any overlay styles to avoid layout thrash.
  const rects = entries.map((entry) =>
    targetConnected(entry.target) ? targetRects(entry.target) : [],
  );
  entries.forEach((entry, index) => syncOverlayRects(entry, rects[index]));
}

function schedulePosition(): void {
  if (!entries.length || frame !== null) return;
  frame = requestAnimationFrame(position);
}

function rebuild(): void {
  const mutations = [...pendingMutations, ...observer.takeRecords()]
    .filter((mutation) => !isOwnHighlightMutation(mutation));
  pendingMutations = [];
  if (rebuildTimer !== undefined) clearTimeout(rebuildTimer);
  rebuildTimer = undefined;
  const previous = new Map(entries.map((entry) => [entry.id, entry]));
  const next: HighlightEntry[] = [];
  const pageRoot = document.body ?? document.documentElement;
  // Many imported quotes share body as a fallback: walk that text only once.
  const textIndexes = new Map<Element, CanonicalText>();
  const quoteTarget = (root: Element, quote: SelectionQuote) => {
    let index = textIndexes.get(root);
    if (!index) {
      index = canonicalText(root);
      textIndexes.set(root, index);
    }
    return quoteRange(index, quote);
  };
  const resolved = new Map<string, Element | null>();

  for (const highlight of currentHighlights) {
    const signature = JSON.stringify([highlight.selector, highlight.selectorFallbacks, highlight.quote]);
    const old = previous.get(highlight.id);
    const unchanged = old?.signature === signature;
    if (unchanged && !mutations.length && targetConnected(old.target) && old.anchor.isConnected) {
      next.push(old);
      previous.delete(highlight.id);
      continue;
    }
    const selectorKey = JSON.stringify(selectorCandidates(highlight));
    if (!resolved.has(selectorKey)) resolved.set(selectorKey, resolveElement(highlight));
    const element = resolved.get(selectorKey) ?? null;
    let target: Element | Range | null = null;

    if (unchanged && old.element === element && targetConnected(old.target) &&
        old.anchor.isConnected && !mutations.some((mutation) => touchesAnchor(mutation, old.anchor))) {
      target = old.target;
    } else if (highlight.quote) {
      // Prefer the resolved durable container, but if the page has rearranged
      // its wrappers entirely, the quote itself can still identify the exact
      // text globally.
      target =
        (element ? quoteTarget(element, highlight.quote) : null) ??
        quoteTarget(pageRoot, highlight.quote) ??
        element;
    } else {
      target = element;
    }

    if (!target) continue;

    const entry: HighlightEntry = {
      id: highlight.id,
      selector: highlight.selector,
      signature,
      element,
      anchor: target instanceof Range
        ? (target.commonAncestorContainer instanceof Text
            ? target.commonAncestorContainer.parentElement ?? target.commonAncestorContainer
            : target.commonAncestorContainer)
        : target,
      target,
      overlays: unchanged && (old.target instanceof Range) === (target instanceof Range)
        ? old.overlays : [],
    };
    if (entry.overlays === old?.overlays) previous.delete(highlight.id);
    next.push(entry);
  }
  for (const entry of previous.values())
    for (const overlay of entry.overlays) overlay.remove();
  entries = next;
  if (frame !== null) cancelAnimationFrame(frame);
  position();
}

function show(highlights: SelectorHighlight[]): void {
  if (!highlights.length) {
    clear();
    return;
  }
  currentHighlights = highlights;
  if (!observing) {
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["id", "class", "href", "src", "datetime", "title", "alt", "content"],
    });
    observing = true;
  }
  rebuild();
}

function scheduleRebuild(): void {
  // A continuously updating page must not postpone highlights indefinitely.
  if (!currentHighlights.length || rebuildTimer !== undefined) return;
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

function touchesAnchor(mutation: MutationRecord, anchor: Node): boolean {
  const overlaps = (node: Node) => node.contains(anchor) || anchor.contains(node);
  return mutation.type === "childList"
    ? [...mutation.addedNodes, ...mutation.removedNodes].some(overlaps)
    : overlaps(mutation.target);
}

const observer = new MutationObserver((mutations) => {
  const relevant = mutations.filter((mutation) => !isOwnHighlightMutation(mutation));
  if (!relevant.length) return;
  pendingMutations.push(...relevant);
  scheduleRebuild();
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
