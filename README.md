# Burbot Picker

A local extraction workspace for Firefox desktop 140+. Create objects from names
on a webpage, then teach Burbot where each business field comes from.
No build step or runtime dependencies are required to load the extension.

## Load and use

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Choose **Load Temporary Add-on** and select `manifest.json`.
3. Open an ordinary HTTP(S) webpage and highlight an entity name.
4. Right-click → **Create Burbot object** → **Project**, **Recruitment**, or **Operator**.
5. The sidebar opens on the new object with the selected name and the next empty
   field active. Click any field to capture a different value.
6. Select text on the page, click **Pick element**, or choose **Use page URL**.
   Review or adjust the result, then click **Save rule & next**.

Objects are created only from the page context menu. There is no manual object
creation form in the sidebar. The compact object switcher separates objects from
the connected page and other saved objects. The actions menu contains JSON export
and object deletion.

The capture controls appear only when a field is active. Enum fields use a
selection control; dates, percentages and PLN amounts display in readable formats.
Manual adjustments keep an existing extraction rule. A value entered without a
page capture is labeled as a manual value and does not manufacture a rule.

The toolbar button opens the sidebar and connects the current tab. Use **Connect**
if Firefox has not granted access to a newly opened or navigated page. Escape
cancels element picking; closing the sidebar disconnects the picker.

Temporary installation ends when Firefox restarts. Normal permanent installation
requires [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Business fields

The hardcoded definitions in `schema.js` match the supplied business model:

- **Project:** name, project type (B2B/B2C), status, number, start/end dates,
  announcements page. New projects default to Planned.
- **Operator:** name and NIP.
- **Recruitment:** `external_number` as the display field, `project_id`, sequence
  number, year, status, dates, announcement year/quarter, closure outcome/reason,
  and announcement URL. New recruitments default to Announced.

The supplied model does not define the members of `RecruitmentStatus` or
`ClosedStatus`. Those two fields remain readable text inputs until the authoritative
enums are supplied. No enum members or business transitions are guessed.

Projects and recruitments also have dedicated business sections:

- **Funding:** Micro, Small, Medium and Large, each with independent variants for
  refund percentage, maximum amount, maximum per person, own contribution and notes.
- **Documents:** a hardcoded catalog of 31 document types, grouped by Required,
  Optional, Internal or Not configured, with subtle requirement/auto-fill badges.
  Expand a document to configure its requirement, auto-fill flag or notes.

Funding and document fields participate in the same capture and replay workflow.
Nothing is assumed to be required or enabled before configuration. Auto-fill is a
saved requirement flag; this extension does not generate or fill documents.
Recruitment settings are local to that recruitment; automatic inheritance from
project settings is not implemented. There is no backend or generic schema editor.

## Storage and compatibility

The existing `browser.storage.local` key **`burbot:v1`** and snapshot version remain
unchanged. Writes still use a serialized background queue with revision checks.
Reading existing data performs no migration or rewrite.

- `objects`: existing IDs, types, labels, values and timestamps; new objects also
  retain `sourceUrl`.
- `rules`: existing object/field rules and extraction definitions remain separate
  from object values.
- `financingRules`: added lazily; each variant has an ID, `objectId`, company size,
  variant number and its business values.
- `documentRequirements`: added lazily; requirements belong to an `objectId` and a
  document catalog key.

Existing `nabor` records remain available without renaming their type or field
keys. Previously captured Project amounts and Operator website/email fields remain
visible when present. New recruitment creation uses `recruitment`.

Rules for configuration fields add a `target` (`funding` variant ID or `document`
catalog key); old object rules need no target. Saving a field again replaces only
its own rule. JSON export includes all collections. No import UI or rule history
is included.

Context creation saves a rule for the selected primary field when the picker can
anchor that exact selection. If it cannot, it still saves the selected value and
source, with a message to capture its rule. Sidebar focus is retained per Firefox
window in session storage, including when the sidebar is still opening.

## Extraction behavior

Partial text selections retain surrounding context. Replay reads between those
anchors, allowing the selected value to change in length. Missing or ambiguous
context produces an error. Whole-element rules read current `textContent`.

Supported attributes: `href`, `src`, `datetime`, `title`, `alt`, `content`.
`href` resolves the closest enclosing link; relative `href`/`src` values become
absolute URLs. Page-URL rules do not require a selector.

Replay requires the original full URL, including query and fragment. Use
**Preview re-extraction** and review the results before applying them. Failed
results leave their old values intact. Manual corrections record a sample-specific
adjustment: it is reused only while the page still returns that exact sample;
changed page values are normalized again.

Dates are stored as `YYYY-MM-DD`. Common Polish/English currency formats become
numbers. Ambiguous numbers such as `1.234` are rejected. Money uses JavaScript
numbers, not decimal accounting arithmetic. NIP preserves leading zeroes and
requires ten digits; it does not perform registry verification.

Page strings render with `textContent`. The extension makes no network requests
and sends no data to a service. It uses `activeTab` access from the user's action,
not blanket access to every website.

Capture covers the top document's ordinary DOM. Iframes, shadow DOM, editable
controls, restricted pages, Firefox internal pages and its PDF viewer are
unsupported. No OCR, API interception, snapshots or background monitoring.
Selectors can become stale after layout changes.

## Development and validation

```sh
npm ci
npm test
npm run lint
npx playwright install firefox
npm run test:browser
npm run build
```

The unit suite covers context-menu registration/creation, concurrent writes,
window focus, legacy storage preservation, business normalization, independent
funding/document rules, corrections, re-extraction and revision conflicts.

The browser suite temporarily installs the real extension into an isolated
Playwright Firefox profile. It drives the native selection menu, closed-sidebar
creation, object switching, text/DOM/page-URL capture, save-next, funding/documents,
and changed-value replay against a local HTTP fixture. Firefox DevTools controls
the actual sidebar; WebExtension APIs are not mocked. Screenshots are written to
`test-artifacts/`. The DevTools helper is pinned to the Playwright Firefox version.
In a container without user namespace support, run
`BURBOT_TEST_CONTAINER=1 npm run test:browser` to disable browser process sandboxing
for that isolated test profile only.

`web-ext lint` may report the existing Firefox for Android minimum-version warning
for `data_collection_permissions`; this extension targets desktop Firefox's sidebar.
The ZIP build is unsigned and is written to `web-ext-artifacts/`.

For a manual walkthrough, serve this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/demo.html`. Create a Project from the heading, capture
B2B, select just the date for End date, add a Micro funding variant and pick its
refund/amount. Use the demo's change button, then preview and apply re-extraction.
Expected updated values: End date `2026-11-15`, Maximum amount `120000`.

## Code map

| File                                        | Responsibility                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `schema.js`                                 | Hardcoded business definitions, presentation hints and document catalog |
| `core.js`                                   | Normalization, extraction helpers and atomic state mutations            |
| `background.js`                             | Native creation menus, serialized persistence and per-window focus      |
| `picker.js`                                 | Existing selector generator, DOM/text capture and replay                |
| `sidebar.html`, `sidebar.css`, `sidebar.js` | Annotation workspace and contextual capture                             |
