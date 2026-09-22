if (!document.querySelector("style[data-burbot-workflow-tabs]")) {
  const style = document.createElement("style");
  style.dataset.burbotWorkflowTabs = "true";
  style.textContent = `
.workflow-tabs {
  position: sticky;
  top: 49px;
  z-index: 29;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  padding: 7px 10px;
  border-bottom: 1px solid #dfe6df;
  background: rgba(244, 246, 244, .97);
  backdrop-filter: blur(8px);
}
.workflow-tabs button {
  min-height: 34px;
  border: 1px solid #dbe4dc;
  border-radius: 8px;
  background: #f8faf8;
  color: #66756b;
  font-size: 11px;
  font-weight: 620;
}
.workflow-tabs button:hover {
  background: #f0f5f1;
  border-color: #c9d6cc;
}
.workflow-tabs button.active {
  border-color: #99b9a4;
  background: #eaf4ed;
  color: #28543b;
  box-shadow: inset 0 -2px #4e8766;
}
.workflow-panel[hidden] {
  display: none !important;
}
.import-toolbar,
.active-view-panel {
  margin: 7px 10px 5px;
  border: 1px solid #dfe6df;
  border-radius: 9px;
  background: #fff;
}
.import-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 9px;
}
.import-toolbar > div {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.import-toolbar strong {
  font-size: 11px;
}
.import-toolbar small {
  color: #78857c;
  font-size: 9px;
}
.import-toolbar .primary {
  flex: none;
  min-height: 29px;
  padding: 5px 10px;
  font-size: 9px;
}
.active-view-panel {
  padding: 8px 9px;
}
.active-view-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.active-view-panel-heading > div {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.active-view-panel-heading strong {
  font-size: 11px;
}
.active-view-panel-heading small {
  overflow: hidden;
  color: #77847b;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.active-view-mode-badge {
  flex: none;
  padding: 2px 6px;
  border-radius: 999px;
  background: #edf3ef;
  color: #56705f;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .5px;
}
.active-view-imports {
  display: grid;
  gap: 4px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid #e8ede9;
}
.active-view-imports-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.active-view-imports-heading strong {
  font-size: 10px;
}
.active-view-imports-heading small {
  color: #7d8981;
  font-size: 8px;
}
.active-view-import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  padding: 6px 7px;
  border: 1px solid #e2e8e3;
  border-radius: 7px;
  background: #fafcfb;
}
.active-view-import-row > div:first-child {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.active-view-import-row strong {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.active-view-import-row small {
  color: #7b8880;
  font-size: 8px;
}
.active-view-import-actions {
  flex: none;
  display: flex;
  gap: 4px;
}
.active-view-import-actions button {
  min-height: 25px;
  padding: 4px 6px;
  font-size: 8px;
}
.active-view-error {
  margin-top: 6px;
  color: #a33f3f;
  font-size: 9px;
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
.object-view-toggle {
  align-self: stretch;
  min-height: 40px;
  margin: 2px 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: #f7faf8;
  color: #376247;
  font-size: 15px;
  font-weight: 600;
}
.object-view-toggle:hover {
  border-color: #bfd0c3;
  background: #eaf3ed;
}
.active-object-view {
  flex-wrap: wrap;
}
.active-object-view-query {
  flex: 1 1 130px;
}
#import-review-empty,
.import-review-empty {
  margin: 10px;
  padding: 18px 12px;
  border: 1px dashed #d4ddd6;
  border-radius: 9px;
  color: #708078;
  text-align: center;
}
.import-review-empty strong {
  display: block;
  margin-bottom: 3px;
  color: #35483d;
  font-size: 11px;
}
.import-review-empty p {
  font-size: 9px;
}
.import-review-decision-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}
.import-review-decision-actions button {
  min-height: 31px;
  padding: 5px 9px;
  font-size: 9px;
}
.import-review-decision-actions .primary {
  flex: 1 1 180px;
}
.import-review-state-badge {
  align-self: center;
  margin-right: auto;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 750;
}
.import-review-state-badge.staged {
  background: #e7eef7;
  color: #365a79;
}
.import-review-state-badge.committed {
  background: #e5f2e9;
  color: #2f6b49;
}
.import-review-state-badge.rejected {
  background: #f7e8e8;
  color: #8c4a4a;
}
.import-review-list button.reviewed.status-in_view {
  background: #f1f7f3;
}
.import-review-list button.reviewed.status-staged {
  color: #51687b;
}
.import-review-list button.reviewed.status-committed {
  color: #356449;
  background: #eef6f1;
}
.import-review-list button.reviewed.status-rejected {
  opacity: .65;
  text-decoration: line-through;
}
.commit-object-actions {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 6px;
}
.commit-discard-object {
  color: #914e4e;
  font-size: 9px;
}
@media (max-width: 520px) {
  .active-view-import-row {
    align-items: stretch;
    flex-direction: column;
  }
  .active-view-import-actions {
    justify-content: flex-end;
  }
}
`;
  document.head.append(style);
}

export {};
