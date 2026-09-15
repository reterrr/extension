(() => {
  if (globalThis.__burbotPickerLoaded) return;
  globalThis.__burbotPickerLoaded = true;

  const C = BurbotCore;

  function selectorFor(element) {
    const unique = (selector) => {
      const nodes = document.querySelectorAll(selector);
      return nodes.length === 1 && nodes[0] === element;
    };

    if (element.id) {
      const id = "#" + CSS.escape(element.id);
      if (unique(id)) return id;
    }

    for (const attr of ["data-testid", "data-test", "itemprop", "name"]) {
      const value = element.getAttribute(attr);
      if (!value) continue;

      const selector =
        element.localName + "[" + attr + "=" + CSS.escape(value) + "]";

      if (unique(selector)) return selector;
    }

    const classes = Array.from(element.classList)
      .filter((c) => c.length < 70)
      .slice(0, 3);

    if (classes.length) {
      const selector =
        element.localName + classes.map((c) => "." + CSS.escape(c)).join("");

      if (unique(selector)) return selector;
    }

    const path = [];

    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      let segment = CSS.escape(node.localName);

      if (
        node.id &&
        document.querySelectorAll("#" + CSS.escape(node.id)).length === 1
      ) {
        path.unshift("#" + CSS.escape(node.id));
        const result = path.join(" > ");
        if (unique(result)) return result;
        path.shift();
      }

      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (s) => s.localName === node.localName,
          )
        : [node];

      if (siblings.length > 1)
        segment += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";

      path.unshift(segment);
      const result = path.join(" > ");

      if (unique(result)) return result;
    }

    throw Error("Cannot create a unique selector.");
  }

  function candidateFor(element, range) {
    if (!element || element.getRootNode() !== document)
      throw Error("Shadow DOM is not supported in this version.");

    if (
      element.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    )
      throw Error("Choose page content outside editable controls.");

    const selector = selectorFor(element);
    const options = [];
    const full = C.clean(element.textContent);

    if (range) {
      const exact = C.clean(range.toString());
      const preceding = document.createRange();

      preceding.selectNodeContents(element);
      preceding.setEnd(range.startContainer, range.startOffset);

      const before = C.clean(preceding.toString());
      const positions = C.occurrences(full, exact).filter(
        (i) => C.clean(full.slice(0, i)) === before,
      );

      if (positions.length !== 1)
        throw Error("Could not anchor the selection. Pick its whole element.");

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

    for (const attribute of [
      "href",
      "src",
      "datetime",
      "title",
      "alt",
      "content",
    ]) {
      try {
        const extraction = { type: "attribute", attribute };
        const raw = C.readElement(element, extraction);

        if (raw)
          options.push({ label: "Attribute: " + attribute, raw, extraction });
      } catch {}
    }

    return {
      pageUrl: location.href,
      selector,
      options: options.filter((o) => o.raw.length <= 100000),
    };
  }

  let lastSelection = null;
  function selectionCandidate() {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      lastSelection = candidateFor(
        node.nodeType === 1 ? node : node.parentElement,
        range,
      );
    }
    if (!lastSelection || lastSelection.pageUrl !== location.href)
      throw Error("Select text on this page first.");
    return lastSelection;
  }
  document.addEventListener(
    "contextmenu",
    () => {
      try {
        selectionCandidate();
      } catch {}
    },
    true,
  );
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "BURBOT_SELECTION") return undefined;
    try {
      return Promise.resolve({ ok: true, value: selectionCandidate() });
    } catch (error) {
      return Promise.resolve({ ok: false, error: error.message });
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "burbot-picker") return;

    let picking = false;
    let overlay = null;
    let timer = null;

    const send = (message) => {
      try {
        port.postMessage(message);
      } catch {}
    };

    function stop() {
      picking = false;
      overlay?.remove();
      overlay = null;
      send({ event: "MODE", picking: false });
    }

    function fail(error) {
      send({ event: "ERROR", error: error.message });
    }

    function captureSelection() {
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

    function draw(event) {
      if (!picking || !overlay || !(event.target instanceof Element)) return;

      const rect = event.target.getBoundingClientRect();

      Object.assign(overlay.style, {
        top: rect.top + "px",
        left: rect.left + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    }

    function block(event) {
      if (picking) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function click(event) {
      if (!picking) return;

      block(event);
      const element = event.target;
      stop();

      try {
        const candidate = candidateFor(element);

        if (!candidate.options.length)
          throw Error("This element has no usable text or attribute.");

        send({ event: "CAPTURE", candidate });
      } catch (error) {
        fail(error);
      }
    }

    function key(event) {
      if (picking && event.key === "Escape") {
        block(event);
        stop();
      }
    }

    function selected() {
      if (picking) return;
      clearTimeout(timer);
      timer = setTimeout(captureSelection, 0);
    }

    function run(rules) {
      return rules.map((rule) => {
        try {
          if (rule.pageUrl !== location.href)
            throw Error("Open the original source page.");

          let raw;

          if (rule.extraction.type === "pageUrl") {
            raw = location.href;
          } else {
            const elements = document.querySelectorAll(rule.selector);

            if (elements.length !== 1)
              throw Error("Selector matched " + elements.length + " elements.");

            raw = C.readElement(elements[0], rule.extraction);
          }

          if (!raw || raw.length > 100000)
            throw Error("Extracted value is empty or too large.");

          return { ruleId: rule.id, raw };
        } catch (error) {
          return { ruleId: rule.id, error: error.message };
        }
      });
    }

    port.onMessage.addListener((message) => {
      try {
        let value;

        if (message.op === "PICK") {
          stop();
          picking = true;
          overlay = document.createElement("div");
          overlay.style.cssText =
            "position:fixed;pointer-events:none;z-index:2147483647;" +
            "box-sizing:border-box;border:2px solid #18a875;background:#18a87522;";

          document.documentElement.append(overlay);
          send({ event: "MODE", picking: true });
          value = true;
        } else if (message.op === "STOP") {
          stop();
          value = true;
        } else if (message.op === "RUN") {
          value = run(message.rules);
        } else if (message.op === "URL") {
          value = location.href;
        } else if (message.op === "SELECTION") {
          value = selectionCandidate();
        } else {
          throw Error("Unknown page request.");
        }

        send({ id: message.id, ok: true, value });
      } catch (error) {
        send({ id: message.id, ok: false, error: error.message });
      }
    });

    document.addEventListener("pointermove", draw, true);
    document.addEventListener("pointerdown", block, true);
    document.addEventListener("pointerup", block, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerup", selected);
    document.addEventListener("keyup", selected);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      overlay?.remove();
      document.removeEventListener("pointermove", draw, true);
      document.removeEventListener("pointerdown", block, true);
      document.removeEventListener("pointerup", block, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerup", selected);
      document.removeEventListener("keyup", selected);
    });
  });
})();
