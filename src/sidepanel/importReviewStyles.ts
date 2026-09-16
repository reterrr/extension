const style = document.createElement("style");
style.dataset.burbotImportReviewStyles = "true";
style.textContent = `
  .workspace-mode-tabs {
    display: flex;
    gap: 6px;
    padding: 8px 12px 0;
  }
  .workspace-mode-tabs button {
    flex: 1;
    border: 1px solid #dfe7df;
    background: #f7faf7;
    color: #526157;
    border-radius: 9px;
    padding: 8px 10px;
    font: inherit;
    cursor: pointer;
  }
  .workspace-mode-tabs button.active {
    background: #edf6ef;
    border-color: #9dbba7;
    color: #234b34;
    font-weight: 650;
  }
  .workspace-mode-tabs button span {
    display: inline-flex;
    min-width: 18px;
    justify-content: center;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 999px;
    background: #e5eee7;
    font-size: 11px;
  }
  .import-review-panel {
    margin: 8px 12px 12px;
    border: 1px solid #d7e0d8;
    border-radius: 12px;
    background: #fff;
    overflow: hidden;
  }
  .import-review-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 14px 10px;
  }
  .import-review-header > div {
    display: grid;
    gap: 2px;
  }
  .import-review-header strong { font-size: 15px; }
  .import-review-header small { color: #738077; }
  .import-review-progress {
    height: 3px;
    background: #edf1ed;
  }
  .import-review-progress span {
    display: block;
    height: 100%;
    background: #4e9369;
    transition: width .18s ease;
  }
  .import-review-layout {
    display: grid;
    grid-template-columns: minmax(150px, 34%) 1fr;
    min-height: 300px;
    border-top: 1px solid #edf1ed;
  }
  .import-review-list {
    padding: 10px;
    border-right: 1px solid #edf1ed;
    background: #fafcf9;
  }
  .import-review-list details + details { margin-top: 8px; }
  .import-review-list summary {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: #68756c;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
  }
  .import-review-list summary span {
    font-weight: 500;
    color: #8a958e;
  }
  .import-review-list button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: #314039;
    text-align: left;
    cursor: pointer;
  }
  .import-review-list button:hover { background: #f0f5f0; }
  .import-review-list button.selected {
    background: #eef6f0;
    border-color: #a9c3b1;
  }
  .import-review-list button.approved { color: #718078; }
  .import-review-list button > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .import-review-list button small {
    white-space: nowrap;
    color: #7b8b81;
    font-size: 9px;
  }
  .import-review-detail {
    padding: 14px;
    min-width: 0;
  }
  .import-review-object-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .import-review-object-title h2 {
    margin: 2px 0 0;
    font-size: 17px;
    line-height: 1.25;
  }
  .import-review-edit-badge {
    flex: 0 0 auto;
    border: 1px solid #b8ccb8;
    border-radius: 999px;
    background: #f1f8f2;
    color: #41634c;
    padding: 3px 7px;
    font-size: 9px;
    font-weight: 700;
  }
  .import-review-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .import-review-section {
    display: grid;
    gap: 8px;
    margin-top: 14px;
  }
  .import-review-section + .import-review-section {
    padding-top: 14px;
    border-top: 1px solid #edf1ed;
  }
  .import-review-section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
  }
  .import-review-section-heading > div {
    display: grid;
    gap: 1px;
  }
  .import-review-section-heading strong {
    font-size: 13px;
  }
  .import-review-section-heading > small {
    max-width: 48%;
    color: #849088;
    font-size: 9px;
    text-align: right;
  }
  .import-review-fields {
    display: grid;
    gap: 6px;
  }
  .import-review-fields > div {
    position: relative;
    display: grid;
    gap: 3px;
    padding: 0;
    border: 1px solid #e6ebe6;
    border-radius: 8px;
    background: #fcfdfc;
    overflow: hidden;
    transition: border-color .12s ease, box-shadow .12s ease, background .12s ease;
  }
  .import-review-fields > div.has-evidence {
    border-left: 3px solid #7ca58b;
  }
  .import-review-fields > div.capture-selected,
  .import-review-finance-field.capture-selected {
    border-color: #7fa68b;
    background: #f1f7f2;
    box-shadow: 0 0 0 2px #7fa68b1f;
  }
  .import-review-field-select {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .import-review-field-select:hover:not(:disabled) {
    background: #f4f8f4;
  }
  .import-review-field-select:disabled {
    cursor: default;
    opacity: .75;
  }
  .import-review-field-select .field-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .import-review-field-select .field-label {
    color: #78867c;
    font-size: 10px;
  }
  .import-review-field-select .field-value {
    color: #26342d;
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .import-review-field-select .field-value.empty {
    color: #97a198;
    font-weight: 500;
  }
  .import-review-field-select .field-mark {
    flex: 0 0 auto;
    color: #6f9279;
    font-size: 10px;
    font-weight: 700;
  }
  .import-review-editor {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid #d8e1da;
    border-radius: 7px;
    background: #fff;
    color: #26342d;
    padding: 7px 8px;
    font: inherit;
    font-size: 12px;
    line-height: 1.25;
    outline: none;
  }
  .import-review-editor:focus {
    border-color: #7ea08a;
    box-shadow: 0 0 0 2px #7ea08a1f;
  }
  .import-review-editor:disabled {
    background: #f5f7f5;
    color: #6f7d73;
    cursor: default;
  }
  .import-review-field-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 0 10px 6px;
  }
  .import-review-field-meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    color: #7d8981;
    font-size: 9px;
    white-space: nowrap;
  }
  .import-review-source-button {
    border: 0;
    background: transparent;
    padding: 2px 0;
    font: inherit;
    font-size: 10px;
    font-weight: 650;
    cursor: pointer;
    white-space: nowrap;
    opacity: .88;
  }
  .import-review-source-button:hover {
    text-decoration: underline;
    opacity: 1;
  }
  .import-review-files,
  .import-review-financing {
    display: grid;
    gap: 7px;
  }
  .import-review-file-card,
  .import-review-finance-card {
    border: 1px solid #e1e8e2;
    border-radius: 9px;
    background: #fafcfa;
  }
  .import-review-file-card {
    display: grid;
    gap: 6px;
    padding: 9px;
  }
  .import-review-file-card a {
    color: #607369;
    font-size: 9px;
    overflow-wrap: anywhere;
  }
  .import-review-card-actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .import-review-finance-card > summary {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 10px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
  }
  .import-review-finance-card > summary small {
    color: #859188;
    font-size: 9px;
    font-weight: 500;
  }
  .import-review-finance-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    padding: 0 9px 9px;
  }
  .import-review-finance-field {
    min-width: 0;
    display: grid;
    gap: 3px;
    padding: 8px;
    border: 1px solid #e1e8e2;
    border-radius: 7px;
    background: #fff;
    color: #26342d;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .import-review-finance-field:hover:not(:disabled) {
    background: #f3f7f3;
  }
  .import-review-finance-field:disabled {
    cursor: default;
    opacity: .72;
  }
  .import-review-finance-field small {
    color: #7a887f;
    font-size: 9px;
  }
  .import-review-finance-field strong {
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .import-review-remove-finance {
    margin: 0 9px 9px;
  }
  .text-button.danger {
    color: #9d4b4b;
  }
  .import-review-capture {
    z-index: 5;
    margin: 14px -14px 0;
    border-top-color: #a9c6af;
    border-bottom: 1px solid #dce7de;
    background: #fff;
  }
  .import-review-capture .capture-heading-actions {
    display: flex;
    align-items: center;
  }
  .import-review-capture-source {
    margin-bottom: 7px;
  }
  .import-review-capture .source-sample {
    max-height: 72px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .import-review-capture .hint {
    min-height: 14px;
    margin: 5px 0 8px;
  }
  .import-review-capture-save {
    width: 100%;
  }
  .import-review-capture-details {
    margin-top: 8px;
  }
  .import-review-capture-details summary {
    color: #728077;
    font-size: 10px;
    cursor: pointer;
  }
  .import-review-capture-details pre {
    max-height: 160px;
    overflow: auto;
    padding: 8px;
    border-radius: 6px;
    background: #f6f8f6;
    color: #4d5d53;
    font-size: 9px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .import-review-hint {
    margin: 12px 0;
    color: #748178;
    font-size: 11px;
  }
  .import-review-approve { width: 100%; }
  .import-review-mode .commit-panel,
  .import-review-mode .connection-bar,
  .import-review-mode main,
  .import-review-mode #notice,
  .import-review-mode #capture-hint,
  .import-review-mode #capture-area {
    display: none !important;
  }
  @media (max-width: 520px) {
    .import-review-layout { grid-template-columns: 1fr; }
    .import-review-list { border-right: 0; border-bottom: 1px solid #edf1ed; }
    .import-review-finance-fields { grid-template-columns: 1fr; }
    .import-review-section-heading { align-items: flex-start; }
    .import-review-section-heading > small { max-width: 55%; }
  }
`;

document.head.append(style);

export {};
