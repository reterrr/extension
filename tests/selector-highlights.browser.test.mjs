import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  openHighlighter,
  measureHighlights,
} from "./helpers/highlighter-browser.mjs";

test("page highlights share text indexes, retain overlays and recover after DOM changes", async (t) => {
  const { browser, page } = await openHighlighter(
    resolve(import.meta.dirname, ".."),
  );
  t.after(() => browser.close());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  assert.equal(await page.evaluate(() => window.__highlights.observations), 0);
  const result = await measureHighlights(page);
  t.diagnostic(JSON.stringify(result));
  assert.equal(
    result.initial_walks,
    1,
    "one canonical index for all body quotes",
  );
  assert.equal(
    result.repeat_walks,
    0,
    "unchanged messages must not rescan text",
  );
  assert.equal(
    result.retained,
    true,
    "unchanged overlays retain their DOM identity",
  );

  await page.evaluate(() => {
    window.__walksBefore = window.__highlights.walks;
    document.querySelector("#clock").textContent = "1";
  });
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.__highlights.walks),
    result.initial_walks,
  );

  await page.evaluate(() => {
    const paragraph = document.querySelector("#quote-0");
    paragraph.outerHTML =
      '<p id="quote-0">Nowe położenie. Unikalny cytat numer 0.</p>';
  });
  await page.waitForFunction(
    () => window.__highlights.walks > window.__walksBefore,
  );
  assert.equal(
    await page.evaluate(() => {
      const text = document.querySelector("#quote-0").firstChild;
      const range = document.createRange();
      range.setStart(text, text.textContent.indexOf("Unikalny"));
      range.setEnd(text, text.length);
      const actual = document
        .querySelector('[data-burbot-selector-highlight="quote-0"]')
        .getBoundingClientRect();
      const expected = range.getBoundingClientRect();
      return (
        Math.abs(actual.left - expected.left) < 1 &&
        Math.abs(actual.width - expected.width) < 1
      );
    }),
    true,
    "replaced text is anchored at the new location",
  );

  await page.evaluate(async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a id="file" href="/regulamin.pdf">Regulamin PDF</a>',
    );
    await window.__highlights.show([
      ...window.__fixtureHighlights,
      { id: "file-source:pdf", selector: 'a[href="/regulamin.pdf"]' },
    ]);
  });
  assert.equal(
    await page
      .locator('[data-burbot-selector-highlight="file-source:pdf"]')
      .count(),
    1,
  );
  await page.evaluate(async () => {
    window.__walksBefore = window.__highlights.walks;
    await window.__highlights.show([
      { id: "file-source:pdf", selector: 'a[href="/regulamin.pdf"]' },
    ]);
  });
  assert.equal(
    await page.locator("[data-burbot-selector-highlight]").count(),
    1,
  );
  assert.equal(
    await page.evaluate(
      () => window.__highlights.walks === window.__walksBefore,
    ),
    true,
  );
  await page.evaluate(() => {
    document.querySelector("#file").outerHTML =
      '<a href="/regulamin.pdf">Nowy link PDF</a>';
  });
  await page.waitForFunction(() => {
    const overlay = document.querySelector(
      '[data-burbot-selector-highlight="file-source:pdf"]',
    );
    const link = document.querySelector('a[href="/regulamin.pdf"]');
    return (
      Math.abs(
        overlay.getBoundingClientRect().width -
          link.getBoundingClientRect().width,
      ) < 1
    );
  });
  await page.evaluate(() => window.__highlights.show([]));
  assert.equal(
    await page.locator("[data-burbot-selector-highlight]").count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.__highlights.observations), 0);
  await page.evaluate(() => document.body.replaceChildren());
  await page.waitForTimeout(180);
  assert.equal(
    await page.locator("[data-burbot-selector-highlight]").count(),
    0,
  );
  assert.deepEqual(errors, []);
});
