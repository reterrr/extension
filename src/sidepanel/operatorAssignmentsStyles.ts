if (!document.querySelector("style[data-burbot-operator-assignments]")) {
  const style = document.createElement("style");
  style.dataset.burbotOperatorAssignments = "true";
  style.textContent = `
.operator-assignment-empty {
  color: var(--muted);
  font-size: 11px;
  padding: 8px 2px;
}
.operator-assignment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  padding: 8px 9px;
  margin: 6px 0;
}
.operator-assignment-copy {
  min-width: 0;
}
.operator-assignment-copy strong,
.operator-assignment-copy small {
  display: block;
}
.operator-assignment-copy strong {
  font-size: 12px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
}
.operator-assignment-copy small {
  color: var(--muted);
  margin-top: 2px;
}
.operator-assignment-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px auto;
  gap: 6px;
  align-items: end;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.operator-assignment-add label {
  display: grid;
  gap: 3px;
  font-size: 10px;
  color: var(--muted);
}
@media (max-width: 520px) {
  .operator-assignment-add {
    grid-template-columns: 1fr;
  }
}
`;
  document.head.append(style);
}

export {};
