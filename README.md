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
- `src/shared/domain` — existing domain engine kept as a compatibility module during the migration.

`src/sidepanel/workspace.js` remains the legacy DOM-oriented workspace during the migration, but its extraction boundary now goes through typed rule helpers and the typed picker RPC client. This avoids rewriting the workspace UI just to introduce transport types.

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
