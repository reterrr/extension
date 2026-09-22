if (!document.querySelector("style[data-burbot-commit-panel]")) {
  const style = document.createElement("style");
  style.dataset.burbotCommitPanel = "true";
  style.textContent = `
.commit-panel {
  margin: 8px 12px 6px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  padding: 10px;
}
.commit-panel-idle {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 10px;
  align-items: center;
}
.commit-panel-idle strong,
.commit-panel-active strong {
  display: block;
  font-size: 12px;
}
.commit-panel-idle p,
.commit-hint,
.commit-header small {
  color: var(--muted);
  font-size: 10px;
}
.commit-primary {
  background: var(--green);
  color: #fff;
  white-space: nowrap;
}
.commit-primary:hover {
  background: #214f40;
}
.commit-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.commit-header small {
  display: block;
  margin-top: 2px;
}
.commit-eyebrow {
  display: block;
  color: var(--muted);
  font-size: 8px;
  letter-spacing: 1px;
  margin-bottom: 2px;
}
.commit-dirty,
.commit-clean,
.commit-status {
  border-radius: 999px;
  padding: 2px 6px;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .4px;
}
.commit-dirty {
  background: #fff2cf;
  color: #7a5a00;
}
.commit-clean {
  background: #edf4eb;
  color: #436349;
}
.commit-groups {
  display: grid;
  gap: 5px;
  margin-top: 8px;
}
.commit-group {
  border: 1px solid var(--line);
  border-radius: 7px;
  overflow: hidden;
}
.commit-group > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  list-style: none;
  padding: 7px 8px;
  font-size: 11px;
  font-weight: 650;
}
.commit-group > summary::-webkit-details-marker {
  display: none;
}
.commit-group > summary::before {
  content: "▸";
  margin-right: 6px;
  color: var(--muted);
}
.commit-group[open] > summary::before {
  content: "▾";
}
.commit-group > summary > span:first-child {
  margin-right: auto;
}
.commit-count {
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
}
.commit-group-body {
  padding: 0 7px 7px;
  border-top: 1px solid var(--line);
}
.commit-add-object {
  color: var(--green);
  font-size: 10px;
  padding-left: 0;
  margin: 3px 0;
}
.commit-empty {
  color: var(--muted);
  font-size: 10px;
  padding: 4px 1px;
}
.commit-object-list {
  display: grid;
  gap: 3px;
}
.commit-object-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  border: 1px solid transparent;
  background: #f8faf7;
  padding: 6px 7px;
}
.commit-object-row:hover {
  border-color: var(--line);
}
.commit-object-row.commit-object-deleted {
  opacity: .72;
  text-decoration: line-through;
}
.commit-object-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.commit-status-new {
  background: #dff1e7;
  color: #246043;
}
.commit-status-modified {
  background: #e7eef7;
  color: #315678;
}
.commit-status-deleted {
  background: #f7e4e4;
  color: #8b4141;
  text-decoration: none;
}
.commit-hint {
  margin-top: 7px;
}
.commit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.commit-discard {
  color: #8a4c4c;
}
.commit-error {
  grid-column: 1 / -1;
  margin-top: 7px;
  color: #a33f3f;
  font-size: 10px;
}
/* Compact staged-diff layout. */
.commit-panel {
  margin: 6px 10px 4px;
  padding: 8px;
}
.commit-header {
  align-items: center;
  padding-bottom: 6px;
  border-bottom: 0;
}
.commit-header strong {
  font-size: 11px;
}
.commit-header small {
  font-size: 9px;
}
.commit-create-actions {
  display: flex;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.commit-create-actions button {
  min-height: 25px;
  padding: 4px 7px;
  border: 1px solid #dce5de;
  border-radius: 6px;
  background: #f8faf8;
  color: #496457;
  font-size: 9px;
}
.commit-create-actions button:hover {
  background: #eef4f0;
}
.commit-staged {
  display: grid;
  gap: 4px;
  max-height: min(30vh, 240px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}
.commit-change-card {
  overflow: hidden;
  border: 1px solid #e1e7e2;
  border-radius: 7px;
  background: #fbfcfb;
}
.commit-change-card > summary {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 7px;
  list-style: none;
  cursor: pointer;
}
.commit-change-card > summary::-webkit-details-marker {
  display: none;
}
.commit-change-card[open] > summary {
  border-bottom: 1px solid #e5eae6;
  background: #f7faf8;
}
.commit-change-copy {
  min-width: 0;
  flex: 1;
}
.commit-change-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.commit-change-copy small {
  display: block;
  margin-top: 1px;
  color: var(--muted);
  font-size: 8px;
}
.commit-chevron {
  flex: none;
  color: #8b978f;
  font-size: 16px;
  line-height: 1;
  transition: transform .12s ease;
}
.commit-change-card[open] .commit-chevron {
  transform: rotate(90deg);
}
.commit-change-body {
  padding: 6px 7px 7px;
}
.commit-field-diff {
  display: grid;
}
.commit-field-change {
  display: grid;
  grid-template-columns: minmax(90px, .8fr) minmax(0, 1.6fr);
  gap: 8px;
  padding: 5px 2px;
}
.commit-field-change + .commit-field-change {
  border-top: 1px solid #edf1ee;
}
.commit-field-name {
  color: #6d7971;
  font-size: 8px;
  font-weight: 650;
}
.commit-field-values {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-wrap: anywhere;
  font-size: 9px;
}
.commit-value-before {
  color: #8a938d;
  text-decoration: line-through;
}
.commit-arrow {
  flex: none;
  color: #a0aaa3;
}
.commit-value-after {
  color: #285e43;
  font-weight: 650;
}
.commit-value-removed {
  color: #9a5050;
  font-weight: 650;
}
.commit-related-diff {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid #e9eeea;
}
.commit-related-change {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border: 1px solid #e0e7e1;
  border-radius: 999px;
  background: #fff;
  color: #647169;
  font-size: 8px;
}
.commit-related-counts {
  display: inline-flex;
  gap: 3px;
}
.commit-related-counts b {
  font-size: 8px;
}
.commit-related-counts .is-added {
  color: #2f7659;
}
.commit-related-counts .is-modified {
  color: #496a8a;
}
.commit-related-counts .is-removed {
  color: #a65050;
}
.commit-focus {
  margin-top: 6px;
  padding: 4px 0;
  color: var(--green);
  font-size: 9px;
}
.commit-delete-note,
.commit-empty {
  color: var(--muted);
  font-size: 9px;
}
.commit-delete-note {
  margin: 1px 0 5px;
}
.commit-empty {
  padding: 7px 2px;
}
.commit-actions {
  margin-top: 6px;
  padding-top: 6px;
}
.commit-actions button {
  min-height: 29px;
  padding: 5px 9px;
  font-size: 10px;
}
.commit-error {
  margin-top: 6px;
  font-size: 9px;
}

`;
  document.head.append(style);
}

export {};
