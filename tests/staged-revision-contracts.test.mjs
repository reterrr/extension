import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Contract for draft mutations: while a commit is active, the background owns
 * the working revision. UI modules may briefly hold stale revisions because the
 * sidepanel is composed from several independent views.
 */
function normalizeDraftMutation(message, workingRevision) {
  return { ...message, expectedRevision: workingRevision };
}

test("draft mutation uses the authoritative working revision", () => {
  const staleUiMessage = {
    op: "ADD_GEOGRAPHY",
    expectedRevision: 4,
    objectId: "project-1",
    geographyType: "POWIAT",
    geographyRole: "OBEJMUJE",
    value: "podkarpackie|powiat|rzeszowski",
  };

  const normalized = normalizeDraftMutation(staleUiMessage, 9);
  assert.equal(normalized.expectedRevision, 9);
  assert.equal(normalized.objectId, "project-1");
  assert.equal(normalized.op, "ADD_GEOGRAPHY");
});
