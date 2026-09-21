import {
  patchSidepanelUiState,
  readSidepanelUiState,
} from "./uiSessionState";

let initialized = false;
let enhanceQueued = false;
let enhancing = false;
let activeFundingSize = "";
let lastCaptureLabel = "";
let uiWindowId: number | null = null;
let captureCollapsedPreference = false;
let restoredPanels: Record<string, boolean> = {};
let workspaceObserver: MutationObserver | null = null;
let observedWorkspace: HTMLElement | null = null;
let observedActiveLabel: HTMLElement | null = null;

const fieldSectionOpen = new Map<string, boolean>();

const BUSINESS_PANEL_IDS = [
  "file-sources-panel",
  "geography-panel",
  "funding-panel",
  "documents-panel",
] as const;

function persistWorkspaceChrome(
  workspace: Parameters<typeof patchSidepanelUiState>[1]["workspace"],
): void {
  if (uiWindowId === null || !workspace) return;
  void patchSidepanelUiState(uiWindowId, { workspace });
}

function restoreBusinessPanels(panels: Record<string, boolean>): void {
  for (const id of BUSINESS_PANEL_IDS) {
    const panel = $(id) as HTMLDetailsElement | null;
    if (!panel) continue;
    if (typeof panels[id] === "boolean") panel.open = panels[id];
    if (panel.dataset.qolTracked === "true") continue;
    panel.dataset.qolTracked = "true";
    panel.addEventListener("toggle", () => {
      if (!panel.isConnected) return;
      restoredPanels[id] = panel.open;
      persistWorkspaceChrome({ panels: { [id]: panel.open } });
    });
  }
}

function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function setOpen(element: HTMLDetailsElement | null, value: boolean): void {
  if (element && element.open !== value) element.open = value;
}

function setHidden(element: HTMLElement, value: boolean): void {
  if (element.hidden !== value) element.hidden = value;
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
    const system = row.classList.contains("system-field");
    const missing = !system && !!value?.classList.contains("empty");
    const neutral = !missing && !!value && isNeutralAnswer(value.textContent ?? "");

    row.classList.toggle("is-missing", missing);
    row.classList.toggle("is-neutral-answer", neutral);
    value?.classList.toggle("neutral-answer", neutral);

    if (mark) {
      const evidenceCount = Number(row.dataset.evidenceCount ?? "0") || 0;
      mark.classList.toggle("field-state-missing", missing);
      mark.classList.toggle("field-state-set", !missing && !system);
      const stateLabel = system
        ? value?.classList.contains("empty")
          ? ""
          : "AUTO"
        : missing
          ? "Brak"
          : "✓";
      const evidenceLabel = !system && evidenceCount ? `EV ${evidenceCount}` : "";
      setText(mark, [stateLabel, evidenceLabel].filter(Boolean).join(" · "));
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
    const businessRows = rows.filter((row) => !row.classList.contains("system-field"));
    const missing = businessRows.filter((row) => row.classList.contains("is-missing")).length;
    const systemOnly = rows.length > 0 && businessRows.length === 0;
    const status = systemOnly
      ? { text: "Automatyczne", state: "muted" }
      : sectionStatus(businessRows.length, missing);
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
    helper.textContent = systemOnly
      ? "Uzupełniane przy zapisie do bazy"
      : `${businessRows.length - missing}/${businessRows.length} pól uzupełnionych`;
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
      if (!details.isConnected) return;
      fieldSectionOpen.set(title, details.open);
      persistWorkspaceChrome({
        fieldSections: { [title]: details.open },
      });
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
  persistWorkspaceChrome({ fundingSize: size });
  for (const button of root.querySelectorAll<HTMLButtonElement>(".funding-tab")) {
    const selected = button.dataset.size === size;
    if (button.getAttribute("aria-selected") !== String(selected)) {
      button.setAttribute("aria-selected", String(selected));
    }
  }
  for (const panel of root.querySelectorAll<HTMLElement>(".funding-tab-panel")) {
    setHidden(panel, panel.dataset.size !== size);
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
      setOpen(onlyVariant, true);
    }
  });

  root.prepend(tabs);
  selectFundingTab(root, activeFundingSize || labels[0]);

  const panel = $("funding-panel") as HTMLDetailsElement | null;
  if (panel && root.querySelector(".field-row.selected")) setOpen(panel, true);
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
  if (panel && root.querySelector(".field-row.selected")) setOpen(panel, true);
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
    area.classList.toggle("is-collapsed", captureCollapsedPreference);
    collapse.setAttribute(
      "aria-expanded",
      String(!captureCollapsedPreference),
    );
    collapse.textContent = captureCollapsedPreference ? "⌃" : "⌄";
    lastCaptureLabel = currentLabel;
  }
}

function observeWorkspaceChanges(): void {
  if (!workspaceObserver || !observedWorkspace) return;

  workspaceObserver.observe(observedWorkspace, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "open"],
  });

  if (observedActiveLabel) {
    workspaceObserver.observe(observedActiveLabel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}

function enhanceAll(): void {
  if (enhancing) return;
  enhancing = true;

  // The enhancer itself rewrites classes, hidden/open state and DOM structure.
  // Observing those writes recursively created an unbounded microtask feedback
  // loop (observer -> enhance -> mutation -> observer -> ...), which could peg
  // Firefox and exhaust system memory. Ignore our own mutations and reconnect
  // only after the enhancement pass is complete.
  workspaceObserver?.disconnect();

  try {
    enhanceFieldGroups();
    enhanceFunding();
    enhanceDocuments();
    enhanceStaticStatuses();
    restoreBusinessPanels(restoredPanels);
    enhanceCaptureDock();
  } finally {
    enhancing = false;
    observeWorkspaceChanges();
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

export async function initWorkspaceRedesignUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const workspace = $("workspace");
  if (!workspace) return;

  const currentWindow = await browser.windows.getCurrent();
  if (currentWindow.id !== undefined) {
    uiWindowId = currentWindow.id;
    const uiState = await readSidepanelUiState(currentWindow.id);
    activeFundingSize = uiState.workspace.fundingSize;
    captureCollapsedPreference = uiState.workspace.captureCollapsed;
    restoredPanels = uiState.workspace.panels;
    fieldSectionOpen.clear();
    for (const [title, open] of Object.entries(
      uiState.workspace.fieldSections,
    )) {
      fieldSectionOpen.set(title, open);
    }
  }

  const collapse = $("capture-collapse") as HTMLButtonElement | null;
  const capture = $("capture-area");
  if (capture && collapse) {
    capture.classList.toggle(
      "is-collapsed",
      captureCollapsedPreference,
    );
    collapse.setAttribute(
      "aria-expanded",
      String(!captureCollapsedPreference),
    );
    collapse.textContent = captureCollapsedPreference ? "⌃" : "⌄";
  }

  collapse?.addEventListener("click", () => {
    if (!capture) return;
    const collapsed = capture.classList.toggle("is-collapsed");
    captureCollapsedPreference = collapsed;
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.textContent = collapsed ? "⌃" : "⌄";
    persistWorkspaceChrome({ captureCollapsed: collapsed });
  });

  restoreBusinessPanels(restoredPanels);

  observedWorkspace = workspace;
  observedActiveLabel = $("active-label");
  workspaceObserver = new MutationObserver(scheduleEnhance);
  observeWorkspaceChanges();

  scheduleEnhance();
}
