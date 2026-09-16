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
};

type Boundary = { node: Text; offset: number };
type IndexedText = { text: string; starts: Boundary[]; ends: Boundary[] };

declare global {
  var __burbotImportReviewHighlighterDispose: (() => void) | undefined;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalText(root: Element): IndexedText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const starts: Boundary[] = [];
  const ends: Boundary[] = [];
  let text = "";
  let emitted = false;
  let whitespaceStart: Boundary | null = null;
  let whitespaceEnd: Boundary | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    if (node.parentElement?.closest("script,style,noscript,template")) continue;
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
  for (
    let index = text.indexOf(exact);
    index !== -1;
    index = text.indexOf(exact, index + Math.max(1, exact.length))
  ) {
    positions.push(index);
  }
  return positions;
}

function resolveRange(index: IndexedText, highlight: ReviewHighlight): Range | null {
  const exact = clean(highlight.exact);
  const prefix = clean(highlight.prefix);
  const suffix = clean(highlight.suffix);
  const positions = occurrences(index.text, exact);
  if (!positions.length) return null;

  const contextual = positions.filter((start) => {
    const end = start + exact.length;
    const before = index.text.slice(Math.max(0, start - prefix.length), start);
    const after = index.text.slice(end, end + suffix.length);
    return (!prefix || before.endsWith(prefix)) && (!suffix || after.startsWith(suffix));
  });
  const selected = contextual.length === 1
    ? contextual[0]
    : positions.length === 1
      ? positions[0]
      : null;
  if (selected === null || !exact) return null;

  const startBoundary = index.starts[selected];
  const endBoundary = index.ends[selected + exact.length - 1];
  if (!startBoundary || !endBoundary) return null;

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
}

globalThis.__burbotImportReviewHighlighterDispose?.();

let overlays: HTMLDivElement[] = [];
let ranges: Array<{ range: Range; id: string; colorKey: string }> = [];
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
      overlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;" +
        `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;` +
        `border:1.5px solid ${color.border};background:${color.fill};` +
        `box-shadow:0 0 0 1px ${color.soft} inset;border-radius:2px;`;
      document.documentElement.append(overlay);
      overlays.push(overlay);
    }
  }
}

function schedule(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(draw);
}

function show(highlights: ReviewHighlight[]): void {
  clear();
  document
    .querySelectorAll<HTMLElement>("[data-burbot-selector-highlight]")
    .forEach((element) => element.remove());

  const root = document.body ?? document.documentElement;
  const index = canonicalText(root);
  ranges = highlights.flatMap((highlight) => {
    const range = resolveRange(index, highlight);
    return range ? [{ range, id: highlight.id, colorKey: highlight.colorKey }] : [];
  });
  draw();
}

const listener = (message: unknown): undefined | Promise<{ ok: true }> => {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS"
  ) {
    return undefined;
  }
  const highlights = (message as ReviewMessage).highlights;
  show(Array.isArray(highlights) ? highlights : []);
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
