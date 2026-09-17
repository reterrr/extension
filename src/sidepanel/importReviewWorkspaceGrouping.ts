function annotateImportReviewGroups(): void {
  if (!document.documentElement.classList.contains("import-review-mode")) return;

  const rows = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.import-review-fields > [data-review-field][data-review-target-kind="object"]',
    ),
  );

  let previousGroup = "";
  for (const row of rows) {
    const field = row.dataset.reviewField;
    if (!field) continue;

    // The bridge already resolves the selected preview object and field. Schema
    // metadata is the canonical source for the same grouping used by Workspace.
    const type = document
      .querySelector<HTMLElement>(".import-review-object-title .eyebrow")
      ?.textContent?.trim()
      .toLowerCase();
    const normalizedType = type === "nabor" || type === "nabór" ? "recruitment" : type;
    const definition = normalizedType
      ? BurbotSchema[normalizedType]?.fields?.[field]
      : undefined;
    const group = String(definition?.group ?? "Podstawowe");

    row.dataset.reviewGroup = group;
    if (group !== previousGroup) {
      row.dataset.reviewGroupStart = "true";
      previousGroup = group;
    } else {
      delete row.dataset.reviewGroupStart;
    }

    const value = row.querySelector<HTMLElement>(".import-review-workspace-value");
    if (value) {
      value.dataset.empty = String(
        !value.textContent?.trim() || value.textContent.trim() === "Nie ustawiono",
      );
    }
  }
}

let queued = false;
function queueGrouping(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    annotateImportReviewGroups();
  });
}

const observer = new MutationObserver(queueGrouping);
const root = document.getElementById("root");
if (root) observer.observe(root, { childList: true, subtree: true });
window.addEventListener("burbot:import-review-changed", queueGrouping);
queueGrouping();

export {};
