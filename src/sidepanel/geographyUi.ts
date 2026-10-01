import "../shared/domain/geographyRuntime";
import { readWorkspaceState } from "./workspaceData";
import "./geographyStyles";
import { createCapturedExtractionInput } from "../shared/extraction/rules";
import { geographyInheritanceStatus } from "../shared/configurationInheritance";
import { isPickerSelectionResponse } from "../shared/messaging/picker";
import {
  patchSidepanelUiState,
  readSidepanelUiState,
} from "./uiSessionState";
import type {
  LegacyStorageState,
  LegacyStoredGeography,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let renderQueued = false;
let uiWindowId: number | null = null;
let uiPersistTimer: number | undefined;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function notice(text: string, error = false): void {
  const element = $("notice");
  element.textContent = text;
  element.className = error ? "error" : "";
}

function persistGeographyUi(): void {
  if (uiWindowId === null) return;
  const role = $("geography-role") as HTMLSelectElement;
  const type = $("geography-type") as HTMLSelectElement;
  const search = $("geography-search") as HTMLInputElement;
  const add = $("geography-add") as HTMLDetailsElement;
  void patchSidepanelUiState(uiWindowId, {
    workspace: {
      geography: {
        role: role.value,
        type: type.value,
        query: search.value,
        addOpen: add.open,
      },
    },
  });
}

function scheduleGeographyUiPersist(): void {
  if (uiPersistTimer !== undefined) window.clearTimeout(uiPersistTimer);
  uiPersistTimer = window.setTimeout(() => {
    uiPersistTimer = undefined;
    persistGeographyUi();
  }, 100);
}

async function data(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<LegacyStorageState> {
  if (op === "GET") return state = await readWorkspaceState();
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op,
    expectedRevision: state.revision,
    ...payload,
  })) as { ok?: boolean; value?: LegacyStorageState; error?: string };

  if (!response?.ok || !response.value) {
    throw new Error(response?.error ?? "Storage is unavailable.");
  }

  state = response.value;
  return state;
}

async function refreshActivePage(): Promise<void> {
  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({
    active: true,
    windowId: currentWindow.id,
  });
  activePageUrl = tabs[0]?.url ?? "";
}

function workspacePageUrl(): string {
  const connected = document.getElementById("connection")?.dataset.connected === "true";
  return connected ? activePageUrl : "";
}

function isLocal(object: LegacyStoredObject, pageUrl: string): boolean {
  return (
    !!pageUrl &&
    (object.sourceUrl === pageUrl ||
      state.rules.some(
        (rule) => rule.objectId === object.id && rule.pageUrl === pageUrl,
      ))
  );
}

function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("workspace")?.dataset.activeObjectId ?? "";
  if (!activeId) return undefined;
  return state.objects.find((object) => object.id === activeId);
}

function geographyLabel(value: string): string {
  return BurbotGeography.catalog.find((entry) => entry.value === value)?.label ?? value;
}

function operatorAssignments(objectId: string) {
  return (state.operatorAssignments ?? []).filter(
    (row) => row.objectId === objectId,
  );
}

function operatorObject(operatorId: string) {
  return state.objects.find(
    (object) => object.id === operatorId && object.type === "operator",
  );
}

function operatorKey(operatorId: string): string {
  const operator = operatorObject(operatorId);
  return String(operator?.importKey || operator?.id || operatorId);
}

function operatorName(operatorId: string): string {
  const operator = operatorObject(operatorId);
  return String(operator?.values?.name ?? operator?.label ?? "");
}

