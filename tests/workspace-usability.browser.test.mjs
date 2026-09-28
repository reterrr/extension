// Real built UI with a deterministic WebExtension transport; no external writes.
// Run after `npm run build`: npm run test:ui
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const sourceUrl = "https://example.org/nabor";
const state = {
  version: 1,
  revision: 1,
  rules: [],
  geographies: [],
  operatorAssignments: [],
  operatorContacts: [],
  documentRequirements: [],
  fieldEvidence: [],
  objects: [
    {
      id: "call",
      type: "recruitment",
      sourceUrl,
      values: {
        external_number:
          "Nabór 3/2026 — rozwój kompetencji przedsiębiorców i ich pracowników",
        project_id: "project",
        status: "AKTYWNY",
        year: 2026,
        start_date: "2026-09-01",
        end_date: "2026-10-30",
      },
    },
    {
      id: "project",
      type: "project",
      sourceUrl,
      values: {
        name: "Małopolski program rozwoju kompetencji",
        type: "B2B",
        status: "AKTYWNY",
      },
    },
  ],
  financingRules: [
    {
      id: "funding-1",
      objectId: "call",
      company_size: "MICRO",
      variant_no: 1,
      refund_percent_max: 80,
    },
  ],
  fileSources: [
    {
      id: "rules",
      objectId: "call",
      name: "Regulamin_naboru_3_2026.pdf",
      fileType: "PDF",
      url: "https://example.org/regulamin.pdf",
      sourcePageUrl: sourceUrl,
      purpose: "Regulamin",
      client_requirement: "Informacyjny",
      has_fields: false,
      display_name: "Regulamin naboru",
      intended_use: "Warunki udziału, dokumenty i terminy.",
    },
  ],
};

