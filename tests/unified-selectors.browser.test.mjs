import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { openHighlighter } from "./helpers/highlighter-browser.mjs";

const root = resolve(import.meta.dirname, "..");
let browser, bundle, pickerBundle;
before(async () => {
  bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents:
        'export * from "./src/content/selector-resolver.ts"; export * from "./src/content/durable-selector.ts"; export * from "./src/shared/selectors/repository.ts"; export * from "./src/shared/extraction/rules.ts"; export * from "./src/sidepanel/selectorTreeEditor.ts"; import "./src/shared/domain/schema.js"; import "./src/shared/domain/core.js";',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "UnifiedSelectors",
    logLevel: "silent",
  });
  browser = await chromium.launch({
    executablePath: process.env.BURBOT_CHROMIUM || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  pickerBundle = await build({
    absWorkingDir: root,
    entryPoints: ["src/content/picker.ts"],
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
});
after(async () => {
  await browser?.close();
});

async function pageWith(html) {
  const page = await browser.newPage();
  // HTTPS origin supplies crypto.randomUUID, as it does in extension pages.
  await page.route("https://selector.test/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto("https://selector.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return page;
}

test("picker captures verified CSS, XPath, id and TextQuote alternatives in one part", async (t) => {
  const page = await pageWith(
    '<div class="funding"><span id="funding-value" data-testid="value">80%</span></div>',
  );
  t.after(() => page.close());
  const result = await page.evaluate(() => {
    const u = UnifiedSelectors;
    const element = document.getElementById("funding-value");
    const css = u.buildDurableSelectors(element);
    const v = u.buildCapturedSelectorVersion(
      element,
      css,
      { type: "text" },
      "80%",
    );
    const before = u.evaluateSelectorVersion(
      v,
      u.createDOMSelectorRuntime(document),
    );
    const kinds = v.recipes[0].parts[0].locators.map((locator) => locator.kind);
    // Change structural attributes: XPath and CSS may stop matching, but the
    // independently verified quote still resolves after complete replacement.
    element.outerHTML = '<section class="changed"><b>80%</b></section>';
    const after = u.evaluateSelectorVersion(
      v,
      u.createDOMSelectorRuntime(document),
    );
    return {
      before,
      after,
      kinds,
      recipeCount: v.recipes.length,
      partCount: v.recipes[0].parts.length,
    };
  });
  assert.equal(result.before.status, "success");
  assert.equal(result.after.status, "success");
  assert.equal(result.after.rawValue, "80%");
  assert.equal(result.recipeCount, 1);
  assert.equal(result.partCount, 1);
  for (const kind of ["css_path", "xpath", "element_id", "text_quote"])
    assert.ok(result.kinds.includes(kind), kind);
  assert.ok(
    result.after.recipeResults[0].partResults[0].locatorResults.some(
      (item) => item.status === "not_found",
    ),
  );
});

async function installPicker(page) {
  await page.evaluate(() => {
    window.pickerListeners = [];
    window.pickerConnections = [];
    window.browser = {
      runtime: {
        onMessage: {
          addListener: (listener) => pickerListeners.push(listener),
        },
        onConnect: {
          addListener: (listener) => pickerConnections.push(listener),
        },
      },
    };
  });
  await page.addScriptTag({ content: pickerBundle.outputFiles[0].text });
}

test("actual picker selection becomes a stored tree and runs through the picker port", async (t) => {
  const page = await pageWith('<p id="value">Funding 80% now</p>');
  t.after(() => page.close());
  await installPicker(page);
  const result = await page.evaluate(async () => {
    const text = document.getElementById("value").firstChild;
    const range = document.createRange();
    range.setStart(text, 8);
    range.setEnd(text, 11);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const response = await pickerListeners[0]({ type: "BURBOT_SELECTION" });
    if (!response.ok) throw new Error(response.error);
    const candidate = response.value;
    const option = candidate.options.find(
      (item) => item.extraction.type === "selection",
    );
    const captured = UnifiedSelectors.createCapturedExtractionInput(
      candidate,
      option,
    );
    const state = BurbotCore.mutate(
      {
        version: 1,
        revision: 0,
        objects: [{ id: "R_42", type: "project", values: { name: "Old" } }],
        rules: [],
      },
      {
        op: "ASSIGN",
        objectId: "R_42",
        field: "name",
        candidate: captured,
        expectedRevision: 0,
      },
      () => crypto.randomUUID(),
      new Date().toISOString(),
    );
    const callbacks = [],
      messages = [];
    pickerConnections[0]({
      name: "burbot-picker",
      onMessage: { addListener: (listener) => callbacks.push(listener) },
      onDisconnect: { addListener() {} },
      postMessage: (message) => messages.push(message),
    });
    callbacks[0]({ id: "run", op: "RUN", rules: state.rules });
    text.data = "Funding 90% now";
    callbacks[0]({ id: "changed", op: "RUN", rules: state.rules });
    return {
      tree: state.rules[0].selectorTree,
      run: messages.find((message) => message.id === "run"),
      changed: messages.find((message) => message.id === "changed"),
      methods: candidate.options.map((item) => item.extraction.type),
    };
  });
  assert.equal(result.tree.versions[0].recipes.length, 1);
  assert.equal(result.tree.versions[0].recipes[0].parts.length, 1);
  assert.ok(
    result.tree.versions[0].recipes[0].parts[0].locators.some(
      (item) => item.kind === "text_quote",
    ),
  );
  assert.equal(result.run.ok, true);
  assert.equal(result.run.value[0].raw, "80%");
  assert.equal(result.run.value[0].evaluation.status, "success");
  assert.equal(result.changed.value[0].evaluation.status, "error");
  assert.deepEqual(result.methods, ["selection"]);
});

test("selecting a whole recruitment element offers dynamic text and retains failed alternatives", async (t) => {
  const original = "Nabór rozpocznie się 01 października 2026";
  const current = "Nabór zakończy się 29 listopada 2026";
  const page = await pageWith(
    '<div class="info-top"><p id="announcement" class="wp-block-paragraph">' +
      original +
      "</p><p>Other information</p></div>",
  );
  t.after(() => page.close());
  await installPicker(page);
  const result = await page.evaluate(async (current) => {
    const u = UnifiedSelectors;
    const target = document.querySelector("div.info-top p.wp-block-paragraph");
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const response = await pickerListeners[0]({ type: "BURBOT_SELECTION" });
    if (!response.ok) throw new Error(response.error);
    const full = response.value.options.find(
      (option) => option.extraction.type === "text",
    );
    const exact = response.value.options.find(
      (option) => option.extraction.type === "selection",
    );
    target.textContent = " \n" + current + "  ";
    let runtime = u.createDOMSelectorRuntime(document);
    const dynamic = u.evaluateSelectorVersion(full.selectorVersion, runtime);
    const failed = u.evaluateSelectorVersion(exact.selectorVersion, runtime);
    target.innerHTML = "Numer: <b>ABC-123</b> Status: otwarty";
    runtime = u.createDOMSelectorRuntime(document);
    const bounded = u.evaluateLocator(
      {
        uuid: crypto.randomUUID(),
        kind: "css_path",
        order: 0,
        selector: "#announcement",
      },
      { type: "text_between", start: "Numer:", end: "Status:" },
      runtime,
    );
    return {
      full,
      dynamic,
      failed,
      bounded,
    };
  }, current);
  assert.equal(result.full.raw, original);
  assert.equal(result.dynamic.status, "success");
  assert.equal(result.dynamic.rawValue, current);
  const locators = result.full.selectorVersion.recipes[0].parts[0].locators;
  const outcomes =
    result.dynamic.recipeResults[0].partResults[0].locatorResults;
  for (const [index, locator] of locators.entries()) {
    if (locator.kind === "text_quote") {
      assert.equal(outcomes[index].status, "not_found");
      assert.equal(outcomes[index].candidate, undefined);
    } else {
      assert.equal(outcomes[index].rawValue, current);
      assert.equal(outcomes[index].matchCount, 1);
    }
  }
  assert.ok(locators.some((locator) => locator.kind === "text_quote"));
  assert.ok(locators.some((locator) => locator.kind === "xpath"));
  assert.equal(result.failed.status, "error");
  const [failed] = result.failed.recipeResults[0].partResults[0].locatorResults;
  assert.equal(failed.extractionError, "selection_quote_mismatch");
  assert.deepEqual(failed.candidate, {
    rawText: " \n" + current + "  ",
    source: "matched_element_text",
    verified: false,
  });
  assert.equal(result.bounded.rawValue, "ABC-123");
});

test("real DOM resolves attribute, cross-node selection, XPath and duplicate quote/id diagnostics", async (t) => {
  const page = await pageWith(
    '<p id="description">Funding <strong>80</strong><span>%</span> today</p><meta name="funding" content="80%"><p id="duplicate">repeat</p><p id="duplicate">repeat</p>',
  );
  t.after(() => page.close());
  const result = await page.evaluate(() => {
    const u = UnifiedSelectors;
    const runtime = u.createDOMSelectorRuntime(document);
    const loc = (kind, payload) => ({
      uuid: crypto.randomUUID(),
      order: 0,
      kind,
      ...payload,
    });
    const selection = {
      type: "selection",
      quote: { exact: "80%", prefix: "Funding ", suffix: " today" },
    };
    return {
      selection: u.evaluateLocator(
        loc("css_path", { selector: "#description" }),
        selection,
        runtime,
      ),
      xpath: u.evaluateLocator(
        loc("xpath", { expression: "//p[@id='description']" }),
        selection,
        runtime,
      ),
      quote: u.evaluateLocator(
        loc("text_quote", { quote: selection.quote }),
        selection,
        runtime,
      ),
      attribute: u.evaluateLocator(
        loc("css_path", { selector: "meta[name=funding]" }),
        { type: "attribute", name: "content" },
        runtime,
      ),
      duplicateId: u.evaluateLocator(
        loc("element_id", { elementId: "duplicate" }),
        { type: "text" },
        runtime,
      ),
      ambiguousQuote: u.evaluateLocator(
        loc("text_quote", { quote: { exact: "repeat" } }),
        { type: "text" },
        runtime,
      ),
      invalidXPath: u.evaluateLocator(
        loc("xpath", { expression: "//*[" }),
        { type: "text" },
        runtime,
      ),
      scalarXPath: u.evaluateLocator(
        loc("xpath", { expression: "string(//p)" }),
        { type: "text" },
        runtime,
      ),
    };
  });
  for (const key of ["selection", "xpath", "quote", "attribute"]) {
    assert.equal(result[key].status, "success", key);
    assert.equal(result[key].rawValue, "80%");
  }
  for (const key of ["duplicateId", "ambiguousQuote"]) {
    assert.equal(result[key].status, "ambiguous", key);
    assert.equal(result[key].matchCount, 2);
  }
  for (const key of ["invalidXPath", "scalarXPath"])
    assert.equal(result[key].status, "error", key);
});

test("HTTP capture generates real UUIDs and retains legacy href and attribute whitespace behavior", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route("http://selector.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<a href="/file.pdf"><span id="link" title="  title text  ">Download</span></a>',
    }),
  );
  await page.goto("http://selector.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const u = UnifiedSelectors,
      element = document.getElementById("link");
    const css = u.buildDurableSelectors(element);
    const v = u.buildCapturedSelectorVersion(
      element,
      css,
      { type: "attribute", attribute: "href" },
      "http://selector.test/file.pdf",
    );
    return {
      uuid: v.uuid,
      result: u.evaluateSelectorVersion(
        v,
        u.createDOMSelectorRuntime(document),
      ),
      title: u
        .createDOMSelectorRuntime(document)
        .read(element, { type: "attribute", name: "title" }),
    };
  });
  assert.match(
    result.uuid,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.equal(result.result.rawValue, "http://selector.test/file.pdf");
  assert.equal(result.title, "  title text  ");
});

