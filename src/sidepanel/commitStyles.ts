if (!document.querySelector("style[data-burbot-commit-panel]")) {
  const style = document.createElement("style");
  style.dataset.burbotCommitPanel = "true";
  style.textContent = `
html[data-workflow-mode=commit] #root { max-width: none; display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100dvh; }
html[data-workflow-mode=commit] .brandbar { grid-row: 1; }
html[data-workflow-mode=commit] .workflow-tabs { grid-row: 2; }
html[data-workflow-mode=commit] .import-review-shell { display: none; }
html[data-workflow-mode=commit] .commit-panel.review-workspace {
  display: flex; flex-direction: column; grid-row: 3; min-height: 0; overflow: hidden;
  margin: 0; padding: 0; border: 0; border-radius: 0; background: #fff;
}
.review-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 18px 24px; border-bottom: 1px solid #cbd8cf; background: #f6f9f7; }
.review-toolbar h1 { margin: 0; font-size: 22px; line-height: 1.3; }
.review-toolbar p { margin: 6px 0 0; color: #53665a; font-size: 13px; }
.review-toolbar label { display: grid; gap: 4px; font-size: 12px; }
.review-toolbar select { width: 240px; }
.review-layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); flex: 1; min-height: 0; }
.review-object-select { display: none; }
.review-objects { min-width: 0; overflow-y: auto; padding: 12px; border-right: 1px solid #d1ddd5; background: #f8faf9; }
.review-objects button { display: block; width: 100%; text-align: left; border: 1px solid transparent; padding: 12px; margin-bottom: 6px; background: transparent; }
.review-objects strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
.review-objects small { display: block; margin-top: 6px; color: #54675b; }
.review-objects button[aria-current=true] { background: #d9ede1; border-color: #679077; box-shadow: inset 4px 0 #236a42; }
.review-detail { overflow-y: auto; min-width: 0; padding: 20px 24px 32px; scrollbar-gutter: stable; }
.review-object-header { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; }
.review-object-header h2 { margin: 3px 0 12px; font-size: 21px; line-height: 1.4; overflow-wrap: anywhere; }
.review-object-header small { color: #53665a; }
.review-object-header button { flex: none; border: 1px solid #aabeb1; }
.review-bulk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.review-bulk-actions button { border: 1px solid #b7c7bd; background: #f7faf8; }
.review-group h3 { font-size: 15px; margin: 24px 0 10px; }
.review-row { border: 1px solid #b5cbbb; border-radius: 9px; margin-bottom: 12px; overflow: hidden; }
.review-row.is-later { border-color: #d4bb83; }
.review-row.is-discarded { border-color: #c4cdc7; }
.review-row-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px; background: #edf6f0; }
.is-later .review-row-header { background: #fcf5e7; }
.is-discarded .review-row-header { background: #eff1f0; }
.review-check { display: flex; align-items: center; gap: 10px; flex: 1 1 180px; min-width: 0; cursor: pointer; }
.review-check strong { font-size: 14px; overflow-wrap: anywhere; }
#root .review-check input[type=checkbox], #root .view-result-membership input[type=checkbox] { width: 20px; height: 20px; min-height: 20px; flex: none; accent-color: #246849; }
.review-kind { border-radius: 4px; padding: 2px 6px; font-size: 12px; }
.kind-added { color: #1d643b; background: #cee9d7; }
.kind-modified { color: #245c89; background: #dceafa; }
.kind-removed { color: #923c36; background: #f8ddd9; }
.review-decision { font-size: 12px; color: #495e50; }
.review-row-header button { color: #56665c; border: 1px solid #b8c9be; background: #fff; }
.review-values { display: grid; grid-template-columns: minmax(100px, .7fr) minmax(0, 1fr) minmax(0, 1fr); }
.review-value-label { padding: 8px 12px; font-size: 12px; font-weight: 700; background: #f7faf8; color: #53665a; }
.review-value-row { display: contents; }
.review-value-row > span { padding: 12px; border-top: 1px solid #dce5df; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
.review-value-row small { display: none; }
.review-value-row .review-property { color: #53665a; font-size: 12px; }
.review-before { background: #fff0ed; color: #7b342c; }
.review-after { background: #e2f3e8; color: #194d30; font-weight: 550; }
.is-later .review-after { background: #fff6df; color: #735718; }
.is-discarded .review-before, .review-kept { background: #f5f7f6; color: #53665a; }
.review-discarded-proposal { padding: 8px 12px; color: #59665e; font-size: 12px; }
.review-discarded-proposal p { overflow-wrap: anywhere; }
.review-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 24px; border-top: 1px solid #c1d0c6; background: #f5f9f6; }
.review-footer strong, .review-footer span { display: block; }
.review-footer span { font-size: 12px; color: #53665a; margin-top: 3px; }
#root .commit-primary { color: #fff; background: #245f45; border: 1px solid #245f45; min-height: 44px; padding: 10px 24px; }
.commit-error, .review-message { width: 100%; margin: 0; font-size: 13px; }
.commit-error { color: #a02d26; }
.review-message { color: #235a3c; }
.review-empty { display: grid; align-content: center; min-height: 260px; text-align: center; padding: 24px; color: #53665a; }
.review-empty h2 { color: #263d30; font-size: 22px; }
@media (max-width: 800px) {
  .review-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .review-objects { display: none; }
  .review-object-select { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 12px; padding: 10px 12px; border-bottom: 1px solid #d1ddd5; background: #f5f9f6; }
  .review-object-select select { flex: 1; width: 100%; }
  .review-detail { padding: 16px 12px 24px; }
  .review-toolbar { padding: 12px; }
  .review-toolbar h1 { font-size: 19px; }
  .review-toolbar p { max-width: 500px; }
  .review-object-header { flex-wrap: wrap; }
  .review-footer { padding: 12px; }
}
@media (max-width: 520px) {
  .review-toolbar { gap: 8px; }
  .review-toolbar p { display: none; }
  .review-object-header > div { display: none; }
  .review-object-header { justify-content: flex-end; margin-bottom: 8px; }
  .review-bulk-actions { flex-wrap: nowrap; margin-bottom: 10px; }
  .review-bulk-actions button { flex: 1; padding: 6px; }
  .review-group h3 { margin-top: 14px; }
  .review-toolbar label { width: 100%; grid-template-columns: auto minmax(0, 1fr); align-items: center; }
  .review-toolbar select { width: 100%; }
  .review-values { display: block; }
  .review-value-label { display: none; }
  .review-value-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .review-value-row .review-property { grid-column: 1 / -1; padding: 6px 12px; background: #fafcfb; }
  .review-value-row small { display: block; font-weight: normal; font-size: 11px; margin-bottom: 4px; }
  .review-footer > button { flex: 1; }
}
@media (forced-colors: active) {
  .review-objects button[aria-current=true], .review-row.is-save { outline: 2px solid Highlight; outline-offset: -2px; }
}
`;
  document.head.append(style);
}
export {};
