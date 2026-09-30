// Real built UI with a deterministic WebExtension transport; no external writes.
// Run after `npm run build`: npm run test:ui
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const reviewRuntime = await build({
  stdin: {
    contents:
      'export * from "./src/shared/commits/review.ts"; export * from "./src/shared/commits/session.ts";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ReviewTest",
  platform: "browser",
  logLevel: "silent",
});
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
      id: "operator",
      type: "operator",
      values: { name: "Rzeszowska Agencja Rozwoju", nip: "8130010538" },
    },
    {
      id: "operator-b",
      type: "operator",
      values: {
        name: "Regionalny Fundusz Rozwoju Kompetencji i Przedsiębiorczości",
      },
    },
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
  window.__uiCommitted = copy(seed);
  window.__uiDraft = null;
  const runtime = window.ReviewTest;
  const ensureDraft = () =>
    (window.__uiDraft ??= {
      id: "ui-draft",
      createdAt: "2026-09-30",
      updatedAt: "2026-09-30",
      baseRevision: window.__uiCommitted.revision,
      baseState: copy(window.__uiCommitted),
      workingState: copy(window.__uiState),
      stagedObjectIds: [],
      reviewVersion: 1,
    });
  const publish = () => {
    window.__uiState = copy(
      window.__uiDraft?.workingState ?? window.__uiCommitted,
    );
    onChanged.emit(
      { "burbot:v1": { newValue: copy(window.__uiState) } },
      "local",
    );
    onMessage.emit({ type: "BURBOT_COMMIT_CHANGED" });
    window.dispatchEvent(new Event("burbot:commit-changed"));
  };
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
          if (message.op === "NEW") ensureDraft();
          if (message.op === "REVIEW_CHANGE") {
            await new Promise((resolve) => setTimeout(resolve, 10));
            runtime.decideReviewChange(
              ensureDraft(),
              message.changeId,
              message.decision,
              message.fingerprint,
            );
            publish();
          }
          if (message.op === "REVIEW_ALL") {
            const d = ensureDraft();
            for (const item of runtime.reviewItems(d))
              if (
                item.selection !== "discarded" &&
                (!message.objectId || item.objectId === message.objectId)
              )
                runtime.decideReviewChange(
                  d,
                  item.id,
                  message.decision,
                  item.fingerprint,
                );
            publish();
          }
          if (message.op === "COMMIT") {
            const d = ensureDraft();
            runtime.validateReviewSelection(d, message.expectedReview);
            const saved = runtime.applyReviewedChanges(d);
            saved.revision += 1;
            window.__uiCommitted = copy(saved);
            runtime.rebaseReviewedChanges(d, saved);
            publish();
            return {
              ok: true,
              value: { session: runtime.commitSessionView(d) },
            };
          }
          return {
            ok: true,
            value: runtime.commitSessionView(window.__uiDraft),
          };
        }
        if (message.type === "BURBOT_DATA") {
          if (message.op === "GET_FOCUS") return { ok: true, value: null };
          if (message.op !== "GET") {
            const d = ensureDraft();
            window.__uiState = window.BurbotCore.mutate(
              window.__uiState,
              message,
              () => crypto.randomUUID(),
              new Date().toISOString(),
            );
            window.__uiState.revision = d.baseRevision;
            d.workingState = copy(window.__uiState);
            runtime.refreshReviewDecisions(d);
            publish();
          }
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
    await page.addInitScript({
      content:
        reviewRuntime.outputFiles[0].text +
        "\nglobalThis.ReviewTest = ReviewTest;\n(" +
        installBrowserMock.toString() +
        ")(" +
        JSON.stringify(state) +
        ");",
    });
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
    await page.locator("#funding-panel > summary").click();
    assert.equal(await page.locator("#section-select").count(), 0);
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
    await page
      .waitForFunction(
        () => document.activeElement?.id === "edit-value",
        null,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        throw new Error(
          error.message +
            " " +
            JSON.stringify(
              await page.evaluate(() => ({
                focus:
                  document.activeElement?.tagName +
                  ":" +
                  document.activeElement?.id,
                label: document.querySelector("#active-label")?.textContent,
                notice: document.querySelector("#notice")?.textContent,
                messages: window.__uiMessages.slice(-5),
              })),
            ),
        );
      });
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
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction(
      () => window.__uiState.financingRules[0].refund_percent_max === 80.5,
    );
    await page
      .waitForFunction(
        () => document.activeElement?.id === "edit-value",
        null,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        throw new Error(
          error.message +
            " " +
            JSON.stringify(
              await page.evaluate(() => ({
                focus:
                  document.activeElement?.tagName +
                  ":" +
                  document.activeElement?.id,
                label: document.querySelector("#active-label")?.textContent,
                notice: document.querySelector("#notice")?.textContent,
                messages: window.__uiMessages.slice(-5),
              })),
            ),
        );
      });
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
    await page.locator("#file-sources-panel > summary").click();
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
    assert.equal(await page.locator(".view-member-stage").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Połącz ponownie" }).count(),
      0,
    );
    await page.keyboard.press("Control+k");
    await page.locator(".view-search-dialog[open]").waitFor();
    const picker = await page.locator(".view-search-dialog").boundingBox();
    assert.ok(
      picker.width > 900 && picker.height > 700,
      JSON.stringify(picker),
    );
    await page
      .getByRole("searchbox", { name: "Szukaj obiektu", exact: true })
      .fill("8130010538");
    assert.equal(await page.locator(".view-search-open").count(), 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector("#workspace").dataset.activeObjectId ===
        "operator",
    );
    assert.equal(await page.locator(".view-search-dialog").isVisible(), false);
    await page
      .locator(".view-member-open")
      .filter({ hasText: "Małopolski" })
      .click();
    await page.locator("#operator-assignments-panel > summary").click();
    await page.locator("#operator-assignment-search").fill("8130010538");
    await page.locator("#operator-assignment-search").press("Enter");
    await page.waitForFunction(
      () => window.__uiState.operatorAssignments.length === 1,
    );
    assert.match(
      await page.locator("#operator-assignment-list").innerText(),
      /Rzeszowska Agencja/,
    );
    assert.equal(await page.locator("#operator-assignment-select").count(), 0);
    await page.evaluate(async () => {
      await browser.runtime.sendMessage({
        type: "BURBOT_DATA",
        op: "EDIT",
        expectedRevision: window.__uiState.revision,
        objectId: "call",
        field: "notes",
        value: "Propozycja do dopracowania",
      });
      await browser.runtime.sendMessage({
        type: "BURBOT_DATA",
        op: "EDIT",
        expectedRevision: window.__uiState.revision,
        objectId: "call",
        field: "status",
        value: "ZAWIESZONY",
      });
    });
    await page.keyboard.press("Alt+2");
    await page
      .locator(".review-objects button")
      .filter({ hasText: "Nabór 3/2026" })
      .click();
    await page
      .getByRole("checkbox", { name: "Zapisz: Uwagi", exact: true })
      .focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() =>
      window.ReviewTest.reviewItems(window.__uiDraft).some(
        (item) => item.label === "notes" && item.selection === "later",
      ),
    );
    const statusRow = page.locator(".review-row").filter({
      has: page.getByRole("checkbox", {
        name: "Zapisz: Status",
        exact: true,
      }),
    });
    await statusRow.getByRole("button", { name: "Cofnij zmianę" }).click();
    await page.waitForFunction(
      () =>
        window.__uiState.objects.find((o) => o.id === "call").values.status ===
        "AKTYWNY",
    );
    assert.match(await statusRow.innerText(), /Cofnięta — bez zmiany/);
    assert.match(
      await page
        .locator(".review-after")
        .allTextContents()
        .then((v) => v.join(" ")),
      /80.5/,
    );
    if (process.env.BURBOT_UI_SCREENSHOTS) {
      await page.screenshot({
        path: resolve(process.env.BURBOT_UI_SCREENSHOTS, "review-desktop.png"),
      });
    }
    await page.getByRole("button", { name: /^Zapisz wybrane/ }).click();
    await page.waitForFunction(
      () => window.__uiCommitted.financingRules[0].refund_percent_max === 80.5,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__uiCommitted.objects.find((o) => o.id === "call").values
            .notes,
      ),
      undefined,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__uiState.objects.find((o) => o.id === "call").values.notes,
      ),
      "Propozycja do dopracowania",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__uiCommitted.objects.find((o) => o.id === "call").values
            .status,
      ),
      "AKTYWNY",
    );
    await statusRow
      .getByRole("button", { name: "Przywróć propozycję" })
      .click();
    await page.waitForFunction(
      () =>
        window.__uiState.objects.find((o) => o.id === "call").values.status ===
        "ZAWIESZONY",
    );
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "review overflow " + width,
      );
      const footer = await page.locator(".review-footer").boundingBox();
      assert.ok(
        footer.y + footer.height <= 901,
        "review footer should stay visible",
      );
      if (process.env.BURBOT_UI_SCREENSHOTS)
        await page.screenshot({
          path: resolve(
            process.env.BURBOT_UI_SCREENSHOTS,
            `review-${width}.png`,
          ),
        });
    }
    await page.keyboard.press("Control+k");
    await page.locator(".view-search-dialog[open]").waitFor();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "picker overflow " + width,
      );
      if (process.env.BURBOT_UI_SCREENSHOTS)
        await page.screenshot({
          path: resolve(
            process.env.BURBOT_UI_SCREENSHOTS,
            `search-${width}.png`,
          ),
        });
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".view-search-dialog").isVisible(), false);

    // A real domain operation promotes B and demotes the existing main A.
    // Review, undo, restore and commit must treat both rows as one decision.
    await page.evaluate(async () => {
      await browser.runtime.sendMessage({
        type: "BURBOT_DATA",
        op: "ADD_OPERATOR_ASSIGNMENT",
        objectId: "project",
        operatorId: "operator-b",
        operatorType: "GLOWNY",
        expectedRevision: window.__uiState.revision,
      });
    });
    await page.keyboard.press("Alt+2");
    await page
      .locator(".review-objects button")
      .filter({ hasText: "Małopolski" })
      .click();
    const swap = page.locator(".review-row").filter({
      has: page.getByRole("checkbox", {
        name: "Zapisz: Zmiana operatora głównego",
        exact: true,
      }),
    });
    await swap.waitFor();
    assert.equal(await swap.getByRole("checkbox").count(), 1);
    assert.match(await swap.innerText(), /Rzeszowska Agencja Rozwoju/);
    assert.match(await swap.innerText(), /Regionalny Fundusz/);
    await swap.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() =>
      window.ReviewTest.reviewItems(window.__uiDraft).some(
        (item) =>
          item.label === "Zmiana operatora głównego" &&
          item.selection === "later",
      ),
    );
    assert.equal(await swap.getByRole("checkbox").isChecked(), false);
    assert.deepEqual(
      await page.evaluate(() =>
        window.ReviewTest.applyReviewedChanges(window.__uiDraft)
          .operatorAssignments.filter((row) => row.objectId === "project")
          .map((row) => [row.operatorId, row.operatorType]),
      ),
      [["operator", "GLOWNY"]],
    );
    await swap.getByRole("button", { name: "Cofnij zmianę" }).click();
    await page.waitForFunction(
      () =>
        window.__uiState.operatorAssignments.filter(
          (row) => row.objectId === "project",
        ).length === 1,
    );
    assert.equal(await swap.getByRole("checkbox").isDisabled(), true);
    await swap.getByRole("button", { name: "Przywróć propozycję" }).click();
    await page.waitForFunction(
      () =>
        window.__uiState.operatorAssignments.filter(
          (row) => row.objectId === "project",
        ).length === 2,
    );
    assert.equal(await swap.getByRole("checkbox").isChecked(), false);
    // The controlled checkbox updates after the background IPC response.
    await swap.getByRole("checkbox").click();
    await page.waitForFunction(() =>
      window.ReviewTest.reviewItems(window.__uiDraft).some(
        (item) =>
          item.label === "Zmiana operatora głównego" &&
          item.selection === "save",
      ),
    );
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `operator group overflow at ${width}`,
      );
      if (process.env.BURBOT_UI_SCREENSHOTS)
        await page.screenshot({
          path: resolve(
            process.env.BURBOT_UI_SCREENSHOTS,
            `operator-swap-${width}.png`,
          ),
        });
    }
    await page.getByRole("button", { name: /^Zapisz wybrane/ }).click();
    await page.waitForFunction(() =>
      window.__uiCommitted.operatorAssignments.some(
        (row) => row.operatorId === "operator-b",
      ),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.__uiCommitted.operatorAssignments
          .filter((row) => row.objectId === "project")
          .map((row) => [row.operatorId, row.operatorType])
          .sort(),
      ),
      [
        ["operator", "DODATKOWY"],
        ["operator-b", "GLOWNY"],
      ],
    );
    assert.equal(await page.locator(".commit-error").count(), 0);
    assert.deepEqual(errors, []);
  },
);
