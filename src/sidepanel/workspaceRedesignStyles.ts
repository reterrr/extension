if (!document.querySelector("style[data-burbot-workspace-redesign]")) {
  const style = document.createElement("style");
  style.dataset.burbotWorkspaceRedesign = "true";
  style.textContent = `
:root {
  --surface: #ffffff;
  --surface-soft: #f6f8f5;
  --surface-warm: #fff9ef;
  --text: #213229;
  --text-soft: #69786f;
  --border: #dfe6df;
  --border-strong: #ced9d0;
  --field-surface: #fbfcfb;
  --field-border: #d5ded6;
  --field-hover: #f0f4f1;
  --success: #2f7659;
  --success-soft: #eaf4ee;
  --warning: #a76100;
  --warning-soft: #fff4df;
  --danger: #b44747;
  --danger-soft: #fff0f0;
  --shadow-soft: 0 2px 10px rgba(36, 58, 45, .045);
}

body {
  background: #f4f6f4;
  color: var(--text);
}

.brandbar {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 12px 14px;
  border-bottom-color: var(--border);
  box-shadow: 0 1px 6px rgba(31, 49, 39, .035);
}

.connection-bar {
  padding: 7px 12px;
  background: rgba(244, 246, 244, .96);
  border-bottom: 1px solid var(--border);
}

main {
  padding: 0 12px 10px;
}

.object-header {
  margin: 10px 0 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.object-header h1 {
  margin: 5px 0 8px;
  font-size: 20px;
}


#switcher {
  position: relative;
}


.active-object-view {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 8px;
  padding: 6px 7px;
  border: 1px solid #b9d0c0;
  border-radius: 8px;
  background: #eef6f1;
}

.active-object-view[hidden] {
  display: none;
}

.active-object-view-badge {
  flex: none;
  padding: 2px 5px;
  border-radius: 5px;
  background: #dceee3;
  color: var(--success);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .7px;
}

.active-object-view-count {
  flex: none;
  color: #315945;
  font-size: 10px;
  font-weight: 700;
}

.active-object-view-query {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #6f7d74;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-object-view > button {
  flex: none;
  min-height: 24px;
  padding: 3px 6px;
  font-size: 9px;
}

.object-picker-view-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e3e9e4;
}

.object-picker-view-info {
  min-width: 0;
  flex: 1;
  color: #76827a;
  font-size: 9px;
}

.object-picker-set-view,
.object-picker-clear-view {
  flex: none;
  min-height: 29px;
  padding: 5px 8px;
  border: 1px solid #bfd1c4;
  border-radius: 7px;
  background: #edf5f0;
  color: #315e47;
  font-size: 9px;
  font-weight: 700;
}

.object-picker-set-view:hover,
.object-picker-clear-view:hover {
  background: #e4f0e8;
}

.object-picker-set-view:disabled {
  border-color: #e0e5e1;
  background: #f5f6f5;
  color: #9aa39d;
}

.object-picker-clear-view {
  border-color: #d8ded9;
  background: #fff;
  color: #6d7971;
}

#switcher > summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 6px 9px;
  border: 1px solid #d9e2db;
  border-radius: 7px;
  background: #f5f8f5;
  color: #53665a;
}

#switcher[open] > summary {
  background: #eaf2ed;
  border-color: #b9cec0;
  color: var(--green);
}

#switcher > .popover {
  width: min(430px, calc(100vw - 32px));
  max-height: none;
  padding: 0;
  overflow: hidden;
  border-color: #cad7cd;
  box-shadow: 0 14px 38px rgba(29, 52, 38, .16);
}

.object-picker {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}

.object-picker-toolbar {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  background: #fbfcfb;
}

.object-picker-search {
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid #cbd7cd;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
}

.object-picker-search::placeholder {
  color: #8b968f;
}


.object-picker-search.is-invalid {
  border-color: #d8a1a1;
  background: #fff8f8;
}

.object-picker-search-feedback {
  min-height: 18px;
  margin-top: 5px;
  padding: 0 2px;
}

.object-picker-search-hint {
  color: #87928b;
  font-size: 8px;
  line-height: 1.35;
}

.object-picker-search-error {
  color: var(--danger);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.35;
}

.object-picker-filters {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.object-picker-filters::-webkit-scrollbar {
  display: none;
}

.object-picker-filter {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid #dce4de;
  border-radius: 999px;
  background: #fff;
  color: #69776e;
  font-size: 10px;
}

.object-picker-filter:hover {
  background: #f1f5f2;
  border-color: #c7d3ca;
}

.object-picker-filter[aria-pressed="true"] {
  background: #e8f2ec;
  border-color: #a9c6b3;
  color: var(--green);
  font-weight: 700;
}

.object-picker-results {
  max-height: min(54vh, 430px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
}

.object-picker-group + .object-picker-group {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid #edf1ee;
}

.object-picker-group .switch-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  padding: 5px 7px 4px;
  color: #7a877f;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .9px;
  text-transform: uppercase;
}

.object-picker-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #eef2ef;
  color: #7c8880;
  text-align: center;
  font-size: 8px;
  letter-spacing: 0;
}

#object-options .object-option {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 2px 0;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}

#object-options .object-option:hover,
#object-options .object-option:focus-visible {
  background: #f3f7f4;
  border-color: #d5dfd7;
}

#object-options .object-option[aria-current="true"] {
  background: #eaf4ee;
  border-color: #b6cfbf;
  box-shadow: inset 3px 0 var(--success);
}

.object-option-copy {
  min-width: 0;
  flex: 1;
}

.object-option-name {
  display: block;
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.object-option-meta {
  display: block;
  margin-top: 2px;
  color: #7b8880;
  font-size: 9px;
  line-height: 1.25;
}

.object-option-current {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: #dceee3;
  color: var(--success);
  font-size: 10px;
  font-weight: 800;
}


.reference-object-picker {
  overflow: hidden;
  border: 1px solid #cbd7cd;
  border-radius: 9px;
  background: #fff;
}

.reference-object-picker-selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border-bottom: 1px solid #dfe8e1;
  background: #edf6f0;
  box-shadow: inset 3px 0 var(--success);
}

.reference-object-picker-selected[hidden] {
  display: none;
}

.reference-object-picker-selected-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.reference-object-picker-selected-copy > strong {
  overflow: hidden;
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-object-picker-selected-label {
  color: var(--success);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .7px;
  text-transform: uppercase;
}

.reference-object-picker-clear {
  flex: none;
  min-height: 26px;
  padding: 4px 7px;
  font-size: 9px;
}

.reference-object-picker-search {
  width: calc(100% - 16px);
  margin: 8px 8px 0;
}

.reference-object-picker .object-picker-search-feedback {
  margin: 4px 8px 0;
}

.reference-object-picker-results {
  max-height: min(38vh, 320px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 6px 6px;
  border-top: 1px solid #eef2ef;
}

.reference-object-picker .object-option {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 2px 0;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}

.reference-object-picker .object-option:hover,
.reference-object-picker .object-option:focus-visible {
  background: #f3f7f4;
  border-color: #d5dfd7;
}

.reference-object-picker .object-option[aria-selected="true"] {
  background: #eaf4ee;
  border-color: #b6cfbf;
  box-shadow: inset 3px 0 var(--success);
}

.reference-object-picker-empty {
  padding: 14px 10px;
  color: #859087;
  font-size: 10px;
  text-align: center;
}

.reference-object-picker-footer {
  padding: 6px 9px;
  border-top: 1px solid #e9eeea;
  background: #f8faf8;
  color: #7b877f;
  font-size: 9px;
}

.object-picker-empty {
  display: grid;
  gap: 3px;
  padding: 24px 14px;
  text-align: center;
  color: #68776e;
}

.object-picker-empty strong {
  font-size: 12px;
}

.object-picker-empty small {
  color: #8b968f;
  font-size: 10px;
}

.progress-label {
  margin-top: 10px;
  font-size: 10px;
}

progress {
  height: 4px;
}

.business-section {
  padding: 0;
  margin: 8px 0;
  border: 0;
}

.workspace-section-card,
#documents-panel {
  display: block;
  margin: 8px 0;
  overflow: clip;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.workspace-section-summary,
#documents-panel > .section-summary {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  list-style: none;
  background: var(--surface);
}

.workspace-section-summary::-webkit-details-marker,
#documents-panel > .section-summary::-webkit-details-marker {
  display: none;
}

.workspace-section-summary::before,
#documents-panel > .section-summary::before {
  content: "›";
  flex: none;
  color: #8a978f;
  font-size: 20px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform .14s ease;
}

.workspace-section-card[open] > .workspace-section-summary::before,
#documents-panel[open] > .section-summary::before {
  transform: rotate(90deg);
}

.workspace-section-title,
#documents-panel > .section-summary > span:first-child {
  min-width: 0;
  flex: 1;
}

.workspace-section-title strong,
#documents-panel > .section-summary strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.workspace-section-title small,
#documents-panel > .section-summary small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  font-weight: 400;
  color: var(--text-soft);
}

.workspace-section-status,
#document-count {
  flex: none;
  max-width: 42%;
  text-align: right;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.25;
  color: var(--text-soft);
}

.workspace-section-status[data-state="complete"],
#document-count[data-state="complete"] {
  color: var(--success);
}

.workspace-section-status[data-state="missing"],
#document-count[data-state="missing"] {
  color: var(--warning);
}

.workspace-section-body {
  padding: 4px 9px 10px;
  border-top: 1px solid var(--border);
}

.field-group-card .workspace-section-body {
  padding: 4px 7px 8px;
}

.field-row {
  min-height: 48px;
  margin: 4px 0;
  padding: 8px 9px;
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--field-surface);
  box-shadow: 0 1px 2px rgba(32, 53, 40, .035);
}

.field-row:hover {
  background: var(--field-hover);
  border-color: #bccbc0;
  box-shadow: 0 1px 3px rgba(32, 53, 40, .07);
}

.field-row.selected {
  background: var(--success-soft);
  border-color: #a9c9b4;
  box-shadow:
    inset 4px 0 var(--success),
    0 0 0 1px rgba(47, 118, 89, .08);
}

.field-row.is-missing:not(.selected) {
  background: #fffaf1;
  border-color: #ead8ba;
}

.field-row.system-field,
.field-row.system-field:hover {
  cursor: default;
  background: #f3f6f4;
  border-color: #dce4de;
  box-shadow: none;
}

.field-row.system-field .field-label {
  color: #7d8881;
}

.field-row.system-field .field-mark {
  color: #87948b;
  font-size: 8px;
  letter-spacing: .5px;
}

.field-label {
  font-size: 10px;
  color: var(--text-soft);
}

.field-value {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 520;
  color: var(--text);
}

.field-value.empty {
  color: var(--warning);
  font-size: 12px;
  font-weight: 560;
}

.field-value.neutral-answer {
  color: #6c746f;
  font-weight: 500;
}

.field-mark {
  min-width: 30px;
  text-align: right;
  font-size: 9px;
  font-weight: 700;
}

.field-state-missing {
  color: var(--warning);
}

.field-state-set {
  color: var(--success);
}


.field-evidence-editor {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid #dbe5dd;
  border-radius: 9px;
  background: #fbfcfb;
}

.field-evidence-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border-bottom: 1px solid #e5ebe6;
  background: #f6f9f7;
}

.field-evidence-header > div {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.field-evidence-header strong {
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
}

.field-evidence-header small {
  color: var(--text-soft);
  font-size: 9px;
}

.field-evidence-count {
  flex: none;
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #e4efe8;
  color: var(--success);
  font-size: 9px;
  font-weight: 800;
  text-align: center;
}

.field-evidence-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 9px;
}

.field-evidence-action {
  min-height: 28px;
  padding: 5px 7px;
  border: 1px solid #d6e0d8;
  border-radius: 7px;
  background: #fff;
  font-size: 9px;
}

.field-evidence-preview {
  display: grid;
  gap: 6px;
  margin: 0 9px 8px;
  padding: 8px;
  border: 1px solid #b9d1c1;
  border-radius: 8px;
  background: #eef6f1;
}

.field-evidence-preview > label {
  color: #617269;
  font-size: 9px;
  font-weight: 650;
}

.field-evidence-method {
  min-height: 30px;
  padding: 5px 7px;
}

.field-evidence-sample {
  max-height: 110px;
  overflow: auto;
  padding: 7px;
  border: 1px solid #d8e4db;
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  font-size: 10px;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.field-evidence-source {
  display: block;
  overflow: hidden;
  color: #7b8880;
  font-size: 8px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-evidence-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
}

.field-evidence-save {
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid #91b49d;
  border-radius: 7px;
  background: var(--success);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}

.field-evidence-list {
  border-top: 1px solid #e8ede9;
}

.field-evidence-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
}

.field-evidence-row + .field-evidence-row {
  border-top: 1px solid #edf1ee;
}

.field-evidence-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}

.field-evidence-copy > strong {
  color: var(--success);
  font-size: 9px;
  font-weight: 750;
}

.field-evidence-raw {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text);
  font-size: 10px;
  line-height: 1.3;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.field-evidence-row > button {
  flex: none;
  min-height: 24px;
  padding: 3px 6px;
  font-size: 8px;
}

.field-evidence-empty {
  padding: 8px 9px;
  color: #88938c;
  font-size: 9px;
}

#file-sources-section .workspace-section-body,
#geography-section .workspace-section-body,
#funding-section .workspace-section-body,
#documents-section .workspace-section-body {
  padding: 10px 12px 12px;
}

.file-source-row,
.geography-row {
  border: 1px solid var(--border) !important;
  border-radius: 9px !important;
  background: #fbfcfb !important;
  box-shadow: none !important;
}

.file-source-row + .file-source-row,
.geography-row + .geography-row {
  margin-top: 6px;
}

.file-source-empty,
.geography-empty {
  color: var(--text-soft);
  font-size: 11px;
  padding: 3px 1px;
}

.file-source-toolbar,
.geography-add {
  margin-top: 8px;
}

.funding-tabs {
  display: flex;
  gap: 2px;
  margin: -2px 0 10px;
  padding: 0 2px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  scrollbar-width: none;
}

.funding-tabs::-webkit-scrollbar {
  display: none;
}

.funding-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 9px 7px;
  border-radius: 6px 6px 0 0;
  border-bottom: 2px solid transparent;
  color: #758078;
  font-size: 11px;
  white-space: nowrap;
}

.funding-tab:hover {
  background: #f3f6f3;
}

.funding-tab[aria-selected="true"] {
  color: var(--green);
  background: #f4f8f5;
  border-bottom-color: var(--green);
  font-weight: 700;
}

.funding-tab-state {
  min-width: 15px;
  height: 15px;
  display: inline-grid;
  place-items: center;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 8px;
  line-height: 1;
  background: #eef1ee;
  color: #7d8780;
}

.funding-tab-state[data-state="missing"] {
  background: var(--warning-soft);
  color: var(--warning);
}

.funding-tab-state[data-state="complete"] {
  background: var(--success-soft);
  color: var(--success);
}

.funding-tab-panel {
  padding: 0;
}

.funding-tab-panel > .size-heading {
  display: none;
}

.variant {
  margin: 7px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fcfdfc;
}

.variant > summary {
  padding: 9px 10px;
  border-radius: 0;
  background: #fafcfa;
}

.variant[open] > summary {
  border-bottom: 1px solid var(--border);
}

.funding-field-group {
  margin: 9px 7px 0;
  overflow: hidden;
  border: 1px solid #e2e8e3;
  border-radius: 9px;
  background: #fbfcfb;
}

.funding-field-group + .funding-field-group {
  margin-top: 8px;
}

.funding-field-group-heading {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border-bottom: 1px solid #e5ebe6;
  background: #f5f8f6;
}

.funding-field-group-heading-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.funding-field-group-heading strong {
  color: #415148;
  font-size: 10px;
  font-weight: 760;
  letter-spacing: .1px;
}

.funding-field-group-heading small {
  color: #859087;
  font-size: 8px;
}

.funding-field-group-unit {
  flex: none;
  min-width: 27px;
  padding: 3px 6px;
  border: 1px solid #d3dfd6;
  border-radius: 999px;
  background: #fff;
  color: #52705d;
  font-size: 8px;
  font-weight: 800;
  text-align: center;
  letter-spacing: .2px;
}

.funding-field-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 5px;
}

.variant .funding-field-grid .field-row {
  width: 100%;
  margin: 0;
}

.variant .funding-field-grid .field-row.is-missing:not(.selected) {
  background: #fffdf8;
}

.variant .funding-field-grid .field-label {
  font-size: 9px;
}

.variant .funding-field-grid .field-value {
  font-size: 12px;
}

@media (min-width: 720px) {
  .funding-field-group[data-group="Refundacja (%)"] .funding-field-grid,
  .funding-field-group[data-group="Limity kwotowe (PLN)"] .funding-field-grid,
  .funding-field-group[data-group="Wkład własny"] .funding-field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .funding-field-group[data-group="Uwagi"] .field-row {
    grid-column: 1 / -1;
  }
}

.variant .field-row,
.document .field-row {
  width: calc(100% - 8px);
  margin-left: 4px;
  margin-right: 4px;
}

.variant > .text-button {
  margin: 2px 7px 8px;
}

.document-group {
  margin-top: 10px;
}

.document-group > h3 {
  padding: 0 4px 4px;
  color: var(--text-soft);
}

.document {
  overflow: hidden;
  border-top: 1px solid #edf0ed;
}

.document:first-of-type {
  border-top: 0;
}

.document summary {
  padding: 9px 7px;
}

.document[open] > summary {
  margin-bottom: 4px;
  border-bottom: 1px solid #dfe6df;
  background: #f7f9f7;
}

.document[open] {
  padding-bottom: 4px;
}

.review-section {
  margin: 10px 0 4px;
  padding: 8px 2px;
  border-top: 0;
}

.capture-hint {
  margin: 8px 12px 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 9px;
  background: #fafcfa;
}

.capture-area {
  position: sticky;
  z-index: 25;
  bottom: 8px;
  margin: 8px 12px 12px;
  padding: 12px;
  max-height: min(64vh, 520px);
  overflow: auto;
  border: 1px solid #b9d1c3;
  border-radius: 12px;
  background: rgba(255, 255, 255, .985);
  box-shadow: 0 10px 32px rgba(28, 48, 37, .13);
}

.capture-heading {
  gap: 8px;
}

.capture-heading-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.capture-heading strong {
  font-size: 14px;
}

#capture-collapse {
  font-size: 14px;
  color: var(--text-soft);
}

.capture-area.is-collapsed {
  padding: 9px 11px;
  max-height: none;
  overflow: hidden;
}

.capture-area.is-collapsed > :not(.capture-heading) {
  display: none !important;
}

.capture-tools {
  margin: 10px 0 8px;
  gap: 6px;
}

.capture-tools button {
  padding: 7px 9px;
  border: 1px solid #dbe5dd;
  background: #f3f7f4;
  color: #365d48;
  font-size: 10px;
}

.capture-tools button:hover {
  background: #eaf2ed;
}

#value-control input,
#value-control select,
#value-control textarea {
  min-height: 38px;
  border-radius: 8px;
  border-color: var(--border-strong);
}

#save.primary {
  margin-top: 7px;
  min-height: 38px;
  border-radius: 8px;
  font-weight: 700;
}

.commit-panel {
  border-color: var(--border) !important;
  border-radius: 11px !important;
  box-shadow: var(--shadow-soft);
}

.commit-group {
  border-color: var(--border) !important;
}

.commit-object-row {
  border-radius: 7px;
}

@media (max-width: 340px) {
  .workspace-section-summary,
  #documents-panel > .section-summary {
    align-items: flex-start;
  }

  .workspace-section-status,
  #document-count {
    max-width: 46%;
  }

  .capture-area {
    margin-left: 8px;
    margin-right: 8px;
  }
}
`;
  document.head.append(style);
}

export {};
