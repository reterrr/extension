let initialized = false;
let enhanceQueued = false;
let enhancing = false;
let activeFundingSize = "";
let lastCaptureLabel = "";

const fieldSectionOpen = new Map<string, boolean>();

function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function missingLabel(count: number): string {
  if (count === 1) return "1 pole brakujące";
  if (count >= 2 && count <= 4) return `${count} pola brakujące`;
  return `${count} pól brakujących`;
}

function itemLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function isNeutralAnswer(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("pl-PL");
  return (
    normalized.includes("not distinguished") ||
    normalized.includes("nie rozróżniono") ||
    normalized.includes("nie rozrozniono") ||
    normalized === "nie dotyczy"
  );
}

function annotateFieldRows(root: ParentNode): void {
  for (const row of root.querySelectorAll<HTMLElement>(".field-row")) {
    const value = row.querySelector<HTMLElement>(".field-value");
    const mark = row.querySelector<HTMLElement>(".field-mark");
    const missing = !!value?.classList.contains("empty");
    const neutral = !missing && !!value && isNeutralAnswer(value.textContent ?? "");

    row.classList.toggle("is-missing", missing);
    row.classList.toggle("is-neutral-answer", neutral);
    value?.classList.toggle("neutral-answer", neutral);

    if (mark) {
      mark.classList.toggle("field-state-missing", missing);
      mark.classList.toggle("field-state-set", !missing);
      setText(mark, missing ? "Brak" : "");
    }
  }
}

function sectionStatus(total: number, missing: number): { text: string; state: string } {
  if (!total) return { text: "Brak pól", state: "muted" };
  if (!missing) return { text: "Wszystko uzupełnione", state: "complete" };
  return { text: missingLabel(missing), state: "missing" };
}

function enhanceFieldGroups(): void {
  const root = $("fields");
  if (!root) return;

  annotateFieldRows(root);

  const groups = Array.from(root.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains("field-group"),
  );

  groups.forEach((group, index) => {
    if (group.dataset.redesigned === "true") return;

    const heading = group.querySelector<HTMLElement>(":scope > h2");
    const title = heading?.textContent?.trim() || `Sekcja ${index + 1}`;
    const rows = Array.from(group.querySelectorAll<HTMLElement>(":scope > .field-row"));
    const missing = rows.filter((row) => row.classList.contains("is-missing")).length;
    const status = sectionStatus(rows.length, missing);
    const selected = rows.some((row) => row.classList.contains("selected"));

    const details = document.createElement("details");
    details.className = "workspace-section-card field-group-card";
    details.dataset.redesigned = "true";
    details.dataset.sectionKey = title;

    const remembered = fieldSectionOpen.get(title);
    details.open = selected || (remembered ?? index === 0);
    fieldSectionOpen.set(title, details.open);

    const summary = document.createElement("summary");
    summary.className = "workspace-section-summary";

    const titleWrap = document.createElement("span");
    titleWrap.className = "workspace-section-title";
    const titleNode = document.createElement("strong");
    titleNode.textContent = title;
    const helper = document.createElement("small");
    helper.textContent = `${rows.length - missing}/${rows.length} pól uzupełnionych`;
    titleWrap.append(titleNode, helper);

    const badge = document.createElement("span");
    badge.className = "workspace-section-status";
    badge.dataset.state = status.state;
    badge.textContent = status.text;

    summary.append(titleWrap, badge);

    const body = document.createElement("div");
    body.className = "workspace-section-body";
    for (const child of Array.from(group.children)) {
      if (child !== heading) body.append(child);
    }

    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (details.isConnected) fieldSectionOpen.set(title, details.open);
    });

    group.replaceWith(details);
  });
}

function fundingGroupLabel(group: HTMLElement, index: number): string {
  return (
    group.querySelector<HTMLElement>(".size-heading h3")?.textContent?.trim() ||
    `Wariant ${index + 1}`
  );
}

function selectFundingTab(root: HTMLElement, size: string): void {
  activeFundingSize = size;
  for (const button of root.querySelectorAll<HTMLButtonElement>(".funding-tab")) {
    button.setAttribute("aria-selected", String(button.dataset.size === size));
  }
  for (const panel of root.querySelectorAll<HTMLElement>(".funding-tab-panel")) {
    panel.hidden = panel.dataset.size !== size;
  }
}

