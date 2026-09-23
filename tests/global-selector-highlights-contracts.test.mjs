import assert from "node:assert/strict";
import test from "node:test";

import {
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
