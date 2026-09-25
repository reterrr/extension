if (!document.querySelector("style[data-burbot-file-sources]")) {
  const style = document.createElement("style");
  style.dataset.burbotFileSources = "true";
  style.textContent = `
.file-source-list {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}
.file-source-empty {
  color: var(--muted);
  font-size: 11px;
  padding: 6px 2px;
}
.file-source-row {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  padding: 0;
  overflow: hidden;
}
.file-source-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  cursor: pointer;
  list-style: none;
}
.file-source-summary::-webkit-details-marker {
  display: none;
}
.file-source-summary::before {
  content: "›";
  flex: none;
  margin-top: 1px;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform .12s ease;
}
.file-source-row[open] > .file-source-summary::before {
  transform: rotate(90deg);
}
.file-source-summary-copy {
  min-width: 0;
  flex: 1;
}
.file-source-classification-status {
  flex: none;
  padding: 3px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
.file-source-classification-status.complete {
  background: #eaf4ee;
  color: #2f7659;
}
.file-source-classification-status.pending {
  background: #fff4df;
  color: #9a5d00;
}
.file-source-quick-remove {
  flex: none;
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  border-radius: 5px;
  opacity: .72;
}
.file-source-quick-remove:hover,
.file-source-quick-remove:focus-visible {
  opacity: 1;
  background: #fff0f0;
}
.file-source-body {
  padding: 0 9px 9px;
  border-top: 1px solid var(--line);
}
.file-source-url {
  padding-top: 7px;
}
.file-source-classification {
  display: grid;
  gap: 7px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #f8faf8;
}
.file-source-field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 7px;
}
.file-source-field {
  display: grid;
  gap: 3px;
}
.file-source-field > span {
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .02em;
}
.file-source-field input,
.file-source-field textarea,
.file-source-field select {
  width: 100%;
  box-sizing: border-box;
  min-height: 32px;
  padding: 6px 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: inherit;
  font: inherit;
}
.file-source-field textarea {
  min-height: 54px;
  resize: vertical;
}
.file-source-save {
  justify-self: start;
  margin-top: 2px;
}
.file-source-row strong,
.file-source-row small {
  display: block;
}
.file-source-row strong {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.file-source-row small {
  margin-top: 2px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.file-source-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid var(--line);
}
.file-source-actions .text-button {
  padding-left: 0;
  padding-right: 0;
}
.file-source-actions a {
  color: var(--green);
  font-size: 10px;
  text-decoration: none;
}
.file-source-actions a:hover {
  text-decoration: underline;
}
.file-source-actions .danger {
  margin-left: auto;
}
.file-source-toolbar {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
}
.file-source-mode-hint {
  color: var(--green);
  font-size: 10px;
  margin-top: 5px;
}
#read-from-file[data-active="true"] {
  background: #eaf2e7;
  box-shadow: inset 0 0 0 1px #bfd4bb;
}
@media (max-width: 430px) {
  .file-source-field-row {
    grid-template-columns: 1fr;
  }
}
`;
  document.head.append(style);
}

export {};
