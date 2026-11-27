# Unified selectors

Web rules now own a UUID-based `SelectorTree`: a logical selector, its version history, independent recipes, ordered parts, and alternative locators for each part. `src/shared/types/selectors.ts` defines the portable contract. The compatibility `selector`/`extraction` fields remain available for older consumers; execution and highlighting use the active tree when present. Page URL and PDF rules retain their existing runtimes.

## Capture and evaluation

The picker retains the durable CSS generator. It verifies every CSS fallback, XPath, element ID, and applicable TextQuote against the captured DOM and extracted value. A simple capture produces one recipe with one part. The assignment action creates the first active version. Capturing the same field again on the same page retains the logical selector and creates a draft with new entity UUIDs.

Each locator reports its status, match count, raw value and diagnostic. A missing or ambiguous locator may be recovered by another unique alternative; its failure remains in the diagnostics. All successful alternatives must agree about the part's value. Parts are assembled by `order`, inserting each subsequent part's `joinWith` before its value (default `""`). Every recipe must independently produce all its parts. Different complete recipe values produce `conflict`; a failed recipe cannot be hidden by a successful one.

Consensus normalization is a separate function and defaults to exact string equality. Existing DOM extraction semantics remain: text uses whitespace-collapsed DOM text, attributes preserve their contents, href/src become absolute URLs, and selections with unique prefix/suffix context may read a changed value. TextQuote locators require an exact quote with matching supplied context. Their ephemeral DOM index is never stored as Snapshot offsets.

The picker offers **Exact selected text** for the original literal and **Current element text (dynamic)** for a uniquely located element. A whole-element selection offers both methods. A narrow selection that does not cover the intended element can be reviewed by picking the element directly. A draft part can also use **Text between markers (dynamic)** to extract from a single ordered pair of stable markers inside an element.

When a locator finds one element and the read fails, its diagnostic can include an extraction error code and bounded, unverified element text. Monitoring captures derive this text from the sanitized DOM associated with the capture.

`dom_path`, `dom_range`, `exact_pos`, `text_position`, and `text_fragment` have separate structured payload types and return `unsupported`. Position payloads require representation, representation version, offset units, and a SHA-256 representation digest. No offsets are inferred from arbitrary `textContent`.

## Local storage and migration

SQLite schema 14 adds `selectors`, `selector_versions`, `selector_recipes`, `selector_parts`, `selector_locators`, and separate `selector_evaluations`. Foreign keys cascade only into selector-owned children; removing a selector never removes a business object or source. Version numbers and child orders are unique within their parent, and a partial index permits at most one active version. The active-version foreign key is deferred so full trees can be created transactionally.

The existing local **Node** DB service migrates version 13 workspaces at startup without advancing their workspace revision. Legacy CSS/fallbacks become alternative locators in one part. Selection rules also retain their quote as a locator. Legacy IDs remain in migration metadata and the SQL rule mapping. Their Snapshot UUID and artifact type remain null, with explicit unverified provenance. Restarting does not regenerate UUIDs. Rules from older pending Views reuse the durable mapping when committed; changed legacy definitions become drafts while their active history remains intact.

Trees remain rule attachments in the workspace compatibility projection. This lets existing field review, partial staging, discard and rebase carry the whole definition without adding another persistence path. The authoritative workspace snapshot and normalized selector rows are saved in the same SQLite transaction. Version transition validation rejects modifications to active, superseded or rejected definitions, including through JSON import or a direct local-service write.

Draft creation, editing and explicit approval happen in View. Approval supersedes the former active version. The approved state reaches SQLite only through the existing Commit flow; creating and approving a draft can share one workspace commit. There is no automatic activation on evaluation failure.

Evaluation values and diagnostics live outside the immutable tree. The workspace keeps the latest 20 evaluations per rule; the normalized evaluation table references the evaluated version. Saving changes to a mutable draft clears diagnostics from its earlier definition. Full version tests and extraction previews retain failures as well as successes. Individual recipe/locator tests display diagnostics without mislabeling partial tests as complete stored evaluations.

## Editor and JSON

Select a field and expand its rule details to see version/recipe/part/locator structure. Create a draft and use **Change extraction method** on the part, or edit the draft JSON. Test the edited draft to see the value and match counts. Save it to View, then approve or reject it. Approval is disabled while the JSON has unsaved changes. Export/import preserves all entity UUIDs and version history. Imported targets must belong to the current workspace object. Approved definitions remain immutable.

`exportSelectorTree`/`importSelectorTree` expose the full portable tree. `selectorTreeDTO` prepares future selector/version API inputs and removes local migration metadata. These helpers perform no network calls. **Backend Pydantic models are not in this repository**: the reserved payload contracts are explicitly local, and their field/enum mapping must be checked against the actual backend before implementing REST serialization. No `/selectors` endpoints, Python backend dependency, Snapshot creation, MinIO behavior or sync changes are introduced.

## Verification

```sh
npm run test:selectors
BURBOT_CHROMIUM=/usr/bin/chromium npm run test:selectors:ui
npm run build
```

The focused tests cover migration and real local-service restarts, normalized SQLite constraints/rollback, draft immutability and approval, JSON/DTO round trips, conflict diagnostics, composite recipes, real DOM XPath/quotes/selections/attributes, HTTP capture UUIDs, editor interaction, and legacy/new highlights.
