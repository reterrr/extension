# Workspace performance

The October 2026 performance pass targets import approval, selected-change
review, page highlights and redundant UI work. Portable JSON v1 is unchanged.

## Measurements

Synthetic, local Node 24 / headless Chromium measurements against `10e2a68`.
The workspace fixture contains 150 objects, 3,600 child rows, 300 changes and
a large regulation snapshot. Workspace timings are medians after warm-up.
They measure synchronous business logic, excluding IndexedDB, IPC and SQLite;
they are not promises about end-to-end timings on other computers.

| Operation | Before | After |
| --- | ---: | ---: |
| Build change review | 123 ms | 43 ms |
| Build commit-session projection | 288 ms | 56 ms |
| Select all 300 changes | 36,102 ms | 46 ms |
| Stage an existing-object import | 19 ms | 0.28 ms |
| Stage a new recruitment with an existing project reference | 84 ms | 0.12 ms |
| Repeat the same 60 page highlights | 149 ms | about 0.5 ms |

Highlight tests also assert deterministic work counts: 60 quotes sharing
`body` build one text index, rather than 60; identical updates perform zero
additional text walks and preserve overlay DOM nodes. Unrelated page updates
reuse anchors; replaced text and links resolve again. Adding a file uses its
link selector without rebuilding existing quote overlays.

The first performance pass switched builds to production React and minification. The sidepanel bundle
falls from about 1.9 MiB to 716 KiB, with the popup/options bundles around
190/202 KiB. `npm run dev` retains the development build.

## Persistence and updates

- Import staging copies the edited owner and stages new objects/dependency
  remapping in isolation. Existing unrelated data and source snapshots are
  retained. Failed approval does not modify the input workspace.
- A draft's immutable base is stored once per `(draft id, base revision)`.
  Later writes persist the working state and decisions. Base replacement,
  pointer updates and obsolete-base cleanup share one IndexedDB transaction.
  Existing inline-base drafts are readable and upgraded on the next write.
- Live updates travel through one runtime notification, then one local
  `burbot:workspace-state-changed` event. They do not write the whole draft to
  `storage.local`. The compatibility mirror holds committed/startup data;
  the first open workspace restores an active draft from IndexedDB before page highlighting.
- Every live notification has an independent ID. Revision numbers cannot be
  used to deduplicate draft edits, since those intentionally share a revision.
- Related UI renders and commit refresh requests are coalesced. Field selection
  only updates the editor; normal field rows are reused while their owner stays
  the same. Busy state updates controls without rebuilding the form.
- The highlighter observes the page only while it has highlights. It retains
  unchanged overlays, shares quote indexes within each reconciliation, and
  reads layout before writing overlay positions. The locator cache stays in
  sidepanel memory and refreshes on actual cache notifications.
- Review indexes live for one operation, so in-place edits at the same revision
  cannot leave stale comparisons. Bulk decisions compute one diff and preserve
  atomic operator-role groups, deferred items and undoable discarded proposals.

The working state still has a durable IndexedDB write on each edit. The change
does not debounce or discard persistence to produce faster UI timings.

## Reproduce

```sh
npm run benchmark:workspace
# To compare a previous checkout using this benchmark:
node scripts/benchmark-workspace.mjs /path/to/baseline
node scripts/benchmark-workspace.mjs /path/to/baseline --imports-only

npm run benchmark:highlights
node scripts/benchmark-highlights.mjs /path/to/baseline
npm run test:ui
```

Set `BURBOT_CHROMIUM` to a Chromium executable if Playwright has no downloaded
browser. Browser tests cover the built UI, dynamic-page highlights, actual
IndexedDB persistence, reload, legacy drafts, failed-write atomicity and
notification delivery between two panels. They use deterministic transport
mocks and do not write to a user's SQLite service. Timing numbers are diagnostic;
tests gate behavior and work counts rather than machine-dependent milliseconds.

Validation for the first pass: 75 focused contract tests and three browser tests pass.
The repository still has 68 pre-existing TypeScript diagnostics; this pass adds
none. The full `npm test` command remains blocked at its typecheck gate.


## Loading features on demand

Extension pages now use ESM with real esbuild code splitting. The background and
injected page scripts stay IIFEs, compatible with Firefox's `executeScript`.
Chunks are packaged under `dist/chunks`; extension pages import their own files
without exposing them as web-accessible resources. Production builds also write
`.build/pages-meta.json` for local bundle inspection; it is excluded from the
extension package and from git.

| Entry point | First load / activation |
| --- | --- |
| Sidepanel | Navigation, View, core editor and small workspace helpers |
| Files / operators | First opening of their section, including restored open sections |
| Geography | First opening; its catalog also loads when a geography-aware search needs it |
| Import | First entering Import; leaving it unmounts the review and its observer |
| Save changes | First entering Save changes, which fetches the full review |
| PDF capture | Opening the reader or receiving the first PDF selection |
| Excel export | Clicking export |
| Funding / contacts | Rows render only for an open section or its restored active editor |

In the built-UI fixture with closed sections and no existing page highlights,
initial JS requests total **394,512 bytes** (22 local files), versus **733,604
bytes** for the previous monolith: about **46% less JS loaded at startup**.
This includes all shared and dynamically imported startup chunks, not just the
small `sidepanel.js` entry. It measures bytes loaded, not a startup-time speedup.
Opening saved sections or matching existing highlights intentionally loads more.
The browser test prints the current total from the build metafile and checks
which feature implementations were actually requested.

A live workspace port registers its window with the background. Only the active
HTTP(S) tab in each registered window is eligible for selector/evidence work.
Inactive tab updates and windows without an open workspace do not trigger it.
Switching tabs or closing the last panel clears old overlays; pending async work
is invalidated before subsequent injection or sending. Empty highlight lists
never cause injection. Import overlays are also cleared when leaving Import or
closing the panel. Picker injection starts on Connect, field capture interaction
or the file shortcut, rather than every tab activation.

The panel shares one initial workspace GET and adopts later live snapshots;
features opened later use that current snapshot. A live edit wins over an older
in-flight GET, and object creation can force a follow-up read. Navigation uses
`BURBOT_COMMIT / SUMMARY` instead of full field diffs. The Import badge reads a
small counter stored atomically with its session. Older import sessions receive
that counter on their first read; subsequent badge updates skip the full session.

The workspace still loads one complete `LegacyStorageState`. Per-object and
per-feature database reads are the next data-layer step; durable saves and the
portable JSON format remain the same.

Validation for this pass: **81 focused contract tests and 8 browser tests pass**.
They cover the actual background's tab/injection boundaries, activation races,
closed-panel behavior, cold feature loading, restored sections, first-use file
shortcuts and PDF selections, current data after delayed loading, summary
migration, IPC races and existing editing/import/save workflows. Firefox package
lint reports zero errors (8 warnings from the manifest/vendor bundles). The same
68 pre-existing TypeScript diagnostics still block the full `npm test` gate.
