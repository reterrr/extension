// Shared workspace layout and interaction sizes. Feature styles own their contents.
if (!document.querySelector("style[data-burbot-workspace-layout]")) {
  const style = document.createElement("style");
  style.dataset.burbotWorkspaceLayout = "true";
  style.textContent = `
:root {
  font-size: 14px;
  line-height: 1.5;
  --text-soft: #57685e;
  --muted: #57685e;
  --border-strong: #aabbb0;
  --workspace-top: 124px;
}
html { scroll-padding-top: var(--workspace-top); }
body { margin: 0; }
#root { max-width: 1680px; margin: 0 auto; }
#root > * { min-width: 0; }
#root button, #root summary { touch-action: manipulation; }
#root button {
  min-height: 36px;
  font-size: 13px;
  line-height: 1.4;
}
#root input:not([type=checkbox]):not([type=file]), #root select, #root textarea {
  min-width: 0;
  min-height: 40px;
  max-width: 100%;
  font-size: 14px;
  border-color: var(--border-strong);
}
#root textarea { line-height: 1.5; }
#root :focus-visible {
  outline: 3px solid #246849;
  outline-offset: 3px;
}
#root button:disabled { opacity: .6; cursor: not-allowed; }
#root .icon-button, #root .view-member-remove, #root .view-member-discard,
#root .view-search-toggle { min-width: 36px; min-height: 36px; }
.skip-link {
  position: fixed;
  left: 12px;
  top: -100px;
  z-index: 100;
  padding: 12px 18px;
  border-radius: 8px;
  color: #fff;
  background: #245c43;
}
.skip-link:focus { top: 8px; }
html[data-workflow-mode=commit] .skip-link,
html[data-workflow-mode=import] .skip-link { display: none; }
.brandbar { min-height: 54px; padding: 10px 16px; }
.local-badge { color: var(--text-soft); font-size: 12px; letter-spacing: .02em; }
.workflow-tabs {
  top: 54px;
  padding: 8px 12px;
  gap: 6px;
  background: #f4f6f4;
}
#root .workflow-tabs button {
  min-height: 40px;
  gap: 8px;
  font-size: 14px;
  border: 1px solid transparent;
  border-radius: 8px;
}
#root .workflow-tabs button.active {
  color: #245c43;
  border-color: #9cbfa9;
  background: #e4f0e9;
  box-shadow: inset 0 -2px #2f7659;
}
.workflow-tabs button span { color: inherit; font-size: 12px; }
.view-manager { margin: 12px; padding: 12px; border-radius: 12px; }
.view-manager-header { align-items: flex-start; flex-wrap: wrap; gap: 8px; }
.view-manager-header > div:first-child { min-width: 0; }
.view-manager-header .eyebrow { color: var(--text-soft); font-size: 11px; }
.view-manager-header strong { font-size: 16px; }
.view-manager-header small { color: var(--text-soft); overflow-wrap: anywhere; }
.view-manager-header-actions { flex-wrap: wrap; gap: 4px; }
.view-manager-collapse { border: 1px solid #b3c2b7; }
.view-members { max-height: 180px; padding: 4px; margin-top: 10px; scrollbar-gutter: stable; }
.view-member { flex-wrap: wrap; gap: 4px; padding: 6px; border-radius: 8px; border: 1px solid transparent; }
.view-member + .view-member { border-top-color: #e1e8e2; }
.view-member.is-active { border-color: #a3bda9; background: #edf5ef; box-shadow: inset 3px 0 #2f7659; }
#root .view-member-open { flex: 1 1 160px; padding: 6px; min-width: 0; text-align: left; }
.view-member-open strong, .view-search-open strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.4;
}
.view-member-open small, .view-search-open small { color: var(--text-soft); margin-top: 3px; }
.view-member-stage { border: 1px solid #adbbaf; background: #fff; color: #325e46; }
.view-manager-catalog { margin-top: 10px; }
.view-manager-catalog > summary { min-height: 48px; padding: 8px; gap: 8px; }
.view-manager-catalog > summary strong { font-size: 14px; }
.view-manager-catalog > summary small { color: var(--text-soft); }
.view-search { flex-wrap: wrap; gap: 6px; }
.view-search input { flex: 1 1 180px; }
.view-search button { background: #edf4ee; border: 1px solid #b4c4b9; }
.view-search-help { display: block; color: var(--text-soft); padding: 4px 0 8px; overflow-wrap: anywhere; }
.view-search-results { max-height: 260px; scrollbar-gutter: stable; padding: 4px; }
.view-search-result { padding: 4px; }
.view-search-open { min-width: 0; }
.view-catalog-head { align-items: flex-start; flex-wrap: wrap; gap: 4px; }
.view-catalog-head small { color: var(--text-soft); }
.view-search-open[aria-current=true] { box-shadow: inset 3px 0 #2f7659; background: #edf5ef; }
.connection-bar { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 8px 12px; font-size: 12px; }
#connection { flex: 1 1 160px; color: var(--text-soft); }
.connection-actions { flex-wrap: wrap; }
#workspace-main { padding: 0 12px 12px; }
.object-header { padding: 16px 48px 16px 16px; margin: 12px 0; }
.object-header h1 { font-size: 22px; line-height: 1.3; overflow-wrap: anywhere; }
.object-header .eyebrow { font-size: 12px; }
.progress-label { gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-soft); }
.progress-explanation { display: block; margin-top: 6px; color: var(--text-soft); font-size: 12px; }
.section-navigation { margin: 12px 0; }
.section-navigation > label { display: block; margin-bottom: 5px; color: var(--text-soft); font-size: 12px; font-weight: 600; }
.section-navigation-controls { display: flex; flex-wrap: wrap; gap: 6px; }
.section-navigation-controls select { flex: 1 1 150px; width: auto; }
.section-navigation-controls button { padding: 8px 10px; border: 1px solid #b3c2b7; background: #fff; }
.workspace-section-card { scroll-margin-top: var(--workspace-top); }
.workspace-section-summary { min-height: 64px; padding: 12px; }
.workspace-section-title strong { font-size: 15px; line-height: 1.4; }
.workspace-section-title small { color: var(--text-soft); line-height: 1.4; }
.workspace-section-status { max-width: 38%; color: var(--text-soft); }
#root .field-row { min-height: 64px; padding: 10px 12px; }
.field-label { color: var(--text-soft); font-size: 12px; line-height: 1.4; }
.field-value { font-size: 15px; line-height: 1.4; overflow-wrap: anywhere; }
.field-row.is-missing:not(.selected),
.variant .funding-field-grid .field-row.is-missing:not(.selected) { background: #fafcfb; border-color: #d5ded6; }
.field-value.empty, .field-state-missing { color: var(--text-soft); font-weight: 400; }
.field-value.empty { font-size: 14px; }
.field-mark { min-width: 18px; font-size: 12px; }
.field-value.neutral-answer, .field-row.system-field .field-label { color: var(--text-soft); }
.variant .funding-field-grid .field-label { font-size: 12px; }
.variant .funding-field-grid .field-value { font-size: 14px; }
.funding-tabs { scrollbar-width: thin; padding: 4px; gap: 4px; }
.funding-tabs::-webkit-scrollbar { display: block; height: 6px; }
#root .funding-tab { min-height: 40px; color: #57685e; }
.funding-tab-state { min-width: 20px; height: 20px; color: #57685e; }
.funding-field-group-heading small { color: var(--text-soft); }
.capture-area {
  bottom: 8px;
  max-height: min(52dvh, 520px);
  padding: 16px;
  margin: 8px 12px 12px;
  scroll-padding: 12px;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  border-color: #a9bfb1;
  background: #fff;
}
.capture-heading { align-items: flex-start; }
.capture-heading > span:first-child { flex: 1; min-width: 0; }
.capture-heading small { font-size: 11px; color: var(--text-soft); }
.capture-heading strong { display: block; font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; }
#active-context { display: block; font-size: 12px; }
.capture-heading-actions { flex: none; }
.capture-tools { flex-wrap: wrap; margin: 12px 0; }
.capture-tools button { flex: 1 1 auto; }
.capture-acquire { margin-top: 12px; border: 1px solid #c9d8ce; border-radius: 8px; padding: 0 10px; background: #f8fbf9; }
.capture-acquire > summary { padding: 10px 0; min-height: 40px; color: #325e46; font-size: 13px; }
.capture-acquire .capture-tools { margin-top: 4px; }
.capture-save { position: sticky; bottom: -16px; z-index: 2; padding: 1px 0 12px; background: #fff; box-shadow: 0 -6px 8px #fff; }
.capture-area.is-collapsed { background: #fff; }
#value-label { display: block; margin: 12px 0 6px; font-size: 13px; font-weight: 600; }
#converted { margin: 10px 0; color: var(--text-soft); font-size: 13px; }
#converted.error { color: #9d2525; border-left: 3px solid #ac3838; padding-left: 8px; }
#edit-value[aria-invalid=true] { border: 2px solid #ac3838; }
#root #save { min-height: 44px; width: 100%; font-size: 14px; }
.field-evidence-editor { margin-top: 12px; }
.field-evidence-header { min-height: 48px; cursor: pointer; list-style: none; padding: 10px; }
.field-evidence-header::before { content: "›"; font-size: 20px; }
.field-evidence-editor[open] > .field-evidence-header::before { transform: rotate(90deg); }
.field-evidence-header::-webkit-details-marker { display: none; }
.field-evidence-header > div { flex: 1; }
.field-evidence-header strong { font-size: 13px; }
.field-evidence-header small { display: none; }
.field-evidence-source, .field-evidence-empty { color: var(--text-soft); }
.field-evidence-tools { gap: 6px; }
#rule-details { margin-top: 12px; }
#rule-details > summary { padding: 8px 0; font-size: 12px; }
#notice { margin: 8px 12px; font-size: 13px; overflow-wrap: anywhere; }
#notice:empty { display: none; }
.capture-hint { color: var(--text-soft); font-size: 13px; }
#root .file-source-toolbar { flex-wrap: wrap; }
.file-source-summary { gap: 8px; flex-wrap: wrap; }
.file-source-summary-copy strong { overflow-wrap: anywhere; }
.file-source-field-row { grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); }
@media (min-width: 1100px) {
  html[data-workflow-mode=view] #root {
    display: grid;
    grid-template-columns: 272px minmax(0, 1fr);
    grid-template-rows: auto auto auto auto auto auto;
    align-items: start;
    column-gap: 8px;
  }
  html[data-workflow-mode=view] #root:has(#capture-area:not([hidden])) {
    grid-template-columns: 272px minmax(0, 1fr) 340px;
  }
  .brandbar { grid-column: 1 / -1; grid-row: 1; }
  .workflow-tabs { grid-column: 1 / -1; grid-row: 2; }
  .view-manager {
    grid-column: 1;
    grid-row: 3 / 7;
    position: sticky;
    top: var(--workspace-top);
    margin: 12px 0 12px 12px;
    max-height: calc(100dvh - var(--workspace-top) - 12px);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .view-members { max-height: 280px; }
  .view-member-open { flex-basis: 100%; }
  .view-manager-header-actions { width: 100%; }
  .connection-bar { grid-column: 2; grid-row: 3; border: 0; }
  #workspace-main { grid-column: 2; grid-row: 4; }
  #notice { grid-column: 2; grid-row: 5; }
  .capture-hint { grid-column: 2; grid-row: 6; }
  .capture-area {
    grid-column: 3;
    grid-row: 3 / 7;
    top: var(--workspace-top);
    bottom: auto;
    align-self: start;
    max-height: calc(100dvh - var(--workspace-top) - 12px);
    margin: 12px 12px 12px 0;
    padding: 14px;
  }
  #workspace { container-type: inline-size; }
}
@container (min-width: 600px) {
  .field-group-card .workspace-section-body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; }
  .field-group-card .field-row { margin: 0; }
}
@media (max-width: 380px) {
  .brandbar { padding: 10px 12px; }
  .brand { font-size: 22px; }
  .local-badge { font-size: 11px; }
  #root .workflow-tabs button { font-size: 13px; gap: 4px; }
  .workspace-section-summary { flex-wrap: wrap; gap: 6px; }
  .workspace-section-status { max-width: 100%; margin-left: 25px; text-align: left; }
  .capture-area { padding: 12px; }
}
@media (pointer: coarse) {
  #root button, #root input:not([type=checkbox]), #root select, #root summary { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
@media (forced-colors: active) {
  .field-row.selected, .view-member.is-active, #root .workflow-tabs button.active { outline: 2px solid Highlight; }
}
`;
  document.head.append(style);
}

export {};
