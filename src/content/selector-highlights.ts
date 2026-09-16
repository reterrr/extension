import { selectorColor } from "../shared/selectorPalette";
import type { SelectorHighlight } from "../shared/messaging/picker";

type SelectorHighlightMessage = {
  type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS";
  highlights: SelectorHighlight[];
};

type SelectorHighlighterRuntime = {
  dispose(): void;
};

declare global {
  var __burbotSelectorHighlighterRuntime: SelectorHighlighterRuntime | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHighlight(value: unknown): value is SelectorHighlight {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.selector === "string" &&
    value.selector.length > 0
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

// Replace an older injected highlighter in-place. This deliberately does not
// share picker.ts's singleton guard, so rebuilding/reloading the extension can
// update overlays on tabs that were already open.
globalThis.__burbotSelectorHighlighterRuntime?.dispose();

let frame: number | null = null;
let entries: Array<{
  element: Element;
  overlay: HTMLDivElement;
}> = [];

function clear(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  for (const entry of entries) entry.overlay.remove();
  entries = [];
}

function position(): void {
  frame = null;

  for (const entry of entries) {
    if (!entry.element.isConnected) {
      entry.overlay.hidden = true;
      continue;
    }

    const rect = entry.element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    entry.overlay.hidden = !visible;
    if (!visible) continue;

    Object.assign(entry.overlay.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
}

function schedulePosition(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(position);
}

function show(highlights: SelectorHighlight[]): void {
  clear();
  const seen = new Set<string>();

  for (const highlight of highlights) {
    if (seen.has(highlight.selector)) continue;
    seen.add(highlight.selector);

    let elements: Element[];
    try {
      elements = Array.from(document.querySelectorAll(highlight.selector));
    } catch {
      continue;
    }

    const color = selectorColor(highlight.selector);
    for (const element of elements) {
      const overlay = document.createElement("div");
      overlay.dataset.burbotSelectorHighlight = highlight.id;
      overlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483645;" +
        "box-sizing:border-box;border-radius:4px;" +
        `border:2px solid ${color.border};background:${color.fill};` +
        `box-shadow:0 0 0 1px ${color.soft} inset;`;
      document.documentElement.append(overlay);
      entries.push({ element, overlay });
    }
  }

  position();
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
