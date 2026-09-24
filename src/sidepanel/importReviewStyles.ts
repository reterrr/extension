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
    gap: 5px;
    padding: 9px 10px;
    border: 1px solid #e6ebe6;
    border-radius: 8px;
    background: #fcfdfc;
  }
  .import-review-fields > div.has-evidence {
    border-left: 3px solid #7ca58b;
    padding-left: 8px;
  }
  .import-review-field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .import-review-field-head small { color: #78867c; }
  .import-review-field-head span {
    font-size: 9px;
    font-weight: 700;
    white-space: nowrap;
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
  .import-review-file-metadata {
    display: grid;
    gap: 5px;
    padding: 7px 0;
    border-top: 1px solid #e7ece8;
    border-bottom: 1px solid #e7ece8;
  }
  .import-review-file-metadata > span {
    display: grid;
    gap: 1px;
  }
  .import-review-file-metadata small {
    color: #829087;
    font-size: 8px;
    font-weight: 650;
  }
  .import-review-file-metadata strong {
    color: #31443a;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.3;
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
  .import-review-finance-fields label {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .import-review-finance-fields label > small {
    color: #7a887f;
    font-size: 9px;
  }
  .import-review-remove-finance {
    margin: 0 9px 9px;
  }
  .text-button.danger {
    color: #9d4b4b;
  }
  .import-review-hint {
    margin: 12px 0;
    color: #748178;
    font-size: 11px;
  }
  .import-review-update-existing {
    display: grid;
    gap: 2px;
    margin: 10px 0;
    padding: 9px 10px;
    border: 1px solid #bad4c2;
    border-radius: 9px;
    background: #eef7f1;
    color: #365743;
  }
  .import-review-update-existing strong {
    font-size: 11px;
  }
  .import-review-update-existing span {
    color: #253a2e;
    font-size: 12px;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .import-review-update-existing small {
    color: #65776c;
    font-size: 9px;
    line-height: 1.35;
  }
  .import-review-approve { width: 100%; }
  .import-review-mode .commit-panel,
  .import-review-mode .connection-bar,
  .import-review-mode #workspace-main,
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
