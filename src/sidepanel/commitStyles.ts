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
`;
  document.head.append(style);
}

export {};
