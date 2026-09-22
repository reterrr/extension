import { publishUiState } from "../shared/api/storage";
import {
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import {
  createCapturedExtractionInput,
  createPageUrlCandidate,
} from "../shared/extraction/rules";
import {
  buildImportApprovalPlan,
  importReviewView,
  markImportObjectApproved,
  markImportObjectLinked,
} from "../shared/import/review";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import {
  stageImportReviewObject,
  type ImportApprovalPlanWithRules,
  type ReviewedImportRule,
} from "../shared/import/stageReview";
import type { ImportReviewSession } from "../shared/types/importReview";
import type { LegacyStoredObject, LegacyStoredRule } from "../shared/types/legacy-storage";
import type { ExtractionCandidate } from "../shared/types/picker";
import { createPickerClient, type PickerClient } from "./pickerRpc";

type ReviewTarget = { kind: "funding"; id: string };

interface ActiveField {
  objectId: string;
  field: string;
  label: string;
  context: string;
  target?: ReviewTarget;
}

let session: ImportReviewSession | null = null;
let active: ActiveField | null = null;
let candidate: ExtractionCandidate | null = null;
let methodIndex = 0;
let draft: unknown = "";
let draftKey = "";
let port: browser.runtime.Port | null = null;
let pickerClient: PickerClient | null = null;
let pickerTabId: number | null = null;
let generation = 0;
let picking = false;
let pageUrl = "";
let approving = false;
let syncQueued = false;
let syncing = false;

const observer = new MutationObserver(() => queueSync());

function targetKey(target?: ReviewTarget): string {
  return target ? `${target.kind}:${target.id}` : "object";
}

function activeKey(value = active): string {
  return value ? `${value.objectId}/${targetKey(value.target)}/${value.field}` : "";
}

function selectedObject(current = session): LegacyStoredObject | undefined {
  if (!current?.selectedObjectId) return undefined;
  return current.previewState.objects.find(
    (object) => object.id === current.selectedObjectId,
  );
}

function fieldInfo(current = session, descriptor = active) {
  if (!current || !descriptor) return null;
  const object = current.previewState.objects.find(
    (entry) => entry.id === descriptor.objectId,
  );
  if (!object) return null;
  try {
    return {
      object,
      ...BurbotCore.fieldContext(
        current.previewState,
        object,
        descriptor.field,
        descriptor.target,
      ),
    };
  } catch {
    return null;
  }
}

function notice(message: string, error = false): void {
  let root = document.getElementById("import-review-capture-notice");
  if (!root) {
    root = document.createElement("p");
    root.id = "import-review-capture-notice";
    document.querySelector(".import-review-detail")?.append(root);
  }
  root.textContent = message;
  root.className = error ? "error" : "";
}

function clearImportedEvidence(
  current: ImportReviewSession,
  objectId: string,
  field: string,
  target?: ReviewTarget,
): void {
  if (target) return;
  const object = current.previewState.objects.find((entry) => entry.id === objectId);
  if (!object?.evidence?.[field]) return;
  delete object.evidence[field];
  if (!Object.keys(object.evidence).length) delete object.evidence;
}

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const currentWindow = await browser.windows.getCurrent();
  const [tab] = await browser.tabs.query({
    active: true,
    windowId: currentWindow.id,
  });
  return tab;
}

function disconnectPicker(): void {
  generation++;
  const client = pickerClient;
  const connectedPort = port;
  pickerClient = null;
  port = null;
  pickerTabId = null;
  pageUrl = "";
  picking = false;
  client?.dispose(new Error("Page connection changed. Try again."));
  try {
    connectedPort?.disconnect();
  } catch {
    // Already disconnected.
  }
}

function acceptCandidate(next: ExtractionCandidate): void {
  if (!active || !session) return;
  const info = fieldInfo();
  if (!info) return;
  candidate = next;
  methodIndex = 0;
  if (info.definition.type === "url") {
    const href = next.options.findIndex(
      (option) =>
        option.extraction.type === "attribute" &&
        option.extraction.attribute === "href",
    );
    if (href >= 0) methodIndex = href;
  }
  updateDraftFromCandidate();
  notice("Sprawdź wartość i zapisz regułę ekstrakcji.");
  queueSync();
}

function updateDraftFromCandidate(): void {
  const info = fieldInfo();
  if (!candidate || !info) return;
  const raw = candidate.options[methodIndex]?.raw ?? "";
  try {
    draft = BurbotCore.coerceField(raw, info.definition, session!.previewState);
  } catch {
    draft = ["enum", "reference", "boolean", "date"].includes(
      info.definition.type,
    )
      ? ""
      : raw;
  }
}

