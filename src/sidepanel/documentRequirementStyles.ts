if (!document.querySelector("style[data-burbot-document-requirements]")) {
  const style = document.createElement("style");
  style.dataset.burbotDocumentRequirements = "true";
  style.textContent = `
.document-requirements-block {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft, #e5ebe6);
}
.document-requirements-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.document-requirements-head-copy {
  display: grid;
  gap: 2px;
}
.document-requirements-head-copy strong {
  font-size: 12px;
}
.document-requirements-head-copy small,
.document-requirement-empty {
  color: var(--muted, #78857c);
  font-size: 11px;
}
.document-requirement-list {
  display: grid;
  gap: 6px;
}
.document-requirement-card {
  border: 1px solid #dfe7e1;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.document-requirement-card > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  cursor: pointer;
}
.document-requirement-card > summary > span {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.document-requirement-card > summary strong,
.document-requirement-card > summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-requirement-card > summary strong {
  font-size: 12px;
}
.document-requirement-card > summary small {
  color: #7b887f;
  font-size: 11px;
}
.document-requirement-body {
  display: grid;
  gap: 8px;
  padding: 9px;
  border-top: 1px solid #edf1ed;
  background: #fbfcfb;
}
.document-requirement-grid,
.document-requirement-delivery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.document-requirement-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.document-requirement-field > span,
.document-source-files > span {
  color: #3f4f46;
  font-size: 11px;
  font-weight: 650;
}
.document-requirement-field input,
.document-requirement-field select,
.document-requirement-field textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #d8e1da;
  border-radius: 7px;
  background: #fff;
  padding: 7px 8px;
  color: #26342d;
  font: inherit;
  font-size: 12px;
}
.document-requirement-field textarea {
  min-height: 68px;
  resize: vertical;
}
.document-requirement-field.wide {
  grid-column: 1 / -1;
}
.document-source-files {
  display: grid;
  gap: 5px;
  padding: 7px 8px;
  border: 1px solid #e3e9e4;
  border-radius: 7px;
  background: #fff;
}
.document-source-files label {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: #46564d;
  font-size: 11px;
}
.document-source-files input {
  margin-top: 1px;
}
.document-source-files small {
  color: #89958d;
  font-size: 11px;
}
.document-requirement-info {
  margin: 0;
  padding: 7px 8px;
  border: 1px solid #dfe7df;
  border-radius: 7px;
  background: #f3f7f4;
  color: #617168;
  font-size: 11px;
}
.document-requirement-save {
  justify-self: start;
}
@media (max-width: 520px) {
  .document-requirement-grid,
  .document-requirement-delivery {
    grid-template-columns: 1fr;
  }
}
`;
  document.head.append(style);
}

export {};