function enhanceFunding(): void {
  const root = $("funding");
  if (!root) return;

  annotateFieldRows(root);

  const groups = Array.from(root.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains("size-group"),
  );

  const totalRows = groups.reduce(
    (sum, group) => sum + group.querySelectorAll(".field-row").length,
    0,
  );
  const missing = groups.reduce(
    (sum, group) => sum + group.querySelectorAll(".field-row.is-missing").length,
    0,
  );

  const status = $("funding-status");
  if (status) {
    const text = missing
      ? missingLabel(missing)
      : totalRows
        ? "Wszystko uzupełnione"
        : "Nie skonfigurowano";
    setText(status, text);
    status.dataset.state = missing ? "missing" : totalRows ? "complete" : "muted";
  }

  if (!groups.length || root.querySelector(":scope > .funding-tabs")) return;

  const selectedGroup = groups.find((group) => group.querySelector(".field-row.selected"));
  const labels = groups.map(fundingGroupLabel);

  if (selectedGroup) {
    activeFundingSize = fundingGroupLabel(selectedGroup, groups.indexOf(selectedGroup));
  } else if (!labels.includes(activeFundingSize)) {
    const preferred = groups.find(
      (group) =>
        group.querySelectorAll(".variant").length > 0 &&
        group.querySelectorAll(".field-row.is-missing").length > 0,
    );
    const firstConfigured = groups.find((group) => group.querySelector(".variant"));
    const fallback = preferred ?? firstConfigured ?? groups[0];
    activeFundingSize = fundingGroupLabel(fallback, groups.indexOf(fallback));
  }

  const tabs = document.createElement("div");
  tabs.className = "funding-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Wielkość przedsiębiorstwa");

  groups.forEach((group, index) => {
    const label = fundingGroupLabel(group, index);
    const variants = group.querySelectorAll(".variant").length;
    const missingFields = group.querySelectorAll(".field-row.is-missing").length;

    group.classList.add("funding-tab-panel");
    group.dataset.size = label;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "funding-tab";
    button.dataset.size = label;
    button.setAttribute("role", "tab");

    const copy = document.createElement("span");
    copy.textContent = label;
    const state = document.createElement("small");
    state.className = "funding-tab-state";
    if (!variants) {
      state.textContent = "—";
      state.dataset.state = "muted";
    } else if (missingFields) {
      state.textContent = String(missingFields);
      state.dataset.state = "missing";
    } else {
      state.textContent = "✓";
      state.dataset.state = "complete";
    }
    button.append(copy, state);
    button.onclick = () => selectFundingTab(root, label);
    tabs.append(button);

    if (variants === 1) {
      const onlyVariant = group.querySelector<HTMLDetailsElement>(".variant");
      if (onlyVariant) onlyVariant.open = true;
    }
  });

  root.prepend(tabs);
  selectFundingTab(root, activeFundingSize || labels[0]);

  const panel = $("funding-panel") as HTMLDetailsElement | null;
  if (panel && root.querySelector(".field-row.selected")) panel.open = true;
}

function enhanceDocuments(): void {
  const root = $("documents");
  if (!root) return;

  annotateFieldRows(root);

  let total = 0;
  let unconfigured = 0;
  const translations: Record<string, string> = {
    Required: "Wymagane",
    Optional: "Opcjonalne",
    Internal: "Wewnętrzne",
    "Not configured": "Nie skonfigurowane",
  };

  for (const group of root.querySelectorAll<HTMLElement>(".document-group")) {
    const heading = group.querySelector<HTMLElement>(":scope > h3");
    const original = heading?.dataset.originalLabel || heading?.textContent?.trim() || "";
    if (heading && !heading.dataset.originalLabel) heading.dataset.originalLabel = original;
    const documents = group.querySelectorAll(".document").length;
    total += documents;
    if (original === "Not configured") unconfigured += documents;
    if (heading && translations[original]) setText(heading, translations[original]);
  }

  const configured = Math.max(0, total - unconfigured);
  const status = $("document-count");
  if (status) {
    setText(status, total ? `${configured}/${total} skonfigurowane` : "Brak dokumentów");
    status.dataset.state = !total ? "muted" : configured === total ? "complete" : "missing";
  }

  const panel = $("documents-panel") as HTMLDetailsElement | null;
  if (panel && root.querySelector(".field-row.selected")) panel.open = true;
}

function translateObjectProgress(): void {
  const progress = $("progress");
  if (progress) {
    const match = progress.textContent?.match(/(\d+)\s*\/\s*(\d+)\s*fields?\s*completed/i);
    if (match) setText(progress, `${match[1]}/${match[2]} pól uzupełnionych`);
  }

  const ruleCount = $("rule-count");
  if (ruleCount) {
    const match = ruleCount.textContent?.match(/(\d+)\s*rules?/i);
    if (match) setText(ruleCount, `${match[1]} reguł`);
  }
}

function enhanceStaticStatuses(): void {
  translateObjectProgress();

  const fileRows = document.querySelectorAll("#file-source-list .file-source-row").length;
  const fileStatus = $("file-source-count");
  if (fileStatus) {
    setText(fileStatus, fileRows ? itemLabel(fileRows, "plik", "pliki") : "Brak plików");
    fileStatus.dataset.state = fileRows ? "complete" : "muted";
  }

  const geographyRows = document.querySelectorAll("#geography-list .geography-row").length;
  const geographyStatus = $("geography-count");
  if (geographyStatus) {
    setText(
      geographyStatus,
      geographyRows ? itemLabel(geographyRows, "zakres", "zakresów") : "Brak zakresu",
    );
    geographyStatus.dataset.state = geographyRows ? "complete" : "missing";
  }
}

function enhanceCaptureDock(): void {
  const area = $("capture-area");
  const collapse = $("capture-collapse") as HTMLButtonElement | null;
  const label = $("active-label");
  if (!area || !collapse || !label) return;

  const currentLabel = label.textContent?.trim() || "";
  if (currentLabel && currentLabel !== lastCaptureLabel) {
    area.classList.remove("is-collapsed");
    collapse.setAttribute("aria-expanded", "true");
    collapse.textContent = "⌄";
    lastCaptureLabel = currentLabel;
  }
}

function enhanceAll(): void {
  if (enhancing) return;
  enhancing = true;
  try {
    enhanceFieldGroups();
    enhanceFunding();
    enhanceDocuments();
    enhanceStaticStatuses();
    enhanceCaptureDock();
  } finally {
    enhancing = false;
  }
}

function scheduleEnhance(): void {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(() => {
    enhanceQueued = false;
    enhanceAll();
  });
}

export function initWorkspaceRedesignUi(): void {
  if (initialized) return;
  initialized = true;

  const workspace = $("workspace");
  if (!workspace) return;

  const collapse = $("capture-collapse") as HTMLButtonElement | null;
  const capture = $("capture-area");
  collapse?.addEventListener("click", () => {
    if (!capture) return;
    const collapsed = capture.classList.toggle("is-collapsed");
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.textContent = collapsed ? "⌃" : "⌄";
  });

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(workspace, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "open"],
  });

  const activeLabel = $("active-label");
  if (activeLabel) {
    observer.observe(activeLabel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  scheduleEnhance();
}