async function ensurePicker(): Promise<PickerClient> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error("Otwórz stronę HTTP(S), z której chcesz wydzielać dane.");
  }
  if (pickerClient && pickerTabId === tab.id) return pickerClient;

  disconnectPicker();
  const token = generation;
  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["core.js", "picker.js"],
  });
  if (token !== generation) throw new Error("Page connection changed.");

  const connectedPort = browser.tabs.connect(tab.id, {
    name: "burbot-picker",
    frameId: 0,
  });
  const client = createPickerClient(connectedPort, (event) => {
    if (token !== generation) return;
    if (event.event === "CAPTURE") acceptCandidate(event.candidate);
    else if (event.event === "ERROR") notice(event.error, true);
    else if (event.event === "MODE") {
      picking = event.picking;
      queueSync();
    }
  });

  port = connectedPort;
  pickerClient = client;
  pickerTabId = tab.id;
  connectedPort.onDisconnect.addListener(() => {
    if (port !== connectedPort) return;
    disconnectPicker();
    queueSync();
  });
  pageUrl = await client.request("URL");
  queueSync();
  return client;
}

function currentRule(): LegacyStoredRule | undefined {
  if (!session || !active) return undefined;
  return session.previewState.rules.find((rule) =>
    BurbotCore.matches(
      rule,
      active!.objectId,
      active!.field,
      active!.target,
    ),
  );
}

function resetDraft(): void {
  const info = fieldInfo();
  draftKey = activeKey();
  candidate = null;
  methodIndex = 0;
  draft = info?.values[active!.field] ?? "";
}

async function persistActiveValue(): Promise<void> {
  if (!session || !active) return;
  const info = fieldInfo();
  if (!info) throw new Error("Pole nie jest już dostępne.");
  const now = new Date().toISOString();
  const message: Record<string, unknown> = {
    op: candidate ? "ASSIGN" : "EDIT",
    expectedRevision: session.previewState.revision,
    objectId: active.objectId,
    field: active.field,
    ...(active.target ? { target: active.target } : {}),
    value: draft,
  };

  if (candidate) {
    const option = candidate.options[methodIndex];
    if (!option) throw new Error("Wybierz metodę odczytu ze strony.");
    const client = await ensurePicker();
    if ((await client.request("URL")) !== candidate.pageUrl) {
      throw new Error("Strona zmieniła się. Wydziel wartość ponownie.");
    }
    message.candidate = createCapturedExtractionInput(candidate, option);
  }

  session.previewState = BurbotCore.mutate(
    session.previewState,
    message,
    () => crypto.randomUUID(),
    now,
  );
  clearImportedEvidence(session, active.objectId, active.field, active.target);
  session.updatedAt = now;
  await writeImportReview(session);
  resetDraft();
  window.dispatchEvent(
    new CustomEvent("burbot:import-review-changed", { detail: { open: true } }),
  );
  notice(candidate ? "Reguła zapisana." : "Wartość zapisana.");
  queueSync();
}

function createEditor(info: NonNullable<ReturnType<typeof fieldInfo>>): HTMLElement {
  const definition = info.definition;
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  if (["enum", "reference"].includes(definition.type)) {
    const select = document.createElement("select");
    select.append(new Option("Wybierz…", ""));
    const options =
      definition.type === "enum"
        ? Object.entries(definition.options ?? {})
        : session!.previewState.objects
            .filter((object) => object.type === definition.references)
            .map((object) => [object.id, BurbotCore.displayName(object)] as const);
    for (const [value, label] of options) {
      select.append(new Option(String(label), String(value)));
    }
    select.value = String(draft ?? "");
    input = select;
  } else if (definition.type === "boolean") {
    const select = document.createElement("select");
    select.append(
      new Option("Wybierz…", ""),
      new Option("Tak", "true"),
      new Option("Nie", "false"),
    );
    select.value = draft === true ? "true" : draft === false ? "false" : "";
    input = select;
  } else if (definition.multiline) {
    const textarea = document.createElement("textarea");
    textarea.value = String(draft ?? "");
    input = textarea;
  } else {
    const valueInput = document.createElement("input");
    valueInput.type =
      definition.type === "date"
        ? "date"
        : definition.type === "url"
          ? "url"
          : ["integer", "money", "percentage", "number"].includes(
                definition.type,
              )
            ? "number"
            : "text";
    if (valueInput.type === "number") valueInput.step = definition.type === "integer" ? "1" : "any";
    valueInput.value = String(draft ?? "");
    input = valueInput;
  }

  input.className = "import-review-capture-input";
  input.addEventListener("input", () => {
    if (definition.type === "boolean") {
      draft = input.value === "true" ? true : input.value === "false" ? false : "";
    } else {
      draft = input.value;
    }
    updateValidationHint();
  });
  return input;
}

