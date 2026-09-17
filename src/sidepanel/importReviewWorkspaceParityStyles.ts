const style = document.createElement("style");
style.dataset.burbotImportWorkspaceParity = "true";
style.textContent = `
  /* Import Review is a staging workspace, so keep its visual hierarchy aligned
     with the normal Workspace instead of presenting imported data as a table. */
  .import-review-panel {
    margin: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: visible;
  }

  .import-review-header {
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--line);
  }

  .import-review-layout {
    display: block;
    min-height: 0;
    border-top: 0;
  }

  .import-review-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 8px 16px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    background: #fff;
  }

  .import-review-list details {
    flex: none;
    margin: 0 !important;
  }

  .import-review-list summary {
    padding: 5px 7px;
    border-radius: 5px;
    color: #65776a;
    font-size: 10px;
    letter-spacing: .8px;
  }

  .import-review-list details[open] summary {
    background: #f5f8f4;
  }

  .import-review-list button {
    width: auto;
    min-width: 150px;
    max-width: 230px;
    margin-top: 4px;
    padding: 7px 9px;
    border-radius: 6px;
  }

  .import-review-list button.selected {
    background: #eaf2e7;
    border-color: transparent;
    box-shadow: inset 3px 0 var(--green);
  }

  .import-review-detail {
    padding: 0 16px 18px;
  }

  .import-review-object-title {
    padding: 14px 0 16px;
    margin: 0;
  }

  .import-review-object-title h2 {
    margin: 5px 0 0;
    font-size: 22px;
  }

  .import-review-sources {
    margin: -8px 0 10px;
  }

  .import-review-section {
    padding: 13px 0;
    margin: 0;
    border-top: 1px solid var(--line);
  }

  .import-review-section-heading {
    margin-bottom: 5px;
  }

  .import-review-section-heading > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .import-review-section-heading > div > strong {
    font-size: 10px;
    color: var(--muted);
    font-weight: 500;
  }

  .import-review-section-heading > small {
    display: none;
  }

  .import-review-fields {
    display: block;
  }

  .import-review-fields > div.import-review-workspace-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 53px;
    margin: 1px 0;
    padding: 9px 10px;
    border: 0 !important;
    border-radius: 6px;
    background: transparent !important;
    box-shadow: none !important;
    text-align: left;
  }

  .import-review-fields > div.import-review-workspace-field:hover {
    background: #f7faf6 !important;
  }

  .import-review-fields > div.import-review-workspace-field.selected {
    background: #eaf2e7 !important;
    box-shadow: inset 3px 0 var(--green) !important;
    outline: 0 !important;
  }

  .import-review-field-head {
    min-width: 0;
    flex: 1;
    display: block;
  }

  .import-review-field-head small:first-child {
    display: block;
    font-size: 11px;
    color: #718074;
  }

  .import-review-workspace-field.selected .import-review-field-head small:first-child {
    color: var(--green);
  }

  .import-review-field-head > span {
    float: right;
    margin-left: 8px;
    font-size: 9px;
  }

  .import-review-workspace-value {
    min-width: 0;
    flex: 1;
    margin: 0;
    font-size: 13px;
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .import-review-workspace-value:empty,
  .import-review-workspace-value:is(:not(:empty))[data-empty="true"] {
    color: #9aa49a;
    font-size: 12px;
  }

  .import-review-field-meta {
    flex: none;
    margin: 0;
  }

  .import-review-field-meta > span {
    display: none;
  }

  .import-review-source-button {
    font-size: 10px;
  }

  .import-review-files,
  .import-review-financing {
    margin-top: 6px;
  }

  .import-review-file-card,
  .import-review-finance-card {
    border-color: var(--line);
    border-radius: 7px;
    background: #fafcfa;
  }

  .import-review-finance-fields > label.import-review-workspace-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 46px;
    padding: 8px 10px 8px 12px;
    border-radius: 6px;
    cursor: pointer;
  }

  .import-review-finance-fields > label.import-review-workspace-field:hover {
    background: #f3f7f2;
  }

  .import-review-finance-fields > label.import-review-workspace-field.selected {
    background: #eaf2e7;
    box-shadow: inset 3px 0 var(--green);
    outline: 0;
  }

  .import-review-capture-area {
    position: sticky;
    z-index: 25;
    bottom: 8px;
    margin: 14px -4px 0;
    border: 1px solid #cfdbcf;
    border-radius: 10px;
    box-shadow: 0 10px 30px #1d39211c;
  }

  .import-review-hint {
    margin: 12px 0;
  }

  .import-review-approve {
    min-height: 42px;
  }

  @media (max-width: 520px) {
    .import-review-layout { display: block; }
    .import-review-list {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }
`;

document.head.append(style);

export {};
