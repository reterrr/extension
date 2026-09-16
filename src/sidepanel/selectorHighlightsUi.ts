import { selectorColor } from "../shared/selectorPalette";
import type {
  LegacyStorageState,
  LegacyStoredObject,
  LegacyStoredRule,
} from "../shared/types/legacy-storage";
import type { SelectorHighlight } from "../shared/messaging/picker";
import { createPickerClient, type PickerClient } from "./pickerRpc";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let client: PickerClient | null = null;
let port: browser.runtime.Port | null = null;
let connectedTabId: number | null = null;
let syncQueued = false;

async function data(): Promise<LegacyStorageState> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op: "GET",
    expectedRevision: state.revision,
  })) as { ok?: boolean; value?: LegacyStorageState };

  if (!response?.ok || !response.value) {
    throw new Error("Storage is unavailable.");
  }
  state = response.value;
  return state;
}

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({
    active: true,
    windowId: currentWindow.id,
  });
  return tabs[0];
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

/** Mirrors workspace.js object-switcher ordering while objectId is still private there. */
function chosenObject(): LegacyStoredObject | undefined {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#object-options button"),
  );
  const activeIndex = buttons.findIndex(
    (button) => button.getAttribute("aria-current") === "true",
  );
  if (activeIndex < 0) return state.objects.at(-1);

  const pageUrl = workspacePageUrl();
  const local = state.objects.filter((object) => isLocal(object, pageUrl));
  const saved = state.objects.filter((object) => !isLocal(object, pageUrl));
  return [...local].reverse().concat([...saved].reverse())[activeIndex];
}

function selectorRules(object: LegacyStoredObject | undefined): LegacyStoredRule[] {
  if (!object) return [];
  return state.rules.filter(
    (rule) =>
      rule.objectId === object.id &&
      rule.pageUrl === activePageUrl &&
      typeof rule.selector === "string" &&
      rule.selector.length > 0,
  );
}

function ruleTargetKey(rule: LegacyStoredRule): string {
  return BurbotCore.targetKey(rule.target);
}

function matchingRule(
  object: LegacyStoredObject,
  field: string,
  targetKey: string,
): LegacyStoredRule | undefined {
  return state.rules.find(
    (rule) =>
      rule.objectId === object.id &&
      rule.field === field &&
      ruleTargetKey(rule) === targetKey &&
      typeof rule.selector === "string" &&
      rule.selector.length > 0,
  );
}

function setSelectorVariables(element: HTMLElement, selector: string): void {
  const color = selectorColor(selector);
  element.classList.add("has-selector-color");
  element.style.setProperty("--selector-border", color.border);
  element.style.setProperty("--selector-soft", color.soft);
}

function clearSelectorVariables(element: HTMLElement): void {
  element.classList.remove("has-selector-color");
  element.style.removeProperty("--selector-border");
  element.style.removeProperty("--selector-soft");
}

function colorSidebar(): void {
  const object = chosenObject();
  const rows = document.querySelectorAll<HTMLElement>(".field-row");

  for (const row of rows) {
    clearSelectorVariables(row);
    if (!object) continue;

    const field = row.dataset.field;
    const target = row.dataset.target ?? "";
    if (!field) continue;

    const rule = matchingRule(object, field, target);
    if (rule && typeof rule.selector === "string") {
      setSelectorVariables(row, rule.selector);
    }
  }

  const details = document.getElementById("rule-details");
  if (!(details instanceof HTMLElement)) return;
  clearSelectorVariables(details);

  const selected = document.querySelector<HTMLElement>(".field-row.selected");
  if (!selected || !object || !selected.dataset.field) return;
  const rule = matchingRule(
    object,
    selected.dataset.field,
    selected.dataset.target ?? "",
  );
  if (rule && typeof rule.selector === "string") {
    setSelectorVariables(details, rule.selector);
  }
}

function disconnect(): void {
  client?.dispose();
  client = null;
  try {
    port?.disconnect();
  } catch {
    // Already disconnected.
  }
  port = null;
  connectedTabId = null;
}

async function ensureClient(tab: browser.tabs.Tab): Promise<PickerClient> {
  if (tab.id === undefined) throw new Error("Active tab cannot be connected.");
  if (client && connectedTabId === tab.id) return client;

  disconnect();
  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["core.js", "picker.js"],
  });

  port = browser.tabs.connect(tab.id, {
    name: "burbot-selector-highlights",
    frameId: 0,
  });
  connectedTabId = tab.id;
  client = createPickerClient(port, () => undefined);
  port.onDisconnect.addListener(() => {
    client = null;
    port = null;
    connectedTabId = null;
  });
  return client;
}

async function syncPage(): Promise<void> {
  colorSidebar();

  const tab = await activeTab();
  activePageUrl = tab?.url ?? "";
  const protocol = (() => {
    try {
      return new URL(activePageUrl).protocol;
    } catch {
      return "";
    }
  })();

  if (!tab || tab.id === undefined || !["http:", "https:"].includes(protocol)) {
    disconnect();
    return;
  }

  const object = chosenObject();
  const rules = selectorRules(object);
  const highlights: SelectorHighlight[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (typeof rule.selector !== "string" || seen.has(rule.selector)) continue;
    seen.add(rule.selector);
    highlights.push({ id: String(rule.id), selector: rule.selector });
  }

  if (!highlights.length && !client) return;

  try {
    const pageClient = await ensureClient(tab);
    await pageClient.request("SHOW_SELECTORS", { highlights });
  } catch {
    disconnect();
  }
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    void syncPage();
  });
}

export async function initSelectorHighlightsUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await data();
  const tab = await activeTab();
  activePageUrl = tab?.url ?? "";

  const workspace = document.getElementById("workspace");
  if (workspace) {
    const observer = new MutationObserver(queueSync);
    observer.observe(workspace, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current", "hidden"],
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".field-row, #object-options button")) {
        queueMicrotask(colorSidebar);
      }
    },
    true,
  );

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    queueSync();
  });

  browser.tabs.onActivated.addListener(queueSync);
  browser.tabs.onUpdated.addListener((_tabId, change) => {
    if (change.url || change.status === "complete") queueSync();
  });

  window.addEventListener("pagehide", disconnect);
  await syncPage();
}