function updateValidationHint(): void {
  const hint = document.getElementById("import-review-capture-converted");
  const save = document.getElementById(
    "import-review-capture-save",
  ) as HTMLButtonElement | null;
  const info = fieldInfo();
  if (!hint || !save || !info || !session) return;
  try {
    const value = BurbotCore.coerceField(draft, info.definition, session.previewState);
    hint.textContent = candidate
      ? `Zapisz jako ${BurbotCore.formatValue(value, info.definition, session.previewState)}`
      : currentRule()
        ? "Ręczna korekta zachowa istniejącą regułę ekstrakcji."
        : "Wartość ręczna. Użyj Pick, aby zapisać regułę ekstrakcji.";
    save.disabled = false;
  } catch (error) {
    hint.textContent = error instanceof Error ? error.message : String(error);
    save.disabled = true;
  }
}

function renderCaptureDock(): void {
  document.getElementById("import-review-capture-area")?.remove();
  if (!session || !active || !document.documentElement.classList.contains("import-review-mode")) return;
  const object = session.previewState.objects.find((entry) => entry.id === active!.objectId);
  if (!object || session.statusByObjectId[object.id] === "STAGED") return;
  const info = fieldInfo();
  const detail = document.querySelector(".import-review-detail");
  if (!info || !detail) return;

  if (draftKey !== activeKey()) resetDraft();

  const dock = document.createElement("section");
  dock.id = "import-review-capture-area";
  dock.className = "capture-area import-review-capture-area";
  dock.innerHTML = `
    <div class="capture-heading">
      <span><small>WYDZIELANIE</small><strong></strong><span class="muted"></span></span>
      <span class="capture-heading-actions"><button class="icon-button import-review-capture-close" type="button" aria-label="Zamknij wydzielanie">×</button></span>
    </div>
    <div class="capture-tools">
      <button type="button" class="import-review-pick">${picking ? "Anuluj picker" : "Wybierz element"}</button>
      <button type="button" class="import-review-selection">Użyj zaznaczenia</button>
      <button type="button" class="import-review-page-url">Użyj URL strony</button>
    </div>
    <div class="import-review-capture-source" ${candidate ? "" : "hidden"}>
      <label>Odczytaj ze strony</label><select></select><div class="source-sample"></div>
    </div>
    <label>Wartość</label>
    <div class="import-review-capture-value"></div>
    <p id="import-review-capture-converted" class="hint"></p>
    <button id="import-review-capture-save" type="button" class="primary">${candidate ? "Zapisz regułę" : "Zapisz wartość"}</button>
    <details class="import-review-capture-rule"><summary>Szczegóły reguły</summary><pre></pre></details>
  `;
  dock.querySelector(".capture-heading strong")!.textContent = active.label;
  dock.querySelector(".capture-heading .muted")!.textContent = active.context;

  const source = dock.querySelector(".import-review-capture-source") as HTMLElement;
  const method = source.querySelector("select")!;
  const sample = source.querySelector(".source-sample")!;
  if (candidate) {
    candidate.options.forEach((option, index) =>
      method.append(new Option(option.label, String(index))),
    );
    method.value = String(methodIndex);
    sample.textContent = candidate.options[methodIndex]?.raw ?? "";
    method.addEventListener("change", () => {
      methodIndex = Number(method.value);
      updateDraftFromCandidate();
      renderCaptureDock();
    });
  }

  dock.querySelector(".import-review-capture-value")!.append(createEditor(info));
  const rule = currentRule();
  const ruleDetails = dock.querySelector(".import-review-capture-rule") as HTMLDetailsElement;
  ruleDetails.hidden = !candidate && !rule;
  ruleDetails.querySelector("pre")!.textContent = JSON.stringify(
    candidate
      ? {
          pageUrl: candidate.pageUrl,
          selector: candidate.selector,
          extraction: candidate.options[methodIndex]?.extraction,
        }
      : rule,
    null,
    2,
  );

  dock.querySelector(".import-review-capture-close")!.addEventListener("click", () => {
    if (picking) void pickerClient?.request("STOP").catch(() => undefined);
    active = null;
    candidate = null;
    draftKey = "";
    queueSync();
  });
  dock.querySelector(".import-review-pick")!.addEventListener("click", () => {
    void (async () => {
      try {
        const client = await ensurePicker();
        await client.request(picking ? "STOP" : "PICK");
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error), true);
      }
    })();
  });
  dock.querySelector(".import-review-selection")!.addEventListener("click", () => {
    void ensurePicker()
      .then((client) => client.request("SELECTION"))
      .then(acceptCandidate)
      .catch((error) => notice(error instanceof Error ? error.message : String(error), true));
  });
  dock.querySelector(".import-review-page-url")!.addEventListener("click", () => {
    void ensurePicker()
      .then((client) => client.request("URL"))
      .then((url) => acceptCandidate(createPageUrlCandidate(url)))
      .catch((error) => notice(error instanceof Error ? error.message : String(error), true));
  });
  dock.querySelector("#import-review-capture-save")!.addEventListener("click", () => {
    void persistActiveValue().catch((error) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
  });

  detail.append(dock);
  updateValidationHint();
}