function installBrowserMock(seed) {
  const copy = (value) => structuredClone(value);
  const event = () => {
    const listeners = new Set();
    return {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      emit: (...args) => [...listeners].forEach((fn) => fn(...args)),
    };
  };
  const onChanged = event();
  const onMessage = event();
  const storage = (area, initial = {}) => {
    const values = copy(initial);
    return {
      get: async (keys) =>
        Object.fromEntries(
          (keys == null
            ? Object.keys(values)
            : Array.isArray(keys)
              ? keys
              : [keys]
          ).map((key) => [key, copy(values[key])]),
        ),
      set: async (next) => {
        const changes = {};
        for (const [key, value] of Object.entries(next)) {
          if (JSON.stringify(values[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: copy(values[key]), newValue: copy(value) };
          values[key] = copy(value);
        }
        if (Object.keys(changes).length) onChanged.emit(changes, area);
      },
      remove: async (key) => {
        const oldValue = values[key];
        delete values[key];
        onChanged.emit({ [key]: { oldValue } }, area);
      },
    };
  };
  window.__uiState = copy(seed);
  window.__uiMessages = [];
  const commit = { active: false, dirty: false, objects: [] };
  window.browser = {
    storage: {
      onChanged,
      local: storage("local"),
      session: storage("session", {
        "burbot:workflow-mode": "view",
        "burbot:object-view": {
          version: 1,
          objectIds: ["call", "project"],
          query: "",
          type: "all",
          createdAt: "2026-09-28",
        },
      }),
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    runtime: {
      onMessage,
      getURL: (path) => location.origin + "/" + path,
      sendMessage: async (message) => {
        window.__uiMessages.push(copy(message));
        if (message.type === "BURBOT_COMMIT") {
          if (message.op === "FOCUS")
            onMessage.emit({
              ...message,
              type: "BURBOT_FOCUS",
              stamp: crypto.randomUUID(),
            });
          return { ok: true, value: copy(commit) };
        }
        if (message.type === "BURBOT_DATA") {
          if (message.op === "GET_FOCUS") return { ok: true, value: null };
          if (message.op !== "GET")
            window.__uiState = window.BurbotCore.mutate(
              window.__uiState,
              message,
              () => crypto.randomUUID(),
              new Date().toISOString(),
            );
          return { ok: true, value: copy(window.__uiState) };
        }
        return { ok: true, value: null };
      },
    },
    tabs: {
      query: async () => [
        { id: 1, windowId: 1, url: "https://example.org/nabor" },
      ],
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
      sendMessage: async () => ({ ok: true }),
      connect: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          disconnect() {},
          postMessage(message) {
            queueMicrotask(() =>
              port.onMessage.emit({
                id: message.id,
                ok: true,
                value:
                  message.op === "URL" ? "https://example.org/nabor" : true,
              }),
            );
          },
        };
        return port;
      },
    },
    scripting: { executeScript: async () => [] },
  };
}

test(
  "workspace navigation, editing, keyboard access and responsive layout",
  { timeout: 60000 },
  async (t) => {
    const server = createServer(async (req, res) => {
      try {
        const name =
          new URL(req.url, "http://localhost").pathname.slice(1) ||
          "sidepanel.html";
        if (!/^[\w.-]+$/.test(name)) {
          res.writeHead(404).end();
          return;
        }
        const bytes = await readFile(resolve(root, "dist", name));
        res.setHeader(
          "Content-Type",
          name.endsWith(".js")
            ? "text/javascript"
            : name.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        res.end(bytes);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.BURBOT_CHROMIUM
        ? { executablePath: process.env.BURBOT_CHROMIUM }
        : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installBrowserMock, state);
    await page.goto(`http://127.0.0.1:${server.address().port}/sidepanel.html`);
    await page
      .waitForSelector(".view-member-open[aria-current=true]", {
        timeout: 10000,
      })
      .catch(async (error) => {
        throw new Error(
          `${error.message}\nPage errors: ${JSON.stringify(errors)}\nUI: ${(await page.locator("body").innerText()).slice(0, 3000)}`,
        );
      });
    assert.match(await page.locator("#object-title").textContent(), /Nabór 3/);
    assert.equal(await page.locator("html").getAttribute("lang"), "pl");
    assert.equal(
      await page.locator(".workflow-tabs button[aria-pressed=true]").count(),
      1,
    );
    await page.waitForFunction(
      () => document.querySelector("#connection").dataset.connected === "true",
    );
    await page.locator(".view-manager-collapse").click();
    assert.equal(await page.locator("#view-manager-body").isVisible(), false);
    await page.locator(".view-manager-collapse").click();
    await page.locator("#section-select").selectOption("funding-panel");
    await page.locator("#section-go").click();
    assert.equal(await page.locator("#funding-panel").getAttribute("open"), "");
    const tabs = page.locator(".funding-tab");
    await tabs.first().focus();
    await page.keyboard.press("End");
    assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
    assert.equal(await tabs.last().getAttribute("tabindex"), "0");
    await page.keyboard.press("Home");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    const numeric = page
      .locator('#funding .field-row[data-field="refund_percent_max"]')
      .first();
    await numeric.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.activeElement?.id === "edit-value",
    );
    assert.equal(
      await page.locator(".field-evidence-editor").getAttribute("open"),
      null,
    );
    await page.locator("#edit-value").fill("tekst z regulaminu");
    assert.equal(
      await page.locator("#edit-value").getAttribute("aria-invalid"),
      "true",
    );
    assert.match(
      await page.locator("#converted").textContent(),
      /Wpisz procent/,
    );
    assert.equal(await page.locator("#save").isDisabled(), true);
    await page.locator("#edit-value").fill("80,5");
    assert.equal(await page.locator("#save").isDisabled(), false);
    await page.locator("#save").click();
    await page.waitForFunction(
      () => window.__uiState.financingRules[0].refund_percent_max === 80.5,
    );
    await page.waitForFunction(
      () => document.activeElement?.id === "edit-value",
    );
    assert.equal(
      await page.evaluate(() =>
        window.__uiMessages.some((m) => m.op === "EDIT"),
      ),
      true,
    );
    await page.locator("#capture-collapse").click();
    assert.equal(
      await page.locator("#capture-collapse").getAttribute("aria-label"),
      "Rozwiń edytor pola",
    );
    assert.equal(await page.locator("#edit-value").isVisible(), false);
    await page.locator("#capture-collapse").click();

    // Reflow at narrow sidebar widths and at the recording's desktop width.
    for (const width of [320, 400, 768, 1192, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const capture = document
          .querySelector("#capture-area")
          .getBoundingClientRect();
        const main = document
          .querySelector("#workspace-main")
          .getBoundingClientRect();
        const save = document.querySelector("#save").getBoundingClientRect();
        return {
          saveVisible:
            save.top >= capture.top && save.bottom <= capture.bottom + 1,
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          editorWidth: capture.width,
          overlaps: capture.left < main.right && capture.right > main.left,
          valueFont: parseFloat(
            getComputedStyle(document.querySelector(".field-value")).fontSize,
          ),
        };
      });
      assert.ok(
        geometry.pageWidth <= geometry.viewport + 1,
        `horizontal overflow at ${width}: ${JSON.stringify(geometry)}`,
      );
      assert.ok(geometry.saveVisible, `save button obscured at ${width}`);
      assert.ok(geometry.editorWidth >= 250, `editor too narrow at ${width}`);
      assert.ok(geometry.valueFont >= 14);
      if (width >= 1100)
        assert.equal(
          geometry.overlaps,
          false,
          "desktop editor must not cover data",
        );
      if (process.env.BURBOT_UI_SCREENSHOTS) {
        await mkdir(process.env.BURBOT_UI_SCREENSHOTS, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: resolve(
            process.env.BURBOT_UI_SCREENSHOTS,
            `workspace-${width}.png`,
          ),
        });
      }
    }
    await page.locator("#deselect").click();
    await page.locator("#section-select").selectOption("file-sources-panel");
    await page.locator("#section-go").click();
    await page.locator(".file-source-summary").first().click();
    for (const width of [320, 400]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `file form overflow at ${width}`,
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".view-member-open").last().click();
    await page.waitForFunction(
      () =>
        document.querySelector("#workspace").dataset.activeObjectId ===
        "project",
    );
    assert.match(
      await page.locator(".view-member-open[aria-current=true]").textContent(),
      /Małopolski/,
    );
    await page.locator(".workflow-tabs button").nth(1).click();
    assert.equal(await page.locator("#workspace-main").isVisible(), false);
    await page.locator(".workflow-tabs button").nth(2).click();
    assert.equal(await page.locator(".view-manager").isVisible(), false);
    await page.locator(".workflow-tabs button").first().click();
    assert.equal(await page.locator("#workspace-main").isVisible(), true);
    assert.deepEqual(errors, []);
  },
);
