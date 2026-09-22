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
`;
  document.head.append(style);
}

export {};