test("selection extraction can read changed values bounded by unique context", async (t) => {
  const page = await pageWith('<p id="funding">Funding 85% today</p>');
  t.after(() => page.close());
  const result = await page.evaluate(() => {
    return UnifiedSelectors.evaluateLocator(
      {
        uuid: crypto.randomUUID(),
        kind: "css_path",
        order: 0,
        selector: "#funding",
      },
      {
        type: "selection",
        quote: { exact: "80%", prefix: "Funding ", suffix: " today" },
      },
      UnifiedSelectors.createDOMSelectorRuntime(document),
    );
  });
  assert.equal(result.status, "success");
  assert.equal(result.rawValue, "85%");
});

test("capture anchors the selected occurrence, including XPath literals containing both quote characters", async (t) => {
  const page = await pageWith(
    '<div id="container">First 80% then second 80% end.</div>',
  );
  t.after(() => page.close());
  const result = await page.evaluate(() => {
    const u = UnifiedSelectors,
      element = document.getElementById("container");
    element.id = "a'b\"c";
    const text = element.firstChild;
    const start = text.data.lastIndexOf("80%");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 3);
    const extraction = {
      type: "selection",
      quote: {
        exact: "80%",
        prefix: text.data.slice(0, start),
        suffix: text.data.slice(start + 3),
      },
    };
    const v = u.buildCapturedSelectorVersion(
      element,
      u.buildDurableSelectors(element),
      extraction,
      "80%",
      range,
    );
    return {
      result: u.evaluateSelectorVersion(
        v,
        u.createDOMSelectorRuntime(document),
      ),
      locators: v.recipes[0].parts[0].locators,
    };
  });
  assert.equal(result.result.status, "success");
  assert.ok(
    result.locators.some(
      (locator) =>
        locator.kind === "xpath" && locator.expression.includes("concat("),
    ),
  );
  const quote = result.locators.find(
    (locator) => locator.kind === "text_quote",
  );
  assert.ok(quote.quote.prefix.includes("second"));
});