function renderGeographyOperatorSelect(object: LegacyStoredObject): string {
  const select = $("geography-operator") as HTMLSelectElement;
  const label = $("geography-operator-label");
  const assignments = operatorAssignments(object.id);
  const previous = select.value;

  const supportsOperatorScopedGeography =
    object.type === "project" || object.type === "recruitment";
  label.hidden = !supportsOperatorScopedGeography;
  select.hidden = !supportsOperatorScopedGeography;
  if (!supportsOperatorScopedGeography) {
    select.replaceChildren();
    return "";
  }

  select.replaceChildren();
  if (!assignments.length) {
    select.append(
      new Option(
        object.type === "project"
          ? "Najpierw dodaj operatora do projektu"
          : "Najpierw dodaj operatora do naboru",
        "",
      ),
    );
    select.disabled = true;
    return "";
  }

  select.disabled = false;
  for (const assignment of assignments) {
    const key = operatorKey(assignment.operatorId);
    const name = operatorName(assignment.operatorId);
    select.append(
      new Option(name ? `${key} — ${name}` : key, assignment.operatorId),
    );
  }

  select.value = assignments.some((row) => row.operatorId === previous)
    ? previous
    : assignments[0].operatorId;
  return select.value;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pl-PL")
    .trim();
}

function keepControlInPlace(
  element: HTMLElement,
  beforeTop: number,
  focus?: HTMLElement,
): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const delta = element.getBoundingClientRect().top - beforeTop;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      const capture = document.getElementById("capture-area");
      if (capture instanceof HTMLElement && !capture.hidden) {
        const rect = element.getBoundingClientRect();
        const dockTop = capture.getBoundingClientRect().top;
        if (rect.bottom > dockTop - 10) {
          window.scrollBy(0, rect.bottom - dockTop + 10);
        }
      }
      if (focus) {
        try {
          focus.focus({ preventScroll: true });
        } catch {
          focus.focus();
        }
      }
    });
  });
}

function matchingCatalog(type: string, query: string) {
  const needle = normalizeSearch(query);
  return BurbotGeography.catalog
    .filter((entry) => entry.type === type)
    .filter((entry) => {
      if (!needle) return true;
      return normalizeSearch(
        `${entry.label} ${entry.context ?? ""} ${entry.value} ${entry.search}`,
      ).includes(needle);
    })
    .slice(0, 20);
}

function hasEvidenceRule(objectId: string, geographyId: string): boolean {
  return state.rules.some(
    (rule) =>
      rule.objectId === objectId &&
      rule.field === "value" &&
      rule.target?.kind === "geography" &&
      rule.target.id === geographyId,
  );
}

async function captureSelectedText(
  object: LegacyStoredObject,
  row: LegacyStoredGeography,
): Promise<void> {
  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({
    active: true,
    windowId: currentWindow.id,
  });
  const tab = tabs[0];
  if (tab?.id === undefined) throw new Error("No active webpage.");

  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });

  const response: unknown = await browser.tabs.sendMessage(tab.id, {
    type: "BURBOT_SELECTION",
  });

  if (!isPickerSelectionResponse(response)) {
    throw new Error("Select text on the page first.");
  }
  if (!response.ok) throw new Error(response.error);

  const option = response.value.options.find(
    (candidate) => candidate.extraction.type === "selection",
  );
  if (!option) throw new Error("Select text on the page first.");

  const candidate = createCapturedExtractionInput(response.value, option);
  await data("ASSIGN", {
    objectId: object.id,
    field: "value",
    target: { kind: "geography", id: row.id },
    value: row.value,
    candidate,
  });

  notice(
    `Zapisano potwierdzenie: „${option.raw}” → ${geographyLabel(row.value)}.`,
  );
}

