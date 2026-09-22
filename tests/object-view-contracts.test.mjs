import assert from "node:assert/strict";
import test from "node:test";

import {
  addObjectToView,
  createObjectView,
  normalizeObjectView,
  objectInView,
  objectsInView,
  removeObjectFromView,
} from "../src/shared/search/objectView.js";

const objects = [
  { id: "project-1", type: "project" },
  { id: "project-2", type: "project" },
  { id: "operator-1", type: "operator" },
];

test("working view snapshots search result object IDs", () => {
  const view = createObjectView(
    [objects[1], objects[0], objects[1]],
    "type:projekty woj:śląskie",
    "project",
    "2026-09-20T12:00:00.000Z",
  );

  assert.deepEqual(view.objectIds, ["project-2", "project-1"]);
  assert.equal(view.query, "type:projekty woj:śląskie");
  assert.equal(view.type, "project");
});

test("normalization removes deleted objects but keeps the working set order", () => {
  const normalized = normalizeObjectView(
    {
      version: 1,
      objectIds: ["project-2", "missing", "project-1"],
      query: "slask",
      type: "all",
      createdAt: "2026-09-20T12:00:00.000Z",
    },
    objects,
  );

  assert.deepEqual(normalized.objectIds, ["project-2", "project-1"]);
  assert.deepEqual(
    objectsInView(objects, normalized).map((object) => object.id),
    ["project-2", "project-1"],
  );
});

test("view membership limits the active object set", () => {
  const view = createObjectView([objects[0], objects[2]], "", "all");
  assert.equal(objectInView(view, "project-1"), true);
  assert.equal(objectInView(view, "project-2"), false);
  assert.equal(objectInView(null, "project-2"), true);
});

test("an active View can remain empty after manual removal", () => {
  const normalized = normalizeObjectView(
    {
      version: 1,
      objectIds: ["missing"],
      query: "",
      type: "all",
      createdAt: "2026-09-20T12:00:00.000Z",
    },
    objects,
  );
  assert.deepEqual(normalized.objectIds, []);
  assert.deepEqual(objectsInView(objects, normalized), []);
});

test("objects can be added to and removed from View manually", () => {
  let view = createObjectView([objects[0]], "", "all");
  view = addObjectToView(view, "operator-1", objects, "2026-09-20T12:00:00.000Z");
  assert.deepEqual(view.objectIds, ["project-1", "operator-1"]);

  view = removeObjectFromView(view, "project-1", objects);
  assert.deepEqual(view.objectIds, ["operator-1"]);

  view = removeObjectFromView(view, "operator-1", objects);
  assert.deepEqual(view.objectIds, []);
  assert.equal(objectInView(view, "project-2"), false);
});
