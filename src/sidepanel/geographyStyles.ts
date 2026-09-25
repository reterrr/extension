if (!document.querySelector("style[data-burbot-geography]")) {
  const style = document.createElement("style");
  style.dataset.burbotGeography = "true";
  style.textContent = `
.connection-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.section-heading .muted {
  display: block;
  margin-top: 3px;
  line-height: 1.35;
}
.geography-empty {
  color: var(--muted);
  font-size: 11px;
  padding: 8px 2px;
}
.geography-operator-group {
  margin: 9px 0 12px;
  padding: 8px;
  border: 1px solid #dce6d9;
  border-radius: 8px;
  background: #f7faf5;
}
.geography-operator-group-warning {
  border-color: #ead8aa;
  background: #fffaf0;
}
.geography-operator-heading {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  padding: 1px 1px 5px;
}
.geography-operator-heading strong {
  font-size: 12px;
}
.geography-operator-heading small {
  color: var(--muted);
  font-size: 10px;
}
.geography-empty-operator {
  padding: 5px 2px 2px;
}
.geography-row {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  padding: 8px 9px;
  margin: 6px 0;
}
.geography-copy strong,
.geography-copy small {
  display: block;
}
.geography-copy strong {
  font-size: 12px;
  font-weight: 650;
}
.geography-copy small {
  color: var(--muted);
  margin-top: 2px;
}
.geography-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.geography-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 5px;
  border-top: 1px solid var(--line);
  padding-top: 4px;
}
.geography-actions .text-button {
  padding-left: 0;
}
.geography-add {
  margin-top: 8px;
}
.geography-add > summary {
  list-style: none;
  padding: 6px 0;
}
.geography-form {
  background: #f1f5ee;
  border-radius: 7px;
  padding: 9px;
  margin-top: 4px;
}
.geography-results {
  max-height: 220px;
  overflow: auto;
  margin-top: 5px;
  border-radius: 5px;
}
.geography-result {
  width: 100%;
  text-align: left;
  display: block;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 5px;
  margin: 3px 0;
  padding: 7px 8px;
}
.geography-result strong,
.geography-result small {
  display: block;
}
.geography-result strong {
  font-size: 12px;
  font-weight: 600;
}
.geography-result small {
  color: var(--muted);
  font-size: 10px;
  margin-top: 1px;
}
`;
  document.head.append(style);
}

export {};
