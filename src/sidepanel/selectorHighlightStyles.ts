if (!document.querySelector("style[data-burbot-selector-colors]")) {
  const style = document.createElement("style");
  style.dataset.burbotSelectorColors = "true";
  style.textContent = `
.field-row.has-selector-color {
  position: relative;
  border-color: color-mix(in srgb, var(--selector-border) 45%, #d5ded6);
  box-shadow: inset 4px 0 var(--selector-border);
  background: linear-gradient(90deg, var(--selector-soft) 0, #fbfcfb 46%);
}
.field-row.has-selector-color:hover {
  border-color: color-mix(in srgb, var(--selector-border) 62%, #c7d2c9);
  background: linear-gradient(90deg, var(--selector-soft) 0, #f4f8f5 58%);
}
.field-row.has-selector-color.selected {
  box-shadow:
    inset 4px 0 var(--selector-border),
    0 0 0 1px var(--selector-border);
  background: var(--selector-soft);
}
.field-row.has-selector-color .field-label::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 999px;
  background: var(--selector-border);
  vertical-align: 1px;
  opacity: .78;
}
#rule-details.has-selector-color {
  border-left: 3px solid var(--selector-border);
  padding-left: 8px;
  background: linear-gradient(90deg, var(--selector-soft), transparent 54%);
  border-radius: 4px;
}
`;
  document.head.append(style);
}

export {};
