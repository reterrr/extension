import { runExtractionRules } from "./extraction-runner";
import {
  isPickerRequest,
  isPickerSelectionRequest,
  type PickerPortMessage,
  type PickerRpcValue,
  type PickerSelectionResponse,
  type SelectorHighlight,
} from "../shared/messaging/picker";
import { selectorColor } from "../shared/selectorPalette";
import { createRemotePdfSourceCandidate } from "../shared/sources/remoteFile";
import type {
  AttributeExtraction,
  SupportedExtractionAttribute,
} from "../shared/types/extraction";
import type {
  ElementExtractionCandidate,
  ElementExtractionCandidateOption,
} from "../shared/types/picker";

if (!globalThis.__burbotPickerLoaded) {
  globalThis.__burbotPickerLoaded = true;

  const C = BurbotCore;

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function selectorFor(element: Element): string {
    const unique = (selector: string): boolean => {
      const nodes = document.querySelectorAll(selector);
      return nodes.length === 1 && nodes[0] === element;
    };

    if (element.id) {
      const id = `#${CSS.escape(element.id)}`;
      if (unique(id)) return id;
    }

    for (const attr of ["data-testid", "data-test", "itemprop", "name"]) {
      const value = element.getAttribute(attr);
      if (!value) continue;

      const selector = `${element.localName}[${attr}=${CSS.escape(value)}]`;
      if (unique(selector)) return selector;
    }

    const classes = Array.from(element.classList)
      .filter((className) => className.length < 70)
      .slice(0, 3);

    if (classes.length) {
      const selector =
        element.localName + classes.map((name) => `.${CSS.escape(name)}`).join("");
      if (unique(selector)) return selector;
    }

    const path: string[] = [];

    for (let node: Element | null = element; node; node = node.parentElement) {
      let segment = CSS.escape(node.localName);

      if (
        node.id &&
        document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1
      ) {
        path.unshift(`#${CSS.escape(node.id)}`);
        const result = path.join(" > ");
        if (unique(result)) return result;
        path.shift();
      }

      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (sibling) => sibling.localName === node.localName,
          )
        : [node];

      if (siblings.length > 1) {
        segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }

      path.unshift(segment);
      const result = path.join(" > ");
      if (unique(result)) return result;
    }

    throw new Error("Cannot create a unique selector.");
  }

  function candidateFor(
    element: Element | null,
    range?: Range,
  ): ElementExtractionCandidate {
    if (!element || element.getRootNode() !== document) {
      throw new Error("Shadow DOM is not supported in this version.");
    }

    if (
      element.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    ) {
      throw new Error("Choose page content outside editable controls.");
    }

    const selector = selectorFor(element);
    const options: ElementExtractionCandidateOption[] = [];
    const full = C.clean(element.textContent);

    if (range) {
      const exact = C.clean(range.toString());
      const preceding = document.createRange();

      preceding.selectNodeContents(element);
      preceding.setEnd(range.startContainer, range.startOffset);

      const before = C.clean(preceding.toString());
      const positions = C.occurrences(full, exact).filter(
        (index) => C.clean(full.slice(0, index)) === before,
      );

      if (positions.length !== 1) {
        throw new Error("Could not anchor the selection. Pick its whole element.");
      }

      const start = positions[0];
      const end = start + exact.length;
      const quote = {
        exact,
        prefix: full.slice(Math.max(0, start - 60), start),
        suffix: full.slice(end, end + 60),
      };

      options.push({
        label: "Selected text",
        raw: exact,
        extraction: { type: "selection", quote },
      });
    }

    if (full) {
      options.push({
        label: "Element text",
        raw: full,
        extraction: { type: "text" },
      });
    }

    const attributes: SupportedExtractionAttribute[] = [
      "href",
      "src",
      "datetime",
      "title",
      "alt",
      "content",
    ];

    for (const attribute of attributes) {
      try {
        const extraction: AttributeExtraction = { type: "attribute", attribute };
        const raw = C.readElement(element, extraction);

        if (raw) {
          options.push({
            label: `Attribute: ${attribute}`,
            raw,
            extraction,
          });
        }
      } catch {
        // Missing/unsupported attributes are simply omitted from the UI options.
      }
    }

    return {
      pageUrl: location.href,
      selector,
      options: options.filter((option) => option.raw.length <= 100000),
    };
  }

  let lastSelection: ElementExtractionCandidate | null = null;

  function selectionCandidate(): ElementExtractionCandidate {
    const selection = window.getSelection();

    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      lastSelection = candidateFor(element, range);
    }

    if (!lastSelection || lastSelection.pageUrl !== location.href) {
      throw new Error("Select text on this page first.");
    }

    return lastSelection;
  }

  document.addEventListener(
    "contextmenu",
    () => {
      try {
        selectionCandidate();
      } catch {
        // Context-menu creation is best-effort; the background validates the result.
      }
    },
    true,
  );

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isPickerSelectionRequest(message)) return undefined;

    try {
      const response: PickerSelectionResponse = {
        ok: true,
        value: selectionCandidate(),
      };
      return Promise.resolve(response);
    } catch (error) {
      const response: PickerSelectionResponse = {
        ok: false,
        error: errorMessage(error),
      };
      return Promise.resolve(response);
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (
      ![
        "burbot-picker",
        "burbot-file-picker",
        "burbot-selector-highlights",
      ].includes(port.name)
    ) {
      return;
    }

    let picking = false;
    let filePicking = false;
    let overlay: HTMLDivElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let highlightFrame: number | null = null;
    let highlighted: Array<{
      selector: string;
      element: Element;
      overlay: HTMLDivElement;
    }> = [];

    const send = (message: PickerPortMessage): void => {
      try {
        port.postMessage(message);
      } catch {
        // The side panel can disappear while a page event is being handled.
      }
    };

    function clearSelectorHighlights(): void {
      if (highlightFrame !== null) cancelAnimationFrame(highlightFrame);
      highlightFrame = null;
      for (const entry of highlighted) entry.overlay.remove();
      highlighted = [];
    }

    function positionSelectorHighlights(): void {
      highlightFrame = null;
      for (const entry of highlighted) {
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

    function scheduleSelectorHighlightPosition(): void {
      if (highlightFrame !== null) return;
      highlightFrame = requestAnimationFrame(positionSelectorHighlights);
    }

    function showSelectorHighlights(highlights: SelectorHighlight[]): void {
      clearSelectorHighlights();
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
          const selectorOverlay = document.createElement("div");
          selectorOverlay.dataset.burbotSelectorHighlight = highlight.id;
          selectorOverlay.style.cssText =
            "position:fixed;pointer-events:none;z-index:2147483645;" +
            "box-sizing:border-box;border-radius:4px;" +
            `border:1.5px solid ${color.border};background:${color.fill};` +
            `box-shadow:0 0 0 1px ${color.soft} inset;`;
          document.documentElement.append(selectorOverlay);
          highlighted.push({
            selector: highlight.selector,
            element,
            overlay: selectorOverlay,
          });
        }
      }

      positionSelectorHighlights();
    }

    function stop(): void {
      picking = false;
      filePicking = false;
      overlay?.remove();
      overlay = null;
      send({ event: "MODE", picking: false });
    }

    function start(fileMode: boolean): void {
      stop();
      picking = true;
      filePicking = fileMode;
      overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483647;" +
        "box-sizing:border-box;border-radius:4px;border:2px solid #6f98bd;" +
        "background:#6f98bd24;box-shadow:0 0 0 1px #ffffffaa inset;";
      document.documentElement.append(overlay);
      send({ event: "MODE", picking: true });
    }

    function fail(error: unknown): void {
      send({ event: "ERROR", error: errorMessage(error) });
    }

    function captureSelection(): void {
      if (picking) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      try {
        const candidate = selectionCandidate();
        if (candidate.options.length) send({ event: "CAPTURE", candidate });
      } catch (error) {
        fail(error);
      }
    }

    function draw(event: PointerEvent): void {
      if (!picking || !overlay || !(event.target instanceof Element)) return;

      const target = filePicking
        ? event.target.closest("a[href]") ?? event.target
        : event.target;
      const rect = target.getBoundingClientRect();

      if (!filePicking) {
        try {
          const color = selectorColor(selectorFor(target));
          overlay.style.borderColor = color.border;
          overlay.style.background = color.fill;
        } catch {
          // Keep the default pastel picker color until a selector can be built.
        }
      }

      Object.assign(overlay.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }

    function block(event: Event): void {
      if (!picking) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function click(event: MouseEvent): void {
      if (!picking) return;

      block(event);
      const element = event.target instanceof Element ? event.target : null;

      if (filePicking) {
        try {
          const link = element?.closest("a[href]");
          if (!(link instanceof HTMLAnchorElement)) {
            throw new Error("Click a link to a PDF file.");
          }
          const file = createRemotePdfSourceCandidate(
            link.href,
            location.href,
            link.download || link.textContent,
          );
          stop();
          send({ event: "FILE_CAPTURE", file });
        } catch (error) {
          fail(error);
        }
        return;
      }

      stop();
      try {
        const candidate = candidateFor(element);

        if (!candidate.options.length) {
          throw new Error("This element has no usable text or attribute.");
        }

        send({ event: "CAPTURE", candidate });
      } catch (error) {
        fail(error);
      }
    }

    function key(event: KeyboardEvent): void {
      if (picking && event.key === "Escape") {
        block(event);
        stop();
      }
    }

    function selected(): void {
      if (picking) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(captureSelection, 0);
    }

    port.onMessage.addListener((message: unknown) => {
      if (!isPickerRequest(message)) return;

      try {
        let value: PickerRpcValue;

        switch (message.op) {
          case "PICK":
            start(false);
            value = true;
            break;

          case "PICK_FILE":
            start(true);
            value = true;
            break;

          case "STOP":
            stop();
            value = true;
            break;

          case "RUN":
            value = runExtractionRules(message.rules, {
              pageUrl: location.href,
              selectAll: (selector) => Array.from(document.querySelectorAll(selector)),
              readElement: (element, extraction) =>
                C.readElement(element, extraction),
            });
            break;

          case "SHOW_SELECTORS":
            showSelectorHighlights(message.highlights);
            value = true;
            break;

          case "URL":
            value = location.href;
            break;

          case "SELECTION":
            value = selectionCandidate();
            break;
        }

        send({ id: message.id, ok: true, value });
      } catch (error) {
        send({ id: message.id, ok: false, error: errorMessage(error) });
      }
    });

    document.addEventListener("pointermove", draw, true);
    document.addEventListener("pointerdown", block, true);
    document.addEventListener("pointerup", block, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerup", selected);
    document.addEventListener("keyup", selected);
    window.addEventListener("scroll", scheduleSelectorHighlightPosition, true);
    window.addEventListener("resize", scheduleSelectorHighlightPosition);

    port.onDisconnect.addListener(() => {
      if (timer !== undefined) clearTimeout(timer);
      overlay?.remove();
      clearSelectorHighlights();
      document.removeEventListener("pointermove", draw, true);
      document.removeEventListener("pointerdown", block, true);
      document.removeEventListener("pointerup", block, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerup", selected);
      document.removeEventListener("keyup", selected);
      window.removeEventListener("scroll", scheduleSelectorHighlightPosition, true);
      window.removeEventListener("resize", scheduleSelectorHighlightPosition);
    });
  });
}

export {};
