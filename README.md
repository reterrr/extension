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
│   │   └── picker.js
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── main.tsx
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

### Shared

- `src/shared/api` — storage/browser API helpers.
- `src/shared/types` — application and message contracts.
- `src/shared/messaging` — typed extension messaging helpers.
- `src/shared/domain` — existing extraction/domain engine kept as a compatibility module during the migration.

The old picker/domain/workspace code is intentionally retained under `src/` rather than duplicated at repository root. This keeps the current behavior working while browser entrypoints and extension pages move to the new architecture. It can be converted module-by-module to strict TypeScript later without changing the public structure.

## Development

```bash
npm install
npm run typecheck
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
