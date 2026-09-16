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

function quoteRange(root: Element, quote: SelectionQuote): Range | null {
  const index = canonicalText(root);
  const positions = occurrences(index.text, quote.exact);
  if (!positions.length) return null;

  const contextual = positions.filter((start) => {
    const end = start + quote.exact.length;
    const before = index.text.slice(Math.max(0, start - quote.prefix.length), start);
    const after = index.text.slice(end, end + quote.suffix.length);
    return before.endsWith(quote.prefix) && after.startsWith(quote.suffix);
  });

  const selected =
    contextual.length === 1
      ? contextual[0]
      : positions.length === 1
        ? positions[0]
        : null;
  if (selected === null || quote.exact.length === 0) return null;

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
  const color = selectorColor(selector);
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

globalThis.__burbotSelectorHighlighterRuntime?.dispose();

let frame: number | null = null;
let entries: HighlightEntry[] = [];

function clear(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  for (const entry of entries) {
    for (const overlay of entry.overlays) overlay.remove();
  }
  entries = [];
}

function position(): void {
  frame = null;
  for (const entry of entries) syncOverlayRects(entry);
}

function schedulePosition(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(position);
}

function show(highlights: SelectorHighlight[]): void {
  clear();
  const pageRoot = document.body ?? document.documentElement;

  for (const highlight of highlights) {
    const element = resolveElement(highlight);
    let target: Element | Range | null = null;

    if (highlight.quote) {
      // Selection rules must never degrade into an element-sized box. If the
      // exact text cannot be reconstructed, omit the visual highlight instead
      // of showing a misleading larger region.
      target =
        (element ? quoteRange(element, highlight.quote) : null) ??
        quoteRange(pageRoot, highlight.quote);
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

const onMessage = (message: unknown): undefined | Promise<{ ok: true }> => {
  if (!isHighlightMessage(message)) return undefined;
  show(message.highlights);
  return Promise.resolve({ ok: true });
};

browser.runtime.onMessage.addListener(onMessage);
window.addEventListener("scroll", schedulePosition, true);
window.addEventListener("resize", schedulePosition);

globalThis.__burbotSelectorHighlighterRuntime = {
  dispose() {
    clear();
    browser.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
  },
};

export {};