function annotateReviewFields(): void {
  if (!session) return;
  const view = importReviewView(session);
  const selected = selectedObject();
  if (!selected) return;

  const objectRows = Array.from(
    document.querySelectorAll<HTMLElement>(".import-review-fields > div"),
  );
  objectRows.forEach((row, index) => {
    const field = view.fields[index];
    if (!field) return;
    row.dataset.reviewObjectId = selected.id;
    row.dataset.reviewField = field.field;
    row.dataset.reviewLabel = field.label;
    row.dataset.reviewContext = "Dane obiektu";
    row.dataset.reviewTargetKind = "object";
    row.classList.add("import-review-workspace-field");
    let display = row.querySelector<HTMLElement>(".import-review-workspace-value");
    if (!display) {
      display = document.createElement("strong");
      display.className = "import-review-workspace-value";
      row.querySelector(".import-review-field-head")?.after(display);
    }
    display.textContent = field.value;
  });

  const financeCards = Array.from(
    document.querySelectorAll<HTMLElement>(".import-review-finance-card"),
  );
  financeCards.forEach((card, variantIndex) => {
    const variant = view.financing[variantIndex];
    if (!variant) return;
    const rows = Array.from(
      card.querySelectorAll<HTMLElement>(".import-review-finance-fields > label"),
    );
    rows.forEach((row, fieldIndex) => {
      const field = variant.fields[fieldIndex];
      if (!field) return;
      row.dataset.reviewObjectId = selected.id;
      row.dataset.reviewField = field.field;
      row.dataset.reviewLabel = field.label;
      row.dataset.reviewContext = `${variant.companySizeLabel} · wariant ${variant.variantNo}`;
      row.dataset.reviewTargetKind = "funding";
      row.dataset.reviewTargetId = variant.id;
      row.classList.add("import-review-workspace-field");
      let display = row.querySelector<HTMLElement>(".import-review-workspace-value");
      if (!display) {
        display = document.createElement("strong");
        display.className = "import-review-workspace-value";
        row.querySelector("small")?.after(display);
      }
      display.textContent = field.value || "Nie ustawiono";
    });
  });

  const current = activeKey();
  for (const row of document.querySelectorAll<HTMLElement>("[data-review-field]")) {
    const descriptor: ActiveField = {
      objectId: row.dataset.reviewObjectId!,
      field: row.dataset.reviewField!,
      label: row.dataset.reviewLabel || row.dataset.reviewField!,
      context: row.dataset.reviewContext || "",
      ...(row.dataset.reviewTargetKind === "funding" && row.dataset.reviewTargetId
        ? { target: { kind: "funding", id: row.dataset.reviewTargetId } as ReviewTarget }
        : {}),
    };
    row.classList.toggle("selected", activeKey(descriptor) === current);
  }
}

async function sync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  observer.disconnect();
  try {
    const reviewing = document.documentElement.classList.contains("import-review-mode");
    if (!reviewing) {
      active = null;
      candidate = null;
      draftKey = "";
      document.getElementById("import-review-capture-area")?.remove();
      disconnectPicker();
      return;
    }
    session = await readImportReview();
    if (!session) return;
    if (active && active.objectId !== session.selectedObjectId) {
      active = null;
      candidate = null;
      draftKey = "";
    }
    annotateReviewFields();
    renderCaptureDock();
  } finally {
    syncing = false;
    observe();
  }
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    void sync();
  });
}

