import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  installBrowserMock,
  reviewRuntime,
  state,
} from "./helpers/workspace-browser.mjs";

const root = resolve(import.meta.dirname, "..");
const meta = JSON.parse(
  await readFile(resolve(root, ".build/pages-meta.json"), "utf8"),
);

test(
  "built ESM panel loads features on first use and preserves restored/keyboard flows",
  { timeout: 90000 },
  async (t) => {
    const server = createServer(async (req, res) => {
      const path = new URL(req.url, "http://localhost").pathname.slice(1);
      if (!/^(chunks\/)?[\w.-]+$/.test(path)) return res.writeHead(404).end();
      try {
        const data = await readFile(resolve(root, "dist", path));
        res.setHeader(
          "Content-Type",
          path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        res.end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const browser = await chromium.launch({
      executablePath: process.env.BURBOT_CHROMIUM || undefined,
      headless: true,
      args: ["--no-sandbox"],
    });
    t.after(() => browser.close());
    const url = `http://127.0.0.1:${server.address().port}/sidepanel.html`;

    async function open(seed = state, session = {}) {
      const page = await browser.newPage();
      const requests = [];
      const errors = [];
      page.on("request", (request) => {
        if (request.url().endsWith(".js"))
          requests.push(new URL(request.url()).pathname.slice(1));
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript({
        content:
          reviewRuntime.outputFiles[0].text +
          "\nwindow.ReviewTest = ReviewTest;\n(" +
          installBrowserMock.toString() +
          ")(" +
          JSON.stringify(seed) +
          "," +
          JSON.stringify(session) +
          ");",
      });
      await page.goto(url);
      await page.waitForSelector(".view-member-open[aria-current=true]");
      await page.waitForLoadState("networkidle");
      return { page, requests, errors };
    }
    const loaded = (requests, source) =>
      requests.some((path) =>
        Object.keys(meta.outputs["dist/" + path]?.inputs ?? {}).some((input) =>
          input.endsWith(source),
        ),
      );

    await t.test(
      "cold start skips heavy modules; closed sections adopt edits on opening",
      async () => {
        const { page, requests, errors } = await open({
          ...state,
          fileSources: [],
        });
        for (const source of [
          "ImportReviewPanel.tsx",
          "CommitPanel.tsx",
          "fileSourcesUi.ts",
          "geographyUi.ts",
          "geographyRuntime.ts",
          "operatorAssignmentsUi.ts",
          "pdfCaptureUi.ts",
          "selectorHighlightsUi.ts",
        ]) {
          assert.equal(
            loaded(requests, source),
            false,
            source + " must stay cold",
          );
        }
        assert.equal(await page.locator("#funding .field-row").count(), 0);
        const initialBytes = [...new Set(requests)].reduce(
          (sum, path) => sum + (meta.outputs["dist/" + path]?.bytes ?? 0),
          0,
        );
        t.diagnostic(
          `Cold workspace JS: ${initialBytes} bytes across ${new Set(requests).size} files (all imported chunks counted).`,
        );
        const initial = await page.evaluate(() => ({
          gets: window.__uiMessages.filter(
            (m) => m.type === "BURBOT_DATA" && m.op === "GET",
          ).length,
          fullCommits: window.__uiMessages.filter(
            (m) => m.type === "BURBOT_COMMIT" && m.op === "GET",
          ).length,
          injections: window.__uiInjections,
        }));
        assert.equal(initial.gets, 1);
        assert.equal(initial.fullCommits, 0);
        assert.deepEqual(initial.injections, []);

        await page.evaluate((file) => {
          window.__uiState.fileSources = [
            { ...file, display_name: "Dokument dodany po starcie" },
          ];
          browser.runtime.onMessage.emit({
            type: "BURBOT_WORKSPACE_STATE_CHANGED",
            updateId: crypto.randomUUID(),
            state: structuredClone(window.__uiState),
          });
        }, state.fileSources[0]);
        await page.locator("#file-sources-panel > summary").click();
        await page.waitForSelector(
          '#file-sources-panel[data-feature-ready="true"]',
        );
        assert.equal(loaded(requests, "fileSourcesUi.ts"), true);
        assert.match(
          await page.locator("#file-source-list").innerText(),
          /Dokument dodany po starcie/,
        );
        assert.equal(loaded(requests, "pdfCaptureUi.ts"), false);
        await page.locator("#file-sources-panel > summary").click();
        await page.evaluate(() => {
          window.__uiState.fileSources[0].display_name =
            "Zmieniony w zamkniętej sekcji";
          browser.runtime.onMessage.emit({
            type: "BURBOT_WORKSPACE_STATE_CHANGED",
            updateId: crypto.randomUUID(),
            state: structuredClone(window.__uiState),
          });
        });
        await page.locator("#file-sources-panel > summary").click();
        await page
          .getByText("Zmieniony w zamkniętej sekcji", { exact: true })
          .first()
          .waitFor();
        assert.equal(
          requests.filter((path) => /fileSourcesUi-/.test(path)).length,
          1,
        );

        await page.locator("#geography-panel > summary").click();
        await page.waitForSelector(
          '#geography-panel[data-feature-ready="true"]',
        );
        assert.equal(loaded(requests, "geographyRuntime.ts"), true);
        assert.ok((await page.locator("#geography-type option").count()) >= 6);

        await page.keyboard.press("Alt+2");
        await page.waitForSelector(".commit-panel");
        assert.equal(loaded(requests, "CommitPanel.tsx"), true);
        await page.keyboard.press("Alt+3");
        await page
          .getByRole("button", { name: "Wybierz plik JSON", exact: true })
          .waitFor();
        assert.equal(loaded(requests, "ImportReviewPanel.tsx"), true);
        assert.equal(await page.locator(".commit-panel").count(), 0);
        await page.keyboard.press("Alt+1");
        assert.equal(await page.locator(".import-review-shell").count(), 0);
        assert.deepEqual(errors, []);
        await page.close();
      },
    );

    await t.test(
      "restored open section initializes; unrelated features stay unloaded",
      async () => {
        const { page, requests, errors } = await open(state, {
          "burbot:sidepanel-ui:1": {
            workspace: { panels: { "file-sources-panel": true } },
          },
        });
        await page.waitForSelector(
          '#file-sources-panel[data-feature-ready="true"]',
        );
        assert.equal(
          await page.locator("#file-sources-panel").getAttribute("open"),
          "",
        );
        assert.equal(await page.locator(".file-source-row").count(), 1);
        assert.equal(loaded(requests, "geographyUi.ts"), false);
        assert.equal(loaded(requests, "pdfCaptureUi.ts"), false);
        assert.deepEqual(errors, []);
        await page.close();
      },
    );

    await t.test(
      "first file shortcut is handled once, including a shortcut queued before startup",
      async () => {
        const stamp = "first-shortcut";
        const { page, requests, errors } = await open(state, {
          "burbot:file-mode-toggle:1": { stamp, createdAt: Date.now() },
        });
        await page.waitForSelector('#read-from-file[data-active="true"]');
        assert.equal(loaded(requests, "fileSourcesUi.ts"), true);
        await page.evaluate((stamp) => {
          for (let i = 0; i < 3; i++)
            browser.runtime.onMessage.emit({
              type: "BURBOT_TOGGLE_FILE_MODE",
              windowId: 1,
              stamp,
            });
        }, stamp);
        assert.equal(
          await page.locator("#read-from-file").getAttribute("data-active"),
          "true",
        );
        assert.equal(
          await page.evaluate(
            () =>
              window.__uiInjections.filter((item) =>
                item.files.includes("picker.js"),
              ).length,
          ),
          1,
        );
        await page.evaluate(async () => {
          await browser.storage.session.set({
            "burbot:file-mode-toggle:1": {
              stamp: "second-shortcut",
              createdAt: Date.now(),
            },
          });
          browser.runtime.onMessage.emit({
            type: "BURBOT_TOGGLE_FILE_MODE",
            windowId: 1,
            stamp: "second-shortcut",
          });
        });
        await page.waitForSelector('#read-from-file[data-active="false"]');
        assert.deepEqual(errors, []);
        await page.close();
      },
    );

    await t.test(
      "first PDF capture loads its handler and delivers the original selection",
      async () => {
        const { page, requests, errors } = await open();
        assert.equal(loaded(requests, "pdfCaptureUi.ts"), false);
        await page
          .locator('#fields .field-row[data-field="external_number"]')
          .click();
        await page.evaluate(() =>
          browser.runtime.onMessage.emit({
            type: "BURBOT_PDF_CAPTURE",
            windowId: 1,
            objectId: "call",
            candidate: {
              pageUrl: "https://example.org/regulamin.pdf",
              selector: null,
              options: [
                {
                  raw: "Nabór z pierwszego zaznaczenia PDF",
                  extraction: {
                    type: "pdfText",
                    sourceId: "rules",
                    selector: { pageNumber: 1 },
                  },
                },
              ],
            },
          }),
        );
        await page
          .getByRole("button", { name: "Save PDF rule", exact: true })
          .waitFor();
        assert.match(
          await page.locator("#sample").textContent(),
          /pierwszego zaznaczenia PDF/,
        );
        assert.equal(loaded(requests, "pdfCaptureUi.ts"), true);
        assert.deepEqual(errors, []);
        await page.close();
      },
    );
  },
);
