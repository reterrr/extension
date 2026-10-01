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

Default builds now use production React and minification. The sidepanel bundle
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
  background startup restores an active draft from IndexedDB first.
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

Validation for this pass: 75 focused contract tests and three browser tests pass.
The repository still has 68 pre-existing TypeScript diagnostics; this pass adds
none. The full `npm test` command remains blocked at its typecheck gate.
