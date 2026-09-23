if (!document.querySelector("style[data-burbot-workflow-tabs]")) {
  const style = document.createElement("style");
  style.dataset.burbotWorkflowTabs = "true";
  style.textContent = `
.workflow-tabs {
  position: sticky;
  top: 47px;
  z-index: 28;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border, #dfe6df);
  background: rgba(244, 246, 244, .97);
  backdrop-filter: blur(8px);
}
.workflow-tabs button {
  min-height: 31px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid #dce5de;
  border-radius: 8px;
  background: #f8faf8;
  color: #65736a;
  font-size: 10px;
  font-weight: 650;
}
.workflow-tabs button.active {
  border-color: #9ebca8;
  background: #eaf4ed;
  color: #28543b;
}
.workflow-tabs button span {
  min-width: 17px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #dfece3;
  font-size: 8px;
  font-weight: 800;
}

/* View owns the editor. */
.view-manager {
  display: none;
  margin: 6px 10px 0;
  padding: 8px;
  border: 1px solid #dfe6df;
  border-radius: 9px;
  background: #fff;
}
html[data-workflow-mode="view"] .view-manager {
  display: block;
}
.view-manager-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.view-manager-header > div {
  min-width: 0;
}
.view-manager-header strong {
  display: block;
  margin-top: 1px;
  font-size: 11px;
}
.view-manager-header small {
  display: block;
  max-width: 100%;
  margin-top: 1px;
  overflow: hidden;
  color: #748078;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view-members {
  max-height: 145px;
  margin-top: 6px;
  overflow-y: auto;
  border-top: 1px solid #edf1ee;
}
.view-member,
.view-search-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 4px;
  align-items: stretch;
  padding: 3px 0;
}
.view-member + .view-member,
.view-search-result + .view-search-result {
  border-top: 1px solid #f0f3f1;
}
.view-member-open,
.view-search-open {
  min-width: 0;
  padding: 4px 5px;
  text-align: left;
}
.view-member-open strong,
.view-search-open strong {
  display: block;
  overflow: hidden;
  color: #2c3c33;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view-member-open small,
.view-search-open small {
  display: block;
  margin-top: 1px;
  color: #849087;
  font-size: 7px;
}
.view-member-remove,
.view-search-toggle {
  min-height: 28px;
  padding: 0;
  border: 1px solid #dce5de;
  border-radius: 6px;
  background: #f8faf8;
  color: #39634d;
  font-size: 15px;
}
.view-member-remove:hover,
.view-search-toggle:hover {
  background: #eaf4ed;
}
.view-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
  margin-top: 7px;
}
.view-search input {
  min-width: 0;
  min-height: 31px;
  padding: 6px 8px;
  border: 1px solid #ccd8cf;
  border-radius: 7px;
  background: #fbfcfb;
  font-size: 9px;
}
.view-search > button {
  min-height: 31px;
  padding: 5px 8px;
  border: 1px solid #b8cebf;
  border-radius: 7px;
  background: #edf5f0;
  color: #315e47;
  font-size: 9px;
  font-weight: 700;
}
.view-search > button:disabled {
  opacity: .48;
}
.view-search-results {
  max-height: 180px;
  margin-top: 5px;
  overflow-y: auto;
  border-top: 1px solid #edf1ee;
}
.view-manager-empty,
.view-manager-error,
.view-manager-more {
  display: block;
  margin: 6px 2px 2px;
  color: #7f8a83;
  font-size: 8px;
}
.view-manager-error {
  color: #a34949;
}

html[data-workflow-mode="view"] .commit-panel-active,
html[data-workflow-mode="view"] .import-review-panel {
  display: none !important;
}
html[data-workflow-mode="view"] .commit-panel-idle {
  display: grid !important;
  margin-top: 6px;
}

/* Commit is a focused staged-diff surface. */
html[data-workflow-mode="commit"] .import-review-panel,
html[data-workflow-mode="commit"] .connection-bar,
html[data-workflow-mode="commit"] main,
html[data-workflow-mode="commit"] #notice,
html[data-workflow-mode="commit"] #capture-hint,
html[data-workflow-mode="commit"] #capture-area {
  display: none !important;
}
html[data-workflow-mode="commit"] .commit-panel {
  display: block !important;
  margin-top: 8px;
}

/* Import owns the review queue. */
html[data-workflow-mode="import"] .commit-panel,
html[data-workflow-mode="import"] .connection-bar,
html[data-workflow-mode="import"] main,
html[data-workflow-mode="import"] #notice,
html[data-workflow-mode="import"] #capture-hint,
html[data-workflow-mode="import"] #capture-area {
  display: none !important;
}

.object-workflow-actions {
  display: flex;
  gap: 5px;
  margin-top: 6px;
}
.object-workflow-actions button {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 9px;
}
.object-workflow-actions #stage-object {
  flex: 1;
}
.object-workflow-actions #remove-object-from-view {
  flex: none;
}

.object-option-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  gap: 3px;
  align-items: stretch;
}
.object-option-row .object-option {
  min-width: 0;
}
.object-option-view-toggle {
  min-height: 38px;
  margin: 2px 0;
  padding: 0;
  border: 1px solid #dce5de;
  border-radius: 7px;
  background: #f7faf7;
  color: #315e47;
  font-size: 16px;
  font-weight: 600;
}
.object-option-view-toggle:hover {
  background: #eaf4ed;
  border-color: #b6cfbf;
}

.commit-pending-view {
  margin-top: 6px;
  overflow: hidden;
  border: 1px dashed #d6dfd8;
  border-radius: 7px;
  background: #fafbfa;
}
.commit-pending-view > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 7px;
  list-style: none;
  color: #68766d;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
}
.commit-pending-view > summary::-webkit-details-marker {
  display: none;
}
.commit-pending-view > summary::before {
  content: "▸";
  color: #8b978f;
}
.commit-pending-view[open] > summary::before {
  content: "▾";
}
.commit-pending-view > summary span {
  margin-left: auto;
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #edf1ee;
  text-align: center;
  font-size: 8px;
}
.commit-pending-list {
  padding: 0 6px 6px;
  border-top: 1px solid #edf1ee;
}
.commit-pending-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 25px;
  gap: 5px;
  align-items: center;
  padding: 5px 1px;
}
.commit-pending-row + .commit-pending-row {
  border-top: 1px solid #edf1ee;
}
.commit-pending-copy {
  min-width: 0;
}
.commit-pending-copy strong {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-pending-copy small {
  display: block;
  color: #849087;
  font-size: 7px;
}
.commit-stage-pending {
  min-height: 25px;
  padding: 4px 6px;
  border: 1px solid #b8cebf;
  border-radius: 6px;
  background: #edf5f0;
  color: #315e47;
  font-size: 8px;
  font-weight: 700;
}
.commit-discard-pending {
  min-height: 25px;
  padding: 0;
  color: #9b4a4a;
  font-size: 13px;
}

.commit-object-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid #edf1ee;
}
.commit-object-actions button {
  min-height: 26px;
  padding: 4px 7px;
  font-size: 8px;
}
.commit-unstage {
  color: #536b5d;
}
.commit-discard-object {
  color: #9b4a4a;
}

.import-review-actions {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}
.import-review-actions .import-review-approve {
  flex: 1;
}
.import-review-list button.rejected {
  opacity: .58;
}
.import-review-list button.rejected > span {
  text-decoration: line-through;
}

.import-empty-state {
  max-width: 520px;
  margin: 28px auto;
  padding: 28px 24px;
  border: 1px solid #dce5de;
  border-radius: 12px;
  background: #fff;
  text-align: center;
}
.import-empty-state h2 {
  margin: 5px 0 7px;
  font-size: 16px;
}
.import-empty-state p {
  margin: 0 auto 14px;
  max-width: 390px;
  color: #728078;
  font-size: 10px;
  line-height: 1.45;
}

/* --- Three-surface workflow polish --------------------------------------- */

html[data-workflow-mode="view"] .commit-panel {
  display: none !important;
}

/* View: active set + explicit working actions. */
.view-manager {
  margin: 6px 10px 4px;
  padding: 9px;
}
.view-manager-header {
  align-items: center;
}
.view-manager-header-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}
.view-start {
  min-height: 27px;
  padding: 4px 8px;
  border: 1px solid #b7cdbd;
  border-radius: 7px;
  background: #edf5f0;
  color: #315e47;
  font-size: 9px;
  font-weight: 700;
}
.view-members {
  max-height: 190px;
  margin-top: 7px;
}
.view-member {
  display: flex;
  gap: 4px;
  align-items: center;
}
.view-member-open {
  flex: 1;
}
.view-member-stage,
.view-member-discard,
.view-member-remove {
  flex: none;
  min-height: 27px;
  border: 1px solid #dce5de;
  border-radius: 6px;
  background: #f8faf8;
  font-size: 8px;
}
.view-member-stage {
  padding: 4px 7px;
  color: #315e47;
  font-weight: 700;
}
.view-member-stage.is-staged {
  border-color: #9ebca8;
  background: #e7f2ea;
  color: #28543b;
}
.view-member-discard {
  width: 28px;
  padding: 0;
  color: #9a5959;
  font-size: 13px;
}
.view-member-remove {
  width: 28px;
}
.view-catalog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
  padding: 6px 2px 4px;
  border-top: 1px solid #edf1ee;
}
.view-catalog-head strong {
  color: #45564c;
  font-size: 9px;
}
.view-catalog-head small {
  color: #849087;
  font-size: 8px;
}
.view-search-results {
  max-height: 220px;
}
.view-search-result {
  grid-template-columns: minmax(0, 1fr) 28px;
}

/* Import is its own compact surface. */
.import-review-panel {
  margin: 6px 10px 8px;
  border-radius: 9px;
}
.import-review-header {
  align-items: center;
  padding: 9px 10px 7px;
}
.import-review-header strong {
  max-width: min(68vw, 620px);
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.import-review-header small {
  font-size: 8px;
}
.import-review-layout {
  grid-template-columns: minmax(190px, 26%) minmax(0, 1fr);
  min-height: 0;
}
.import-review-list {
  max-height: calc(100vh - 155px);
  overflow-y: auto;
  padding: 7px;
}
.import-review-list details + details {
  margin-top: 5px;
}
.import-review-list summary {
  font-size: 9px;
}
.import-review-list button {
  margin-top: 3px;
  padding: 6px 7px;
  border-radius: 6px;
}
.import-review-list button > span {
  font-size: 9px;
}
.import-review-list button small {
  font-size: 7px;
}
.import-review-detail {
  padding: 9px 10px 76px;
}
.import-review-object-title {
  margin-bottom: 6px;
}
.import-review-object-title h2 {
  margin-top: 1px;
  font-size: 14px;
}
.import-review-edit-badge {
  padding: 2px 6px;
  font-size: 7px;
}
.import-review-sources {
  gap: 5px;
  margin-bottom: 7px;
}
.import-review-sources button {
  min-height: 24px;
  padding: 3px 5px;
  font-size: 8px;
}
.import-review-section {
  gap: 5px;
  margin-top: 8px;
}
.import-review-section + .import-review-section {
  padding-top: 8px;
}
.import-review-section-heading strong {
  font-size: 10px;
}
.import-review-section-heading > small {
  font-size: 8px;
}
.import-review-fields {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 4px;
}
.import-review-fields > div {
  gap: 3px;
  padding: 6px 7px;
  border-radius: 6px;
}
.import-review-field-head small,
.import-review-field-meta span {
  font-size: 8px;
}
.import-review-workspace-value {
  font-size: 10px;
  line-height: 1.3;
}
.import-review-field-meta {
  gap: 5px;
}
.import-review-source-button {
  font-size: 8px;
}
.import-review-finance-card > summary {
  padding: 6px 7px;
  font-size: 9px;
}
.import-review-finance-fields {
  gap: 4px;
  padding: 0 6px 6px;
}
.import-review-file-card {
  gap: 4px;
  padding: 6px 7px;
}
.import-review-hint {
  margin: 8px 0;
  font-size: 9px;
}
.import-review-update-existing {
  margin: 7px 0;
  padding: 7px 8px;
}
.import-review-actions {
  position: sticky;
  z-index: 4;
  bottom: 0;
  margin: 9px -10px -76px;
  padding: 8px 10px;
  border-top: 1px solid #dfe6df;
  background: rgba(255, 255, 255, .97);
  backdrop-filter: blur(6px);
}
.import-review-actions button {
  min-height: 30px;
  font-size: 9px;
}

@media (max-width: 640px) {
  .import-review-layout {
    grid-template-columns: 1fr;
  }
  .import-review-list {
    max-height: 150px;
    border-right: 0;
    border-bottom: 1px solid #edf1ed;
  }
  .import-review-fields {
    grid-template-columns: 1fr;
  }
}


/* Single canonical View manager. The editor no longer owns View membership. */
html[data-workflow-mode="view"] #active-object-view,
html[data-workflow-mode="view"] .object-workflow-actions {
  display: none !important;
}

.view-manager-catalog {
  margin-top: 7px;
  overflow: hidden;
  border-top: 1px solid #edf1ee;
}
.view-manager-catalog > summary {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 2px 3px;
  list-style: none;
  color: #44554b;
  cursor: pointer;
}
.view-manager-catalog > summary::-webkit-details-marker {
  display: none;
}
.view-manager-catalog > summary::before {
  content: "▸";
  flex: none;
  color: #8a968e;
  font-size: 9px;
}
.view-manager-catalog[open] > summary::before {
  content: "▾";
}
.view-manager-catalog > summary > span:first-of-type {
  min-width: 0;
  flex: 1;
}
.view-manager-catalog > summary strong {
  display: block;
  font-size: 9px;
}
.view-manager-catalog > summary small {
  display: block;
  margin-top: 1px;
  color: #849087;
  font-size: 7px;
}
.view-manager-catalog-count {
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #edf2ee;
  color: #66746b;
  text-align: center;
  font-size: 8px;
  font-weight: 750;
}
.view-manager-catalog-body {
  padding-top: 2px;
}
.view-manager-catalog:not([open]) .view-manager-catalog-body {
  display: none;
}
.view-manager .view-search-results {
  max-height: 190px;
}

.object-picker-view-only .object-picker-toolbar {
  padding-bottom: 6px;
}
.object-picker-view-only .object-picker-search-feedback {
  min-height: 0;
}
.object-picker-view-only .object-picker-results {
  max-height: min(56vh, 420px);
}
.object-picker-view-only .object-option {
  width: 100%;
}

`;
  document.head.append(style);
}

export {};
