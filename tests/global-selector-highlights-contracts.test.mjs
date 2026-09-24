import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY,
  buildImportedEvidenceAnchorRequests,
  buildStoredSelectorHighlights,
  sameSelectorPage,
} from "../src/shared/selectorHighlights.js";

test("selector highlighting projects rules from every object on the same page", () => {
  const page = "https://example.test/project/one/";
  const state = {
    objects: [
      { id: "project-1", type: "project" },
      { id: "operator-1", type: "operator" },
    ],
    rules: [
      {
        id: "rule-project",
        objectId: "project-1",
        field: "name",
        pageUrl: "https://example.test/project/one",
        selector: "#project-name",
        extraction: { type: "text" },
      },
      {
        id: "rule-operator",
        objectId: "operator-1",
        field: "name",
        pageUrl: "https://example.test/project/one#details",
        selector: ".operator-name",
        selectorFallbacks: ["[data-operator-name]"],
        extraction: { type: "text" },
      },
      {
        id: "rule-other-page",
        objectId: "project-1",
        field: "status",
        pageUrl: "https://example.test/project/two",
        selector: ".status",
        extraction: { type: "text" },
      },
      {
        id: "rule-pdf",
        objectId: "project-1",
        field: "amount",
        pageUrl: "https://example.test/project/one",
        selector: ".pdf-only",
        extraction: { type: "pdfText", sourceId: "pdf-1" },
      },
    ],
    fieldEvidence: [
      {
        id: "evidence-1",
        objectId: "operator-1",
        field: "nip",
        pageUrl: "https://example.test/project/one",
        selector: ".operator-nip",
        selectorFallbacks: [],
        extraction: { type: "selection", quote: {
          exact: "1234567890",
          prefix: "NIP ",
          suffix: "",
        } },
      },
    ],
  };

  const highlights = buildStoredSelectorHighlights(state, page);

  assert.deepEqual(
    highlights.map((item) => item.selector),
    ["#project-name", ".operator-name", ".operator-nip"],
  );
  assert.deepEqual(highlights[1].selectorFallbacks, ["[data-operator-name]"]);
  assert.equal(highlights[2].quote.exact, "1234567890");
});

test("identical visual targets are rendered only once", () => {
  const state = {
    rules: [
      {
        id: "a",
        objectId: "one",
        pageUrl: "https://example.test/a",
        selector: ".same",
        extraction: { type: "text" },
      },
      {
        id: "b",
        objectId: "two",
        pageUrl: "https://example.test/a",
        selector: ".same",
        extraction: { type: "text" },
      },
    ],
    fieldEvidence: [],
  };

  assert.equal(
    buildStoredSelectorHighlights(state, "https://example.test/a").length,
    1,
  );
});

test("page comparison ignores hash and trailing slash", () => {
  assert.equal(
    sameSelectorPage(
      "https://example.test/path/#section",
      "https://example.test/path",
    ),
    true,
  );
});


test("approved portable-import evidence is highlighted even without a DOM selector", () => {
  const sourceText =
    "Projekt Generator Kompetencji 3.0. Harmonogram: Nabór 3/2026 dla przedsiębiorców.";
  const exact = "Nabór 3/2026";
  const start = sourceText.indexOf(exact);

  const state = {
    objects: [
      {
        id: "recruitment-1",
        type: "recruitment",
        evidence: {
          external_number: [
            {
              sourceId: "source-1",
              charStart: start,
              charEnd: start + exact.length,
              rawValue: exact,
            },
          ],
        },
      },
    ],
    rules: [],
    fieldEvidence: [],
    importSources: [
      {
        id: "source-1",
        importKey: "page",
        type: "HTML",
        url: "https://example.test/project",
        snapshot: { text: sourceText },
        importedAt: "2026-09-23T18:00:00.000Z",
      },
    ],
  };

  const highlights = buildStoredSelectorHighlights(
    state,
    "https://example.test/project#details",
  );

  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].selector, "body");
  assert.equal(highlights[0].quote.exact, exact);
  assert.match(highlights[0].id, /^import-evidence:/);
});

test("portable-import PDF evidence is not projected onto a webpage", () => {
  const state = {
    objects: [
      {
        id: "project-1",
        type: "project",
        evidence: {
          name: [
            {
              sourceId: "pdf-1",
              charStart: 0,
              charEnd: 7,
              rawValue: "Projekt",
            },
          ],
        },
      },
    ],
    rules: [],
    fieldEvidence: [],
    importSources: [
      {
        id: "pdf-1",
        importKey: "pdf",
        type: "PDF",
        url: "https://example.test/regulamin.pdf",
        snapshot: { text: "Projekt" },
        importedAt: "2026-09-23T18:00:00.000Z",
      },
    ],
  };

  assert.equal(
    buildStoredSelectorHighlights(state, "https://example.test/regulamin.pdf").length,
    0,
  );
});


test("import evidence uses a cached durable selector after one DOM materialization", () => {
  const sourceText = "Projekt Demo. Nabór 4/2026 dla przedsiębiorców.";
  const exact = "Nabór 4/2026";
  const start = sourceText.indexOf(exact);
  const state = {
    objects: [
      {
        id: "recruitment-4",
        type: "recruitment",
        evidence: {
          external_number: [
            {
              sourceId: "source-html",
              charStart: start,
              charEnd: start + exact.length,
              rawValue: exact,
            },
          ],
        },
      },
    ],
    rules: [],
    fieldEvidence: [],
    importSources: [
      {
        id: "source-html",
        type: "HTML",
        url: "https://example.test/project",
        snapshot: { text: sourceText },
      },
    ],
  };

  const requests = buildImportedEvidenceAnchorRequests(
    state,
    "https://example.test/project",
    {},
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].quote.exact, exact);

  const locator = {
    pageUrl: "https://example.test/project",
    selector: "#recruitment-number",
    selectorFallbacks: ["main .recruitment-number"],
    quote: {
      exact,
      prefix: "",
      suffix: "",
    },
    resolvedAt: "2026-09-24T08:00:00.000Z",
  };
  const cache = { [requests[0].key]: locator };
  const highlights = buildStoredSelectorHighlights(
    state,
    "https://example.test/project",
    cache,
  );

  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].selector, "#recruitment-number");
  assert.deepEqual(
    highlights[0].selectorFallbacks,
    ["main .recruitment-number"],
  );
  assert.equal(highlights[0].quote.exact, exact);
});

test("import evidence locator cache has a dedicated technical storage key", () => {
  assert.equal(
    IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY,
    "burbot:import-evidence-locators:v1",
  );
});


test("background materializes imported evidence through the dedicated locator runtime", () => {
  const root = resolve(import.meta.dirname, "..");
  const background = readFileSync(
    resolve(root, "src/background/index.ts"),
    "utf8",
  );
  const buildScript = readFileSync(
    resolve(root, "scripts/build.mjs"),
    "utf8",
  );
  const locatorRuntime = readFileSync(
    resolve(root, "src/content/evidence-locator.ts"),
    "utf8",
  );

  assert.match(
    background,
    /buildImportedEvidenceAnchorRequests\([\s\S]*?evidence-locator\.js/,
  );
  assert.match(
    background,
    /IMPORT_EVIDENCE_LOCATOR_STORAGE_KEY/,
  );
  assert.match(
    buildScript,
    /"evidence-locator": "src\/content\/evidence-locator\.ts"/,
  );
  assert.match(
    locatorRuntime,
    /buildDurableSelectors\(container\)/,
  );
  assert.match(
    locatorRuntime,
    /The expensive page text index is built once for the whole batch/,
  );
});
