const style = document.createElement("style");
style.dataset.burbotImportWorkspaceParity = "true";
style.textContent = `
  /* Import Review is a staging workspace. Keep the same visual rhythm as the
     normal Workspace and override the old review-table layout deterministically. */
  .import-review-panel {
    margin: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: visible;
  }

  .import-review-header {
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--line);
  }

  .import-review-header strong {
    max-width: min(430px, 72vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-review-layout {
    display: block !important;
    min-height: 0;
    border-top: 0;
  }

  /* Object switcher: one compact horizontal rail instead of a tall sidebar. */
  .import-review-list {
    display: flex !important;
    align-items: flex-start;
    gap: 14px;
    max-height: 82px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 16px 9px;
    border-right: 0 !important;
    border-bottom: 1px solid var(--line);
    background: #fff;
    scrollbar-width: thin;
  }

  .import-review-list details {
    flex: none;
    display: block;
    margin: 0 !important;
    white-space: nowrap;
  }

  .import-review-list summary {
    display: block;
    width: fit-content;
    margin: 0 0 4px;
    padding: 0;
    color: #718074;
    background: transparent !important;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
  }

  .import-review-list summary span {
    margin-left: 4px;
    color: #9aa49a;
  }

  .import-review-list button {
    display: inline-flex !important;
    width: auto !important;
    min-width: 128px;
    max-width: 195px;
    min-height: 36px;
    margin: 0 4px 0 0 !important;
    padding: 6px 8px !important;
    border-radius: 6px;
    vertical-align: top;
  }

  .import-review-list button > span {
    max-width: 132px;
  }

  .import-review-list button.selected {
    background: #eaf2e7 !important;
    border-color: transparent !important;
    box-shadow: inset 3px 0 var(--green);
  }

  .import-review-detail {
    min-width: 0;
    padding: 0 16px 20px !important;
  }

  .import-review-object-title {
    margin: 0 !important;
    padding: 14px 0 12px;
  }

  .import-review-object-title h2 {
    margin: 4px 0 0;
    font-size: 21px;
    line-height: 1.2;
  }

  .import-review-edit-badge {
    margin-top: 1px;
  }

  .import-review-sources {
    gap: 6px;
    margin: -4px 0 9px;
  }

  .import-review-sources .text-button {
    padding: 3px 0;
    font-size: 10px;
  }

  .import-review-section {
    display: block !important;
    margin: 0 !important;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }

  .import-review-section:has(> .import-review-fields) > .import-review-section-heading {
    display: none;
  }

  .import-review-section-heading {
    margin-bottom: 7px;
  }

  .import-review-section-heading > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .import-review-section-heading > div > strong {
    color: var(--muted);
    font-size: 10px;
    font-weight: 500;
  }

  .import-review-section-heading > small {
    display: none;
  }

  .import-review-fields {
    display: block !important;
  }

  /* Exact Workspace-like field anatomy: label/value on the left, one action on
     the right. The previous flex rule split label, value and evidence into three
     columns, which is what made the review look broken in narrow sidebars. */
  .import-review-fields > div.import-review-workspace-field {
    position: relative;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "head meta"
      "value meta";
    column-gap: 10px;
    row-gap: 1px;
    align-items: center;
    width: 100%;
    min-height: 50px;
    margin: 1px 0;
    padding: 8px 10px;
    box-sizing: border-box;
    border: 0 !important;
    border-radius: 6px;
    background: transparent !important;
    box-shadow: none !important;
    text-align: left;
  }

  .import-review-fields > div.import-review-workspace-field[data-review-group-start="true"] {
    margin-top: 34px;
  }

  .import-review-fields > div.import-review-workspace-field[data-review-group-start="true"]::before {
    content: attr(data-review-group);
    position: absolute;
    top: -25px;
    right: 0;
    left: 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: #5d7564;
    font-size: 12px;
    font-weight: 650;
    pointer-events: none;
  }

  .import-review-fields > div.import-review-workspace-field[data-review-group-start="true"]:first-child {
    margin-top: 28px;
  }

  .import-review-fields > div.import-review-workspace-field:hover {
    background: var(--surface-soft, #f7faf6) !important;
  }

  .import-review-fields > div.import-review-workspace-field.selected {
    background: #eaf2e7 !important;
    box-shadow: inset 3px 0 var(--green) !important;
    outline: 0 !important;
  }

  .import-review-field-head {
    grid-area: head;
    min-width: 0;
    display: block !important;
  }

  .import-review-field-head small:first-child {
    display: block;
    color: #718074;
    font-size: 11px;
  }

  .import-review-field-head > span {
    display: none;
  }

  .import-review-workspace-field.selected .import-review-field-head small:first-child {
    color: var(--green);
  }

  .import-review-workspace-value {
    grid-area: value;
    min-width: 0;
    margin: 0 !important;
    color: #26342d;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .import-review-workspace-value[data-empty="true"] {
    color: #9aa49a;
    font-size: 12px;
    font-weight: 400;
  }

  .import-review-field-meta {
    grid-area: meta;
    align-self: center;
    display: block !important;
    margin: 0 !important;
  }

  .import-review-field-meta > span {
    display: none;
  }

  .import-review-source-button {
    padding: 3px 0;
    font-size: 9px;
    white-space: nowrap;
  }

  .import-review-files,
  .import-review-financing {
    display: grid !important;
    grid-template-columns: 1fr !important;
    gap: 7px;
    margin-top: 6px;
  }

  .import-review-file-card,
  .import-review-finance-card {
    min-width: 0;
    border: 1px solid var(--line) !important;
    border-radius: 7px !important;
    background: #fafcfa !important;
  }

  .import-review-file-card {
    padding: 9px 10px;
  }

  .import-review-file-card .import-review-editor {
    font-size: 12px;
  }

  .import-review-file-card a {
    display: block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .import-review-finance-card > summary {
    padding: 9px 10px;
  }

  /* Financing uses the same vertical field rhythm as Workspace variants. */
  .import-review-finance-fields {
    display: grid !important;
    grid-template-columns: 1fr !important;
    gap: 1px !important;
    padding: 0 9px 8px !important;
  }

  .import-review-finance-fields > label.import-review-workspace-field {
    display: grid !important;
    grid-template-columns: 1fr;
    gap: 2px;
    align-items: start;
    min-width: 0;
    min-height: 45px;
    padding: 7px 9px;
    border-radius: 6px;
    cursor: pointer;
  }

  .import-review-finance-fields > label.import-review-workspace-field > small {
    color: #718074;
    font-size: 10px;
  }

  .import-review-finance-fields > label.import-review-workspace-field > .import-review-workspace-value {
    grid-area: auto !important;
    width: 100%;
    font-size: 12px;
  }

  .import-review-finance-fields > label.import-review-workspace-field:hover {
    background: var(--surface-soft, #f3f7f2);
  }

  .import-review-finance-fields > label.import-review-workspace-field.selected {
    background: #eaf2e7;
    box-shadow: inset 3px 0 var(--green);
    outline: 0;
  }

  .import-review-remove-finance {
    margin: 1px 10px 9px;
  }

  .import-review-capture-area {
    position: sticky;
    z-index: 25;
    bottom: 8px;
    margin: 12px -2px 0;
    border: 1px solid #cfdbcf;
    border-radius: 9px;
    background: #fff;
    box-shadow: 0 10px 26px #1d39211c;
  }

  .import-review-capture-area .capture-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .import-review-capture-area .capture-tools button {
    flex: 1 1 auto;
    min-width: 0;
  }

  .import-review-hint {
    margin: 10px 0;
    line-height: 1.4;
  }

  .import-review-approve {
    min-height: 40px;
  }

  @media (max-width: 520px) {
    .import-review-list {
      max-height: 78px;
      padding-inline: 12px;
    }

    .import-review-detail {
      padding-inline: 12px !important;
    }

    .import-review-list button {
      min-width: 118px;
      max-width: 170px;
    }
  }
`;

document.head.append(style);

export {};
