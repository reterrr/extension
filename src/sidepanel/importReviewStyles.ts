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
    grid-template-columns: minmax(150px, 38%) 1fr;
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
  .import-review-list button small {
    white-space: nowrap;
    color: #7b8b81;
  }
  .import-review-detail {
    padding: 14px;
    min-width: 0;
  }
  .import-review-object-title { margin-bottom: 10px; }
  .import-review-object-title h2 {
    margin: 2px 0 0;
    font-size: 17px;
    line-height: 1.25;
  }
  .import-review-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .import-review-fields {
    display: grid;
    gap: 6px;
  }
  .import-review-fields > div {
    position: relative;
    display: grid;
    gap: 2px;
    padding: 9px 10px;
    border: 1px solid #e6ebe6;
    border-radius: 8px;
    background: #fcfdfc;
  }
  .import-review-fields > div.has-evidence {
    border-left: 3px solid #7ca58b;
    padding-left: 8px;
  }
  .import-review-fields small { color: #78867c; }
  .import-review-fields strong {
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .import-review-fields span {
    position: absolute;
    top: 7px;
    right: 8px;
    color: #6d8a76;
    font-size: 10px;
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
  }
`;

document.head.append(style);

export {};
