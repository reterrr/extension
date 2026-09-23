import { selectorColor } from "../shared/selectorPalette";
import {
  buildStoredSelectorHighlights,
  sameSelectorPage,
} from "../shared/selectorHighlights.js";
import type { SelectorHighlight } from "../shared/messaging/picker";
import type {
  LegacyStorageState,
  LegacyStoredFieldEvidence,
  LegacyStoredObject,
  LegacyStoredRule,
} from "../shared/types/legacy-storage";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;
let activePageUrl = "";
let syncQueued = false;

type PendingSelectorPreview = {
  objectId: string;
  field: string;
  targetKey: string;
  pageUrl: string;
  highlight: SelectorHighlight;
};

let pendingPreview: PendingSelectorPreview | null = null;

async function data(): Promise<LegacyStorageState> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op: "GET",
    expectedRevision: state.revision,
  })) as { ok?: boolean; value?: LegacyStorageState };

  if (!response?.ok || !response.value) throw new Error("Storage is unavailable.");
  state = response.value;
  return state;
}

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const currentWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({ active: true, windowId: currentWindow.id });
  return tabs[0];
}

function workspacePageUrl(): string {
  const connection = document.getElementById("connection")?.textContent ?? "";
  return connection.includes("· connected") ? activePageUrl : "";
}

function comparablePageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return value;
  }
}

function samePage(left: string, right: string): boolean {
  return sameSelectorPage(left, right);
}

function isLocal(object: LegacyStoredObject, pageUrl: string): boolean {
  return (
    !!pageUrl &&
    (samePage(object.sourceUrl ?? "", pageUrl) ||
      state.rules.some(
        (rule) => rule.objectId === object.id && samePage(rule.pageUrl, pageUrl),
      ) ||
      (state.fieldEvidence ?? []).some(
        (entry) =>
          entry.objectId === object.id && samePage(entry.pageUrl, pageUrl),
      ))
  );
}

function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("object-options")?.dataset.activeObjectId ?? "";
  return (
    state.objects.find((object) => object.id === activeId) ??
    state.objects.at(-1)
  );
}

function selectorRules(object: LegacyStoredObject | undefined): LegacyStoredRule[] {
  if (!object) return [];
  return state.rules.filter((rule) => rule.objectId === object.id && samePage(rule.pageUrl, activePageUrl) && typeof rule.selector === "string" && rule.selector.length > 0);
}

function ruleTargetKey(rule: LegacyStoredRule): string {
  return BurbotCore.targetKey(rule.target);
}

function evidenceTargetKey(entry: LegacyStoredFieldEvidence): string {
  return BurbotCore.targetKey(entry.target);
}

function selectorEvidence(
  object: LegacyStoredObject | undefined,
): LegacyStoredFieldEvidence[] {
  if (!object) return [];
  return (state.fieldEvidence ?? []).filter(
    (entry) =>
      entry.objectId === object.id &&
      samePage(entry.pageUrl, activePageUrl) &&
      typeof entry.selector === "string" &&
      entry.selector.length > 0,
  );
}

function matchingEvidence(
  object: LegacyStoredObject,
  field: string,
  targetKey: string,
): LegacyStoredFieldEvidence | undefined {
  return (state.fieldEvidence ?? []).find(
    (entry) =>
      entry.objectId === object.id &&
      entry.field === field &&
      evidenceTargetKey(entry) === targetKey &&
      typeof entry.selector === "string" &&
      entry.selector.length > 0,
  );
}

function matchingRule(object: LegacyStoredObject, field: string, targetKey: string): LegacyStoredRule | undefined {
  return state.rules.find((rule) => rule.objectId === object.id && rule.field === field && ruleTargetKey(rule) === targetKey && typeof rule.selector === "string" && rule.selector.length > 0);
}

