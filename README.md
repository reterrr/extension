# Burbot Picker

Firefox desktop MVP, targeting Firefox 140+.
No build step or runtime dependencies.

## Load

Open about:debugging#/runtime/this-firefox.
Click Load Temporary Add-on and select manifest.json.
Open a website and click the Burbot toolbar button.

Create an object, choose a field, select page text or pick an element,
choose the extraction method, and click Assign.

Click the toolbar button again after switching to an unconnected tab
or navigating. Close the sidebar to disconnect the picker.
Escape cancels element picking.

Temporary installation ends when Firefox restarts.
Normal permanent installation requires Mozilla signing.

## Data

browser.storage.local stores an atomic snapshot under burbot:v1:

- objects: id, type, label, values, timestamps
- rules: id, objectId, field, pageUrl, selector, extraction, sampleValue

Assigning again replaces the existing rule for that object/field.
Export JSON saves both collections.
This MVP has no import UI, backend, scheduler, or rule history.

Partial text selections retain surrounding context. Replay reads between
those anchors, allowing the selected value to change in length.
Missing or ambiguous context produces an error.
Whole-element rules read current textContent.

Supported attributes: href, src, datetime, title, alt, content.
href resolves the closest enclosing link.
Relative href/src values become absolute URLs.

Replay requires the original full URL, including query and fragment.
Preview results before applying them.

Dates become YYYY-MM-DD. Common Polish and English currency formats
become numbers. Ambiguous values such as 1.234 are rejected.
Money uses JavaScript numbers, not decimal accounting arithmetic.

## Code

schema.js: hardcoded object types and fields
core.js: normalization, extraction helpers, state mutations
background.js: serialized persistence with revision checks
picker.js: selectors, DOM/text capture, extraction
sidebar.html / sidebar.css / sidebar.js: user interface

Page strings are rendered using textContent.
The extension makes no network requests and sends no data to a service.

## Smoke test

From this directory run:

python3 -m http.server 8000 --bind 127.0.0.1

Visit http://127.0.0.1:8000/demo.html.
Connect with the Burbot toolbar button.
Create a Nabór object.
Assign the title, just the date within its sentence, and the amount.
Click Change deadline and allocation, then preview and apply.

Expected values:
deadline: 2026-11-15
amount: 12000000

Export JSON and inspect the separate objects and rules collections.
Close and reopen the sidebar to check persistence.

## Validation and limits

JavaScript syntax and 24 core checks passed in a V8 isolate.
URL and WebExtension APIs were test doubles.
Firefox, DOM interactions, the Python generator, and ZIP loading
were not executed in that environment.

Capture covers the top document's ordinary DOM.
Iframes, shadow DOM, editable controls, restricted pages, Firefox
internal pages, and its PDF viewer are unsupported.
No OCR, API interception, snapshots, or background monitoring.
Selectors can become stale after layout changes.
