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
  padding: 8px 9px;
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
`;
  document.head.append(style);
}

export {};