function geographyRowCard(
  object: LegacyStoredObject,
  row: LegacyStoredGeography,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "geography-row";

  const copy = document.createElement("div");
  copy.className = "geography-copy";

  const title = document.createElement("strong");
  title.textContent = geographyLabel(row.value);

  const meta = document.createElement("small");
  meta.textContent = `${BurbotGeography.roles[row.role] ?? row.role} · ${BurbotGeography.types[row.type] ?? row.type}`;

  const badges = document.createElement("span");
  badges.className = "geography-badges";
  if (hasEvidenceRule(object.id, row.id)) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "potwierdzone ze strony";
    badges.append(badge);
  }
  if (row.copiedFromProjectId) {
    const badge = document.createElement("span");
    badge.className = "badge geography-inherited-badge";
    badge.textContent = "kopia z projektu";
    badge.title =
      "Ta geografia jest niezależną kopią. Zmiany geografii projektu nie aktualizują jej automatycznie.";
    badges.append(badge);
  }

  copy.append(title, meta, badges);

  const actions = document.createElement("div");
  actions.className = "geography-actions";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "text-button";
  confirm.textContent = hasEvidenceRule(object.id, row.id)
    ? "Zmień potwierdzenie"
    : "Potwierdź zaznaczeniem";
  confirm.onclick = () => {
    void captureSelectedText(object, row)
      .then(render)
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.setAttribute("aria-label", "Usuń geografię");
  remove.textContent = "×";
  remove.onclick = () => {
    const addPanel = $("geography-add");
    const beforeTop = addPanel.getBoundingClientRect().top;
    void data("REMOVE_GEOGRAPHY", {
      objectId: object.id,
      geographyId: row.id,
    })
      .then(() => {
        notice("Usunięto warunek geograficzny.");
        render();
        keepControlInPlace(addPanel, beforeTop);
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };

  actions.append(confirm, remove);
  card.append(copy, actions);
  return card;
}

function renderInheritance(object: LegacyStoredObject): void {
  const root = $("geography-inherit");
  const select = $("geography-inherit-operator") as HTMLSelectElement;
  const button = $("geography-inherit-button") as HTMLButtonElement;
  const statusElement = $("geography-inherit-status");

  root.hidden = object.type !== "recruitment";
  if (object.type !== "recruitment") {
    select.replaceChildren();
    button.disabled = true;
    statusElement.textContent = "";
    return;
  }

  const assignments = operatorAssignments(object.id);
  const previous = select.value;
  select.replaceChildren(new Option("Wybierz operatora…", ""));
  for (const assignment of assignments) {
    const key = operatorKey(assignment.operatorId);
    const name = operatorName(assignment.operatorId);
    select.append(
      new Option(name ? `${key} — ${name}` : key, assignment.operatorId),
    );
  }
  select.value = assignments.some((row) => row.operatorId === previous)
    ? previous
    : "";

  const inheritance = geographyInheritanceStatus(
    state,
    object,
    select.value,
  );

  if (!inheritance.project) {
    button.disabled = true;
    button.textContent = "↳ Dziedzicz geografię";
    statusElement.textContent = "Najpierw przypisz projekt do naboru.";
    return;
  }
  if (!assignments.length) {
    button.disabled = true;
    button.textContent = "↳ Dziedzicz geografię";
    statusElement.textContent = "Najpierw przypisz operatora do naboru.";
    return;
  }
  if (!select.value) {
    button.disabled = true;
    button.textContent = "↳ Dziedzicz geografię";
    statusElement.textContent =
      "Najpierw wybierz operatora, dla którego ma zostać skopiowana geografia projektu.";
    return;
  }
  if (!inheritance.projectOperatorAssigned) {
    button.disabled = true;
    button.textContent = "Operator nie jest w projekcie";
    statusElement.textContent =
      "Wybrany operator musi być przypisany również do projektu, ponieważ geografia projektu jest przypisana do operatora.";
    return;
  }
  if (!inheritance.projectGeographies.length) {
    button.disabled = true;
    button.textContent = "Brak geografii operatora";
    statusElement.textContent =
      "Projekt nie ma geografii przypisanej do wybranego operatora.";
    return;
  }

  const pending = inheritance.pendingGeographies.length;
  button.disabled = pending === 0;
  button.textContent = pending
    ? `↳ Skopiuj geografię z projektu (${pending})`
    : `✓ Geografia projektu skopiowana (${inheritance.projectGeographies.length})`;
  statusElement.textContent = pending
    ? "Powstaną niezależne kopie przypisane do wybranego operatora."
    : "Brak nowych elementów. Istniejące kopie nie synchronizują się z projektem.";
}

function renderRows(object: LegacyStoredObject): void {
  const root = $("geography-list");
  root.replaceChildren();

  const rows = (state.geographies ?? []).filter(
    (row) => row.objectId === object.id,
  );

  const assignments = operatorAssignments(object.id);
  if (!assignments.length) {
    const empty = document.createElement("p");
    empty.className = "geography-empty";
    empty.textContent =
      object.type === "project"
        ? "Najpierw dodaj operatora do projektu. Geografia projektu jest przypisana do operatora."
        : "Najpierw dodaj operatora do naboru. Geografia naboru jest przypisana do operatora.";
    root.append(empty);
    return;
  }

  for (const assignment of assignments) {
    const group = document.createElement("section");
    group.className = "geography-operator-group";

    const heading = document.createElement("div");
    heading.className = "geography-operator-heading";
    const title = document.createElement("strong");
    title.textContent = `${operatorKey(assignment.operatorId)} — geografia:`;
    heading.append(title);

    const name = operatorName(assignment.operatorId);
    if (name) {
      const small = document.createElement("small");
      small.textContent = name;
      heading.append(small);
    }
    group.append(heading);

    const operatorRows = rows.filter(
      (row) => row.operatorId === assignment.operatorId,
    );
    if (!operatorRows.length) {
      const empty = document.createElement("p");
      empty.className = "geography-empty geography-empty-operator";
      empty.textContent = "Brak geografii dla tego operatora.";
      group.append(empty);
    } else {
      for (const row of operatorRows) {
        group.append(geographyRowCard(object, row));
      }
    }
    root.append(group);
  }

  const unassigned = rows.filter(
    (row) =>
      !row.operatorId ||
      !assignments.some((assignment) => assignment.operatorId === row.operatorId),
  );
  if (unassigned.length) {
    const group = document.createElement("section");
    group.className = "geography-operator-group geography-operator-group-warning";
    const heading = document.createElement("div");
    heading.className = "geography-operator-heading";
    const title = document.createElement("strong");
    title.textContent = "Nieprzypisana geografia:";
    heading.append(title);
    group.append(heading);
    for (const row of unassigned) group.append(geographyRowCard(object, row));
    root.append(group);
  }
}

function renderSearch(object: LegacyStoredObject): void {
  const operatorId = renderGeographyOperatorSelect(object);
  const type = $("geography-type") as HTMLSelectElement;
  const role = $("geography-role") as HTMLSelectElement;
  const search = $("geography-search") as HTMLInputElement;
  const results = $("geography-results");
  const help = $("geography-help");
  const matches = matchingCatalog(type.value, search.value);

  results.replaceChildren();
  if (!operatorId) {
    help.textContent =
      object.type === "project"
        ? "Najpierw przypisz co najmniej jednego operatora do projektu."
        : "Najpierw przypisz co najmniej jednego operatora do naboru.";
    results.replaceChildren();
    return;
  }
  help.textContent = search.value
    ? `${matches.length}${matches.length === 20 ? "+" : ""} wyników`
    : "Wpisz nazwę albo wybierz z listy.";

  for (const entry of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "geography-result";

    const title = document.createElement("strong");
    title.textContent = entry.label;
    const meta = document.createElement("small");
    meta.textContent = [
      BurbotGeography.types[entry.type] ?? entry.type,
      entry.context,
    ]
      .filter(Boolean)
      .join(" · ");
    button.append(title, meta);

    button.onclick = () => {
      const addPanel = $("geography-add");
      const beforeTop = addPanel.getBoundingClientRect().top;
      void data("ADD_GEOGRAPHY", {
        objectId: object.id,
        geographyType: entry.type,
        geographyRole: role.value,
        value: entry.value,
        operatorId,
      })
        .then(() => {
          search.value = "";
          scheduleGeographyUiPersist();
          notice(`Dodano: ${BurbotGeography.roles[role.value]} ${entry.label}.`);
          render();
          keepControlInPlace(addPanel, beforeTop, search);
        })
        .catch((error: unknown) =>
          notice(error instanceof Error ? error.message : String(error), true),
        );
    };

    results.append(button);
  }
}

function render(): void {
  renderQueued = false;
  const section = $("geography-section");
  const object = chosenObject();
  const enabled = !!object && !!BurbotSchema[object.type]?.geography;
  section.hidden = !enabled;
  if (!object || !enabled) return;
  if (!(document.getElementById("geography-panel") as HTMLDetailsElement).open) return;

  const subtitle = $("geography-subtitle");
  subtitle.textContent =
    object.type === "recruitment"
      ? "Zakres terytorialny naboru osobno dla każdego operatora"
      : "Zakres terytorialny projektu osobno dla każdego operatora";

  const count = (state.geographies ?? []).filter(
    (row) => row.objectId === object.id,
  ).length;
  $("geography-count").textContent = count
    ? `${count} ${count === 1 ? "warunek" : "warunków"}`
    : "Brak zakresu";

  renderInheritance(object);
  renderRows(object);
  renderSearch(object);
}

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { if (renderQueued) render(); });
}

