import { build } from "esbuild";
import { chromium } from "playwright";

export async function openHighlighter(root) {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["src/content/selector-highlights.ts"],
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  const browser = await chromium.launch({
    executablePath: process.env.BURBOT_CHROMIUM || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(
    '<html><head><base href="https://example.test/"></head><body></body></html>',
  );
  await page.evaluate(() => {
    const listeners = new Set();
    window.__highlights = {
      walks: 0,
      observations: 0,
      async show(highlights) {
        for (const listener of listeners)
          await listener({
            type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS",
            highlights,
          });
      },
    };
    window.browser = {
      runtime: {
        onMessage: {
          addListener: (listener) => listeners.add(listener),
          removeListener: (listener) => listeners.delete(listener),
        },
      },
    };
    const walk = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => {
      window.__highlights.walks++;
      return walk(...args);
    };
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        super(callback);
        this.tracked = window.__highlights.captureRuntime;
      }
      observe(...args) {
        if (this.tracked && !this.active) window.__highlights.observations++;
        this.active = true;
        super.observe(...args);
      }
      disconnect() {
        if (this.tracked && this.active) window.__highlights.observations--;
        this.active = false;
        super.disconnect();
      }
    };
  });
  await page.evaluate((source) => {
    window.__highlights.captureRuntime = true;
    (0, eval)(source);
    window.__highlights.captureRuntime = false;
  }, bundle.outputFiles[0].text);
  return { browser, page };
}

export async function measureHighlights(page) {
  return page.evaluate(async () => {
    document.body.innerHTML =
      '<div id="clock">0</div>' +
      Array.from(
        { length: 60 },
        (_, i) =>
          `<p id="quote-${i}">Kontekst ${i}. Unikalny cytat numer ${i}. ${"Treść regulaminu. ".repeat(50)}</p>`,
      ).join("");
    const highlights = Array.from({ length: 60 }, (_, i) => ({
      id: `quote-${i}`,
      selector: "body",
      quote: {
        exact: `Unikalny cytat numer ${i}.`,
        prefix: `Kontekst ${i}. `,
        suffix: "",
      },
    }));
    window.__highlights.walks = 0;
    let start = performance.now();
    await window.__highlights.show(highlights);
    const initialMs = performance.now() - start;
    const initialWalks = window.__highlights.walks;
    const original = document.querySelector(
      '[data-burbot-selector-highlight="quote-0"]',
    );
    const updates = [];
    for (let i = 0; i < 5; i++) {
      start = performance.now();
      await window.__highlights.show(highlights);
      updates.push(performance.now() - start);
    }
    updates.sort((a, b) => a - b);
    window.__fixtureHighlights = highlights;
    return {
      initial_ms: +initialMs.toFixed(2),
      repeat_ms: +updates[2].toFixed(2),
      initial_walks: initialWalks,
      repeat_walks: window.__highlights.walks - initialWalks,
      retained:
        original ===
        document.querySelector('[data-burbot-selector-highlight="quote-0"]'),
    };
  });
}
