import { createCapturedExtractionInput } from "../shared/extraction/rules";
import { isPickerSelectionResponse } from "../shared/messaging/picker";
import type {
  LegacyStorageState,
  LegacyStoredGeography,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let renderQueued = false;

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

async function data(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<LegacyStorageState> {
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
  const connection = document.getElementById("connection")?.textContent ?? "";
  return connection.includes("· connected") ? activePageUrl : "";
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

/** Mirrors workspace.js switcher ordering to resolve its private objectId. */
function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("object-options")?.dataset.activeObjectId ?? "";
  return (
    state.objects.find((object) => object.id === activeId) ??
    state.objects.at(-1)
  );
}

function geographyLabel(value: string): string {
  return BurbotGeography.catalog.find((entry) => entry.value === value)?.label ?? value;
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

function renderRows(object: LegacyStoredObject): void {
  const root = $("geography-list");
  root.replaceChildren();

  const rows = (state.geographies ?? []).filter(
    (row) => row.objectId === object.id,
  );

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "geography-empty";
    empty.textContent = "Brak ograniczeń geograficznych.";
    root.append(empty);
    return;
  }

  for (const row of rows) {
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
    root.append(card);
  }
}

function renderSearch(object: LegacyStoredObject): void {
  const type = $("geography-type") as HTMLSelectElement;
  const role = $("geography-role") as HTMLSelectElement;
  const search = $("geography-search") as HTMLInputElement;
  const results = $("geography-results");
  const help = $("geography-help");
  const matches = matchingCatalog(type.value, search.value);

  results.replaceChildren();
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
      })
        .then(() => {
          search.value = "";
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

  renderRows(object);
  renderSearch(object);
}

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(render);
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
  type.onchange = queueRender;
  role.onchange = queueRender;
  ($("geography-search") as HTMLInputElement).oninput = queueRender;
}

export async function initGeographyUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  populateSelectors();
  state = await data("GET");
  await refreshActivePage();

  const observer = new MutationObserver(queueRender);
  observer.observe($("object-options"), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current"],
  });
  observer.observe($("connection"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  observer.observe($("object-title"), {
    childList: true,
    subtree: true,
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    queueRender();
  });

  browser.tabs.onActivated.addListener(() => {
    void refreshActivePage().then(queueRender).catch(() => undefined);
  });
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.url || change.status === "complete")
      void refreshActivePage().then(queueRender).catch(() => undefined);
  });

  render();
}