function ruleFallbacks(rule: LegacyStoredRule): string[] {
  if (rule.selectorFallbacks?.length) return rule.selectorFallbacks;
  if (rule.extraction.type === "text" || rule.extraction.type === "selection" || rule.extraction.type === "attribute") return rule.extraction.selectorFallbacks ?? [];
  return [];
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
    const previewSelector =
      pendingPreview &&
      pendingPreview.objectId === object.id &&
      pendingPreview.field === field &&
      pendingPreview.targetKey === target
        ? pendingPreview.highlight.selector
        : null;
    const rule = matchingRule(object, field, target);
    const evidence = matchingEvidence(object, field, target);
    if (previewSelector) setSelectorVariables(row, previewSelector);
    else if (rule && typeof rule.selector === "string")
      setSelectorVariables(row, rule.selector);
    else if (evidence && typeof evidence.selector === "string")
      setSelectorVariables(row, evidence.selector);
  }
  const details = document.getElementById("rule-details");
  if (!(details instanceof HTMLElement)) return;
  clearSelectorVariables(details);
  const selected = document.querySelector<HTMLElement>(".field-row.selected");
  if (!selected || !object || !selected.dataset.field) return;
  const selectedTarget = selected.dataset.target ?? "";
  const previewSelector =
    pendingPreview &&
    pendingPreview.objectId === object.id &&
    pendingPreview.field === selected.dataset.field &&
    pendingPreview.targetKey === selectedTarget
      ? pendingPreview.highlight.selector
      : null;
  const rule = matchingRule(object, selected.dataset.field, selectedTarget);
  const evidence = matchingEvidence(
    object,
    selected.dataset.field,
    selectedTarget,
  );
  if (previewSelector) setSelectorVariables(details, previewSelector);
  else if (rule && typeof rule.selector === "string")
    setSelectorVariables(details, rule.selector);
  else if (evidence && typeof evidence.selector === "string")
    setSelectorVariables(details, evidence.selector);
}

async function renderPageHighlights(
  tabId: number,
  highlights: SelectorHighlight[],
): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS",
      highlights,
    });
    return;
  } catch {
    // Inject lazily if the persistent runtime is not present yet.
  }

  await browser.scripting.executeScript({
    target: { tabId },
    files: ["selector-highlights.js"],
  });
  await browser.tabs.sendMessage(tabId, {
    type: "BURBOT_SHOW_SELECTOR_HIGHLIGHTS",
    highlights,
  });
}

async function syncPage(): Promise<void> {
  const tab = await activeTab();
  activePageUrl = tab?.url ?? "";
  colorSidebar();
  let protocol = "";
  try { protocol = new URL(activePageUrl).protocol; } catch {}
  if (!tab || tab.id === undefined || !["http:", "https:"].includes(protocol)) return;

  const highlights: SelectorHighlight[] = buildStoredSelectorHighlights(
    state,
    activePageUrl,
  );
  if (
    pendingPreview &&
    samePage(pendingPreview.pageUrl, activePageUrl)
  ) {
    highlights.push(pendingPreview.highlight);
  }

  try { await renderPageHighlights(tab.id, highlights); } catch {}
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => { syncQueued = false; void syncPage(); });
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
    observer.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "hidden"] });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".field-row, #object-options button")) queueSync();
  }, true);
  window.addEventListener("burbot:selector-highlights-refresh", queueSync);
  window.addEventListener("burbot:workspace-state-changed", (event) => {
    const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail?.state;
    if (!next || !Array.isArray(next.objects) || !Array.isArray(next.rules)) return;
    state = next;
    queueSync();
  });
  window.addEventListener("burbot:selector-capture-preview", (event) => {
    pendingPreview =
      (event as CustomEvent<PendingSelectorPreview | null>).detail ?? null;
    queueSync();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    queueSync();
  });
  browser.tabs.onActivated.addListener(queueSync);
  browser.tabs.onUpdated.addListener((_tabId, change) => { if (change.url || change.status === "complete") queueSync(); });
  await syncPage();
}