function populateSelectors(): void {
  const role = $("geography-role") as HTMLSelectElement;
  role.replaceChildren(
    ...Object.entries(BurbotGeography.roles).map(
      ([value, label]) => new Option(label, value),
    ),
  );

  const type = $("geography-type") as HTMLSelectElement;
  type.replaceChildren(
    ...Object.entries(BurbotGeography.types).map(
      ([value, label]) => new Option(label, value),
    ),
  );

  type.value = "WOJEWODZTWO";
  role.value = "OBEJMUJE";
  type.onchange = () => {
    scheduleGeographyUiPersist();
    queueRender();
  };
  role.onchange = () => {
    scheduleGeographyUiPersist();
    queueRender();
  };
  ($("geography-search") as HTMLInputElement).oninput = () => {
    scheduleGeographyUiPersist();
    queueRender();
  };
  ($("geography-operator") as HTMLSelectElement).onchange = () => {
    queueRender();
  };
  ($("geography-inherit-operator") as HTMLSelectElement).onchange = () => {
    queueRender();
  };
  ($("geography-inherit-button") as HTMLButtonElement).onclick = () => {
    const object = chosenObject();
    const operatorId = (
      $("geography-inherit-operator") as HTMLSelectElement
    ).value;
    if (!object || object.type !== "recruitment") {
      notice("Wybierz nabór.", true);
      return;
    }
    if (!operatorId) {
      notice("Najpierw wybierz operatora.", true);
      return;
    }

    void data("INHERIT_PROJECT_GEOGRAPHY", {
      objectId: object.id,
      operatorId,
    })
      .then(() => {
        notice(
          "Skopiowano geografię projektu do naboru. Kopie są niezależne od projektu.",
        );
        render();
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };
}

export async function initGeographyUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  populateSelectors();

  const currentWindow = await browser.windows.getCurrent();
  if (currentWindow.id !== undefined) {
    uiWindowId = currentWindow.id;
    const uiState = await readSidepanelUiState(currentWindow.id);
    const role = $("geography-role") as HTMLSelectElement;
    const type = $("geography-type") as HTMLSelectElement;
    const search = $("geography-search") as HTMLInputElement;
    const add = $("geography-add") as HTMLDetailsElement;
    const saved = uiState.workspace.geography;

    if (Array.from(role.options).some((option) => option.value === saved.role)) {
      role.value = saved.role;
    }
    if (Array.from(type.options).some((option) => option.value === saved.type)) {
      type.value = saved.type;
    }
    search.value = saved.query;
    add.open = saved.addOpen;
    add.addEventListener("toggle", scheduleGeographyUiPersist);
  }

  state = await data("GET");
  await refreshActivePage();

  const observer = new MutationObserver(queueRender);
  observer.observe($("connection"), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId !== uiWindowId) return;
    void refreshActivePage().then(queueRender).catch(() => undefined);
  });
  browser.tabs.onUpdated.addListener((_id, change, tab) => {
    if (!tab?.active || tab.windowId !== uiWindowId) return;
    if (change.url || change.status === "complete")
      void refreshActivePage().then(queueRender).catch(() => undefined);
  });

  $("geography-panel").addEventListener("toggle", queueRender);
  window.addEventListener("burbot:active-object-changed", queueRender);
  window.addEventListener("burbot:workspace-state-changed", (event) => {
    const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail?.state;
    if (next) state = next;
    queueRender();
  });
  window.addEventListener("pagehide", persistGeographyUi);
  state = await readWorkspaceState();
  render();
}
