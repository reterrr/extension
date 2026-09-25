
## View → Commit → SQLite workflow

The sidepanel has three separate workflow surfaces:

- **View** — the working set. Build it from the existing search syntax (including regex, wildcards and geography filters) or add/remove individual objects with `+` / `−`. Edits and approved imports live here first.
- **Commit** — an explicit object-level staging area. Only objects added from View are written by `Commit to SQLite`. Objects can be removed from Commit without losing their View changes, or discarded individually back to the SQLite/base version.
- **Import** — a review queue for portable JSON. Imported objects can be rejected, restored, or applied to View. Approval never sends an object directly to Commit.

The data flow is:

```text
Import -> View -> Commit -> SQLite
```

Partial commits are supported. After committing selected objects, their View copies are rebased to the new SQLite revision while unrelated View edits stay pending. A partial commit is rejected if it would create a dangling object reference (for example, committing a new recruitment while its new project remains only in View).

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

Current reference files:

- `examples/portable-import-v1.example.json` — complete importable example with Operator, Project, Recruitment, contacts, typed file metadata, file evidence and financing;
- `docs/portable-import-v1.md` — format rules and field semantics.

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
        "status": "AKTYWNY"
      },
      "evidence": {
        "name": [
          {
            "source": "project-page",
            "char_start": 8,
            "char_end": 33,
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

## Operator XLSX import

A one-off/idempotent importer is available for the operator workbook with columns:

```text
operator_id | nazwa_operatora | NIP | strona_www | adres | email | telefon | uwagi
```

Start the local SQLite service first:

```bash
npm run db
```

Then import the workbook from another terminal:

```bash
npm run import:operators -- /path/to/operatorzy.xlsx
```

Validation without writing:

```bash
npm run import:operators -- /path/to/operatorzy.xlsx --dry-run
```

The importer merges operators into the current workspace state instead of replacing it. `operator_id` is used as the stable import key (and as the object ID for new operators), existing matching operators keep their internal IDs, all URLs from `strona_www` are preserved in `values.website`, and the first URL is used as `sourceUrl`. When present, `adres`, `email`, `telefon` and `uwagi` are also persisted as normal operator fields. The import updates `last_checked_at` and increments the workspace revision once.

## Project + geography XLSX import

The BUR workbook can seed/update projects together with their complete project geography.

Prerequisite: import operators first so every `Projekty.operator_id` can be resolved:

```bash
npm run db
npm run import:operators -- /path/to/operatorzy.xlsx
```

Validate the project workbook without modifying SQLite:

```bash
npm run import:projects -- /path/to/bur_.xlsx --dry-run
```

Then import:

```bash
npm run import:projects -- /path/to/bur_.xlsx
```

The importer reads `Projekty`, `Geografia_Slownik` and `Geografia_Projekty`. It is idempotent by `projekt_id`: existing project objects keep their internal IDs, known project fields are refreshed from XLSX, and geography for every imported project is replaced by the exact current XLSX assignment.

Project mapping:

```text
projekt_id                  -> project importKey / object ID for new projects
nazwa_projektu              -> project.name
operator_id                 -> project.operator_id (resolved existing operator)
typ_odbiorcy                -> project.type
status_projektu             -> project.status
data_start                  -> project.start_date
data_koniec                 -> project.end_date
Link do harmonogramu/naborów -> project.announcements_site_url
link_do_dokumentow           -> project.documents_url
link_prowadzi_do_dokumentow  -> project.documents_link_direct
uwagi                         -> project.notes
Uwaga                         -> project.schedule_note
uwagi_techniczne              -> project.technical_notes
import time                   -> project.last_checked_at
```

Geography is normalized against `src/shared/types/geography.ts` before any database write. Powiaty, cities with powiat rights and gminas therefore use the same canonical values as the Workspace geography picker. All imported geography rows use role `OBEJMUJE`.

## Recruitment + geography + financing XLSX import

After operators and projects are present in the local SQLite workspace, the same BUR workbook can import **all recruitments** together with their geography and financing data.

Recommended order:

```bash
npm run db
npm run import:operators -- /path/to/bur_.xlsx
npm run import:projects -- /path/to/bur_.xlsx
npm run import:recruitments -- /path/to/bur_.xlsx --dry-run
npm run import:recruitments -- /path/to/bur_.xlsx
```

The recruitment importer reads `Nabory`, `Geografia_Nabory`, `Geografia_Slownik`, `Projekty` and `Operatorzy`.

It is idempotent by `nabor_id`. For every imported recruitment it refreshes the source-owned fields and replaces only that recruitment's imported geography and financing variants. Existing extraction rules, file sources and document requirements are left intact.

Core mapping:

```text
nabor_id                         -> recruitment importKey / object ID for new records
nabor_nazwa                      -> external_number
nabor_nr                         -> source_number (+ sequence_number when numeric)
projekt_id                       -> project_id
operator_id                      -> operator_id
status                           -> OGLOSZONY / PLANOWANY / AKTYWNY / ZAWIESZONY / ZAMKNIETY / ANULOWANY
nabor_od / nabor_do              -> actual dates, or exact planned dates for PLANOWANY
link_nabor                       -> urlOgloszenia
link_dokumenty                   -> documents_url
kod_dzialania                    -> action_code
zrodlo_danych                    -> data_source_url (supports multiple URLs separated by ;)
uwaga                            -> notes
link_prowadzi_do_konkretnego...  -> direct_recruitment_link
zasady_dofinansowania            -> funding_rules
data_weryfikacji_finansow        -> funding_verified_at
zrodlo_weryfikacji_finansow      -> funding_verification_url
```

`continuous` is set only when the source explicitly describes the recruitment as continuous (including `CIAGLY`/ `ciągły` in the source ID/name/notes/rules).

B2B financing becomes MICRO / SMALL / MEDIUM variants with base/standard refund percentages and company/person limits. B2C financing becomes one `B2C` variant with base/max refund, own-contribution percentages and service/refund limits.

Geography is normalized through the same canonical Burbot geography catalog as Projects. `include` becomes `OBEJMUJE`; `exclude` becomes `WYKLUCZA`.

## Excel export

The **Export Excel** action exports the committed SQLite state as a business workbook. The main sheets remain `Operatorzy`, `Projekty` and `Nabory`, but the export also includes normalized sheets for data that cannot be represented safely in one wide row:

- `Finansowanie` — every funding variant and every current funding field,
- `Dokumenty` — every document requirement with catalog name and requirement fields,
- `Pliki` — all remote file sources attached to objects,
- `Pola_Obiektow` — normalized object field/value dump so no current object value is lost,
- the existing project/operator and geography relation sheets.

`Operatorzy` exports address, email, phone, website and notes. `Nabory` includes all current recruitment date/planning/status/source fields. The final `Nabory` column is `ostatnia_zmiana`, sourced from the recruitment object's `updatedAt` timestamp. `ostatnio_sprawdzono` remains a separate system timestamp.

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