test("simple editor creates, saves and approves a draft with active history intact", async (t) => {
  const page = await pageWith(
    '<span id="value">80%</span><div id="editor"></div>',
  );
  t.after(() => page.close());
  await page.evaluate(() => {
    const u = UnifiedSelectors;
    const element = document.getElementById("value");
    const extraction = {
      type: "selection",
      quote: { exact: "80%", prefix: "", suffix: "" },
    };
    const version = u.buildCapturedSelectorVersion(
      element,
      u.buildDurableSelectors(element),
      extraction,
      "80%",
    );
    const candidate = u.createCapturedExtractionInput(
      { pageUrl: location.href, selector: "#value", options: [] },
      {
        label: "Exact selected text",
        raw: "80%",
        extraction,
        selectorVersion: version,
      },
    );
    window.state = BurbotCore.mutate(
      {
        version: 1,
        revision: 0,
        objects: [{ id: "R_42", type: "project", values: { name: "Old" } }],
        rules: [],
      },
      {
        op: "ASSIGN",
        objectId: "R_42",
        field: "name",
        candidate,
        expectedRevision: 0,
      },
      () => crypto.randomUUID(),
      new Date().toISOString(),
    );
    window.initialVersion = structuredClone(
      state.rules[0].selectorTree.versions[0],
    );
    const root = document.getElementById("editor");
    const render = () => {
      root.replaceChildren();
      u.renderSelectorTreeEditor(root, state.rules[0], {
        write: async (op, payload) => {
          window.state = u.mutateSelectorState(
            state,
            { ...payload, op, expectedRevision: state.revision },
            new Date().toISOString(),
          );
          render();
        },
        evaluate: async (v) => {
          const source = new DOMParser().parseFromString(
            element.outerHTML,
            "text/html",
          );
          return u.evaluateSelectorVersion(
            v,
            u.createDOMSelectorRuntime(source),
          );
        },
        error: (error) => {
          window.editorError = error.message;
        },
      });
    };
    render();
  });
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Draft version 2 JSON" });
  await input.waitFor();
  const initialDraft = JSON.parse(await input.inputValue());
  await page.getByText("Change extraction method", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Extraction method" })
    .selectOption("text");
  await page.getByRole("button", { name: "Set extraction method" }).click();
  const edited = JSON.parse(await input.inputValue());
  assert.deepEqual(edited.recipes[0].parts[0].extraction, { type: "text" });
  assert.deepEqual(
    edited.recipes[0].parts[0].locators,
    initialDraft.recipes[0].parts[0].locators,
  );
  await page
    .getByRole("button", { name: "Save draft to View", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.stringify(state.rules[0].selectorTree.versions[0]) ===
        JSON.stringify(initialVersion),
    ),
    true,
  );
  await page.locator("#value").evaluate((element) => {
    element.textContent = "90%";
  });
  await page
    .getByRole("button", { name: "Test edited draft", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".selector-diagnostics")
      .textContent.includes('"rawValue": "90%"'),
  );
  await page
    .getByRole("button", { name: "Approve draft", exact: true })
    .click();
  const result = await page.evaluate(() => ({
    statuses: state.rules[0].selectorTree.versions.map(
      (version) => version.status,
    ),
    active: UnifiedSelectors.activeSelectorVersion(state.rules[0].selectorTree)
      .versionNo,
    error: window.editorError,
  }));
  assert.deepEqual(result.statuses, ["superseded", "active"]);
  assert.equal(result.active, 2);
  assert.equal(result.error, undefined);
});

test("highlights resolve new XPath and TextQuote parts alongside legacy selectors", async (t) => {
  const { browser: highlighterBrowser, page } = await openHighlighter(root);
  t.after(() => highlighterBrowser.close());
  await page.setContent(
    '<p id="a">80</p><p id="b">%</p><p id="old">Legacy</p>',
  );
  await page.evaluate(async () => {
    let sequence = 0;
    const uuid = () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
    const part = (kind, payload) => ({
      uuid: uuid(),
      order: 0,
      extraction: { type: "text" },
      locators: [{ uuid: uuid(), order: 0, kind, ...payload }],
    });
    await window.__highlights.show([
      {
        id: "xpath",
        selector: "body",
        part: part("xpath", { expression: "//p[@id='a']" }),
      },
      {
        id: "quote",
        selector: "body",
        part: part("text_quote", { quote: { exact: "%" } }),
      },
      { id: "old", selector: "#old" },
    ]);
  });
  for (const id of ["xpath", "quote", "old"])
    assert.equal(
      await page.locator(`[data-burbot-selector-highlight="${id}"]`).count(),
      1,
      id,
    );
});
