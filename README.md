# Burbot Firefox Extension

Firefox 140+ WebExtension using React for extension pages and TypeScript for browser runtime code.

## Architecture

```text
extension/
├── src/
│   ├── background/
│   │   └── index.ts
│   ├── content/
│   │   ├── index.ts
│   │   ├── picker.ts
│   │   └── extraction-runner.ts
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── importUi.ts
│   │   ├── main.tsx
│   │   ├── pickerRpc.ts
│   │   ├── styles.css
│   │   └── workspace.js
│   ├── popup/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── options/
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── shared/
│       ├── api/
│       │   └── contracts/
│       ├── extraction/
│       ├── import/
│       │   ├── evidence.ts
│       │   └── format.ts
│       ├── types/
│       ├── messaging/
│       └── domain/
├── public/
├── scripts/
│   └── build.mjs
├── manifest.json
├── package.json
└── tsconfig.json
```

### React + TypeScript

- `src/sidepanel` — main Burbot extraction workspace.
- `src/popup` — toolbar popup.
- `src/options` — extension options/status page.

### Plain TypeScript

- `src/background/index.ts` — context menus, persistence coordination, focus and extension events.
- `src/content/index.ts` — page-side extraction bundle injected on demand.
- `src/content/picker.ts` — selector generation, capture candidates and typed picker transport.
- `src/content/extraction-runner.ts` — execution of durable extraction rules.

### Extraction contracts

Picker candidates and durable extraction rules are deliberately separate:

```text
page element
  -> ExtractionCandidate
  -> user selects one option
  -> ExtractionRule
  -> RUN
  -> ExtractionRuleRunResult
```

- `src/shared/types/picker.ts` contains UI-only candidate types, including the captured `raw` sample.
- `src/shared/types/extraction.ts` contains discriminated extraction strategies and durable/executable rule types. Durable rules do not contain `raw`.
- `src/shared/extraction/rules.ts` converts a candidate and selected option into a durable rule or the current local captured-input format.
- `src/shared/messaging/picker.ts` defines the page/side-panel request, response and event protocol.
- `src/shared/api/contracts/extraction.ts` contains transport shapes for a future backend extraction-run endpoint. They are not wired to HTTP yet.

The extraction discriminator remains `type` (`text`, `attribute`, `selection`, `pageUrl`), selectors remain separate from extraction instructions, and selection rules retain `exact`/`prefix`/`suffix` quote semantics.

### Shared

- `src/shared/api` — storage/browser API helpers and future transport contracts.
- `src/shared/types` — application and extraction contracts.
- `src/shared/messaging` — typed extension messaging helpers.
- `src/shared/import` — portable import validation and imported-evidence lifecycle.
- `src/shared/domain` — existing domain engine kept as a compatibility module during the migration.

`src/sidepanel/workspace.js` remains the legacy DOM-oriented workspace during the migration, but its extraction boundary now goes through typed rule helpers and the typed picker RPC client. This avoids rewriting the workspace UI just to introduce transport types.

## Portable JSON import

The side panel accepts **Burbot Import v1** JSON through **Import JSON**. This is a facts + provenance format, not an extraction-rule format. Imported values never create CSS/XPath selectors or durable extraction rules.

Character ranges are zero-based, end-exclusive and measured in Unicode code points:

```text
[char_start, char_end)
```

Every range is validated against the exact canonical `snapshot.text`. For example:

```json
{
  "version": 1,
  "offset_unit": "unicode_codepoint",
  "sources": [
    {
      "key": "project-page",
      "type": "HTML",
      "url": "https://example.test/project",
      "snapshot": {
        "captured_at": "2026-09-16T08:00:00Z",
        "content_hash": "sha256:optional",
        "parser_version": "burbot-text-v1",
        "text": "Program Generator Kompetencji 3.0 jest realizowany."
      }
    }
  ],
  "objects": [
    {
      "key": "project-1",
      "type": "project",
      "data": {
        "name": "Generator Kompetencji 3.0",
        "type": "B2B",
        "status": "ACTIVE"
      },
      "evidence": {
        "name": [
          {
            "source": "project-page",
            "char_start": 8,
            "char_end": 34,
            "raw_value": "Generator Kompetencji 3.0"
          }
        ]
      }
    }
  ]
}
```

References between objects use portable import keys instead of database/storage IDs:

```json
{
  "project_id": { "$ref": "project-1" }
}
```

Import is additive and atomic: the full document is validated before the new state is committed, and the workspace revision is incremented once. If an imported field is later edited or re-extracted, its old imported evidence is discarded so stale provenance is not retained.

The existing **Export workspace state** action still exports the extension's internal local state, including extraction rules. It is intentionally different from Burbot Import v1.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run start
```

`npm run build` creates a loadable extension in `dist/`.

For manual loading:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/manifest.json`.

For a rebuild-on-change loop:

```bash
npm run dev
```

Then reload the temporary extension in Firefox after a rebuild.

## Build output

The build uses esbuild so background/content scripts are emitted as self-contained classic scripts suitable for Firefox `browser.scripting.executeScript`, while React/ReactDOM are bundled into the UI pages.

Generated files include:

```text
dist/
├── background.js
├── content.js
├── core.js
├── picker.js
├── sidepanel.js
├── sidepanel.html
├── sidepanel.css
├── popup.js
├── popup.html
├── options.js
├── options.html
├── ui.css
├── icon.svg
└── manifest.json
```

`core.js` and `picker.js` remain compatibility build artifacts because the existing workspace still injects them together when connecting to a page. New runtime code can use the single `content.js` bundle.