function observe(): void {
  const root = document.getElementById("root");
  if (root) observer.observe(root, { childList: true, subtree: true });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function descriptorFromRow(row: HTMLElement): ActiveField | null {
  const objectId = row.dataset.reviewObjectId;
  const field = row.dataset.reviewField;
  if (!objectId || !field) return null;
  return {
    objectId,
    field,
    label: row.dataset.reviewLabel || field,
    context: row.dataset.reviewContext || "",
    ...(row.dataset.reviewTargetKind === "funding" && row.dataset.reviewTargetId
      ? { target: { kind: "funding", id: row.dataset.reviewTargetId } as ReviewTarget }
      : {}),
  };
}

function reviewedRules(current: ImportReviewSession, objectId: string): ReviewedImportRule[] {
  return current.previewState.rules
    .filter((rule) => rule.objectId === objectId)
    .map((rule) => {
      if (rule.target?.kind !== "funding") return { ...rule };
      const row = (current.previewState.financingRules ?? []).find(
        (entry) => entry.objectId === objectId && String(entry.id) === rule.target!.id,
      );
      if (!row?.importKey) {
        throw new Error("Nie udało się zmapować reguły wariantu finansowania.");
      }
      return { ...rule, targetImportKey: String(row.importKey) };
    });
}

async function approveCurrent(): Promise<void> {
  if (approving) return;
  approving = true;
  try {
    const current = await readImportReview();
    if (!current?.selectedObjectId) return;
    const draftCommit = await readActiveDraft();
    if (!draftCommit) {
      throw new Error("Najpierw rozpocznij New commit w zakładce Workspace.");
    }
    const previewId = current.selectedObjectId;
    const plan: ImportApprovalPlanWithRules = {
      ...buildImportApprovalPlan(
        current,
        previewId,
        draftCommit.workingState,
      ),
      reviewRules: reviewedRules(current, previewId),
    };
    const now = new Date().toISOString();
    const staged = stageImportReviewObject(
      draftCommit.workingState,
      plan,
      () => crypto.randomUUID(),
      now,
    );
    draftCommit.workingState = staged.state;
    draftCommit.updatedAt = now;
    await writeActiveDraft(draftCommit);
    await publishUiState(draftCommit.workingState);
    for (const link of plan.existingReferenceLinks) {
      markImportObjectLinked(
        current,
        link.importKey,
        link.targetObjectId,
        now,
      );
    }
    markImportObjectApproved(current, previewId, staged.stagedObjectId, now);
    await writeImportReview(current);
    session = current;
    active = null;
    candidate = null;
    draftKey = "";
    window.dispatchEvent(new Event("burbot:commit-changed"));
    window.dispatchEvent(
      new CustomEvent("burbot:import-review-changed", { detail: { open: true } }),
    );
    queueSync();
  } catch (error) {
    notice(error instanceof Error ? error.message : String(error), true);
  } finally {
    approving = false;
  }
}

const style = document.createElement("style");
style.dataset.burbotImportWorkspaceBridge = "true";
style.textContent = `
  .import-review-workspace-field { cursor: pointer; }
  .import-review-workspace-field:hover { border-color: #a9c3b1 !important; }
  .import-review-workspace-field.selected {
    outline: 2px solid #82aa8f;
    outline-offset: 1px;
  }
  .import-review-workspace-field > .import-review-editor,
  .import-review-workspace-field > div > .import-review-editor,
  .import-review-finance-fields .import-review-workspace-field > .import-review-editor {
    display: none !important;
  }
  .import-review-workspace-value {
    display: block;
    margin-top: 3px;
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .import-review-capture-area { margin-top: 14px; }
  .import-review-capture-value { margin-top: 5px; }
  .import-review-capture-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8e1d9;
    border-radius: 8px;
    padding: 8px 9px;
    background: #fff;
    font: inherit;
  }
  .import-review-capture-area textarea { min-height: 76px; resize: vertical; }
  #import-review-capture-notice { margin: 8px 0 0; font-size: 11px; }
  #import-review-capture-notice.error { color: #a33b32; }
`;
document.head.append(style);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const approve = target.closest(".import-review-approve");
    if (approve && document.documentElement.classList.contains("import-review-mode")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void approveCurrent();
      return;
    }

    const row = target.closest<HTMLElement>("[data-review-field]");
    if (!row || target.closest("button,a,input,select,textarea")) return;
    const descriptor = descriptorFromRow(row);
    if (!descriptor) return;
    active = descriptor;
    candidate = null;
    draftKey = "";
    queueSync();
    void ensurePicker().catch((error) =>
      notice(error instanceof Error ? error.message : String(error), true),
    );
  },
  true,
);

window.addEventListener("burbot:import-review-changed", queueSync);
window.addEventListener("pagehide", disconnectPicker);
observe();
queueSync();
