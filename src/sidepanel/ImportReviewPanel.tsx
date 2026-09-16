import { useEffect, useMemo, useRef, useState } from "react";
import { publishUiState } from "../shared/api/storage";
import {
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import { createPageUrlCandidate } from "../shared/extraction/rules";
import {
  captureImportReviewFinancingField,
  captureImportReviewObjectField,
  type ImportReviewCaptureResult,
} from "../shared/import/reviewCapture";
import {
  buildImportApprovalPlan,
  editImportReviewFinancingField,
  editImportReviewObjectField,
  importReviewView,
  markImportObjectApproved,
  removeImportReviewFile,
  removeImportReviewFinancing,
  renameImportReviewFile,
} from "../shared/import/review";
import {
  clearImportReview,
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import { stageImportReviewObject } from "../shared/import/stageReview";
import { selectorColor } from "../shared/selectorPalette";
import type {
  ImportReviewEditorOption,
  ImportReviewEditorType,
  ImportReviewFieldView,
  ImportReviewFinancingFieldView,
  ImportReviewSession,
  ImportReviewView,
} from "../shared/types/importReview";
import type { ExtractionCandidate } from "../shared/types/picker";
import { createPickerClient, type PickerClient } from "./pickerRpc";

async function activeTab(): Promise<browser.tabs.Tab | undefined> {
  const window = await browser.windows.getCurrent();
  const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
  return tab;
}

function comparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return value;
  }
}

function evidenceColorKey(view: ImportReviewView, field: string): string {
  return `${view.selectedObjectId}:${field}`;
}

async function sendReviewHighlights(
  view: ImportReviewView,
  focusId?: string,
): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;

  const activeUrl = comparableUrl(tab.url);
  const highlights = view.evidence
    .filter(
      (entry) => entry.sourceUrl && comparableUrl(entry.sourceUrl) === activeUrl,
    )
    .map((entry) => ({
      id: entry.id,
      exact: entry.exact,
      prefix: entry.prefix,
      suffix: entry.suffix,
      colorKey: evidenceColorKey(view, entry.field),
    }));

  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["import-review-highlights.js"],
    });
    await browser.tabs.sendMessage(tab.id, {
      type: "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS",
      highlights,
      ...(focusId ? { focusId } : {}),
    });
  } catch {
    // Evidence remains visible in the sidepanel if the page blocks injection.
  }
}

async function clearPageReviewHighlights(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["import-review-highlights.js"],
    });
    await browser.tabs.sendMessage(tab.id, {
      type: "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS",
      highlights: [],
    });
  } catch {
    // Visual review is best-effort.
  }
}

async function waitForTabReady(
  tabId: number,
  expectedUrl: string,
  timeoutMs = 10000,
): Promise<void> {
  const current = await browser.tabs.get(tabId).catch(() => undefined);
  if (
    current?.status === "complete" &&
    comparableUrl(current.url ?? "") === comparableUrl(expectedUrl)
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    let timer: number | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      if (timer !== undefined) window.clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (
      changedTabId: number,
      change: { status?: string; url?: string },
      tab: browser.tabs.Tab,
    ) => {
      if (changedTabId !== tabId) return;
      const url = change.url ?? tab.url ?? "";
      if (
        change.status === "complete" &&
        comparableUrl(url) === comparableUrl(expectedUrl)
      ) {
        finish();
      }
    };

    browser.tabs.onUpdated.addListener(listener);
    timer = window.setTimeout(finish, timeoutMs);
  });
}

async function openSource(url: string): Promise<void> {
  const tab = await activeTab();
  if (tab?.id !== undefined) await browser.tabs.update(tab.id, { url });
}

async function focusFieldSource(
  view: ImportReviewView,
  field: string,
): Promise<void> {
  const evidence = view.evidence.find(
    (entry) => entry.field === field && Boolean(entry.sourceUrl),
  );
  if (!evidence?.sourceUrl) {
    throw new Error("To pole nie ma źródła, do którego można przejść.");
  }

  const tab = await activeTab();
  if (!tab?.id) throw new Error("Nie udało się odnaleźć aktywnej karty.");

  if (comparableUrl(tab.url ?? "") !== comparableUrl(evidence.sourceUrl)) {
    await browser.tabs.update(tab.id, { url: evidence.sourceUrl });
    await waitForTabReady(tab.id, evidence.sourceUrl);
  }

  await sendReviewHighlights(view, evidence.id);
}

function groupLabel(type: string): string {
  if (type === "project") return "Projekty";
  if (type === "operator") return "Operatorzy";
  return "Nabory";
}

interface ReviewEditorProps {
  type: ImportReviewEditorType;
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onSave(value: string): Promise<void>;
}

function ReviewEditor({
  type,
  value,
  disabled = false,
  ariaLabel,
  onSave,
}: ReviewEditorProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  async function commit() {
    if (disabled || draft === value) return;
    await onSave(draft);
  }

  return (
    <input
      className="import-review-editor"
      aria-label={ariaLabel}
      type={type === "date" ? "date" : "text"}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => void commit().catch(() => setDraft(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type CaptureTarget =
  | {
      kind: "object";
      objectId: string;
      field: string;
      label: string;
      context: string;
      editorType: ImportReviewEditorType;
      editorValue: string;
      options?: ImportReviewEditorOption[];
    }
  | {
      kind: "financing";
      objectId: string;
      financingId: string;
      field: string;
      label: string;
      context: string;
      editorType: ImportReviewEditorType;
      editorValue: string;
      options?: ImportReviewEditorOption[];
    };

function captureKey(target: CaptureTarget | null): string {
  if (!target) return "";
  return target.kind === "object"
    ? `object:${target.field}`
    : `financing:${target.financingId}:${target.field}`;
}

function capturedDraft(target: CaptureTarget, raw: string): string {
  if (target.editorType !== "select") return raw;
  const normalized = BurbotCore.clean(raw).toLocaleLowerCase("pl-PL");
  return (
    target.options?.find(
      (option) =>
        BurbotCore.clean(option.value).toLocaleLowerCase("pl-PL") === normalized ||
        BurbotCore.clean(option.label).toLocaleLowerCase("pl-PL") === normalized,
    )?.value ?? ""
  );
}

interface CaptureValueControlProps {
  target: CaptureTarget;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}

function CaptureValueControl({
  target,
  value,
  disabled,
  onChange,
}: CaptureValueControlProps) {
  if (target.editorType === "select") {
    return (
      <select
        className="import-review-editor"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">Wybierz…</option>
        {(target.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="import-review-editor"
      type={target.editorType === "date" ? "date" : "text"}
      inputMode={target.editorType === "number" ? "decimal" : undefined}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function targetFromObjectField(
  objectId: string,
  field: ImportReviewFieldView,
): CaptureTarget {
  return {
    kind: "object",
    objectId,
    field: field.field,
    label: field.label,
    context: "Dane obiektu",
    editorType: field.editorType,
    editorValue: field.editorValue,
    ...(field.options ? { options: field.options } : {}),
  };
}

function targetFromFinancingField(
  objectId: string,
  financingId: string,
  companySizeLabel: string,
  variantNo: number,
  field: ImportReviewFinancingFieldView,
): CaptureTarget {
  return {
    kind: "financing",
    objectId,
    financingId,
    field: field.field,
    label: field.label,
    context: `${companySizeLabel} · wariant ${variantNo}`,
    editorType: field.editorType,
    editorValue: field.editorValue,
    ...(field.options ? { options: field.options } : {}),
  };
}

export function ImportReviewPanel() {
  const [session, setSession] = useState<ImportReviewSession | null>(null);
  const [mode, setMode] = useState<"workspace" | "review">("workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [captureCandidate, setCaptureCandidate] =
    useState<ExtractionCandidate | null>(null);
  const [captureMethodIndex, setCaptureMethodIndex] = useState(0);
  const [captureDraft, setCaptureDraft] = useState("");
  const [captureNotice, setCaptureNotice] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickerConnecting, setPickerConnecting] = useState(false);
  const pickerClientRef = useRef<PickerClient | null>(null);
  const pickerPortRef = useRef<browser.runtime.Port | null>(null);
  const pickerTabIdRef = useRef<number | null>(null);
  const pickerGenerationRef = useRef(0);
  const captureTargetRef = useRef<CaptureTarget | null>(null);
  captureTargetRef.current = captureTarget;
  const view = useMemo(() => importReviewView(session), [session]);

  function closePickerConnection(): void {
    pickerGenerationRef.current++;
    const client = pickerClientRef.current;
    const port = pickerPortRef.current;
    pickerClientRef.current = null;
    pickerPortRef.current = null;
    pickerTabIdRef.current = null;
    client?.dispose(new Error("Page connection changed. Try again."));
    try {
      port?.disconnect();
    } catch {
      // Already disconnected.
    }
    setPicking(false);
    setPickerConnecting(false);
  }

  function acceptCapture(candidate: ExtractionCandidate): void {
    const target = captureTargetRef.current;
    if (!target) {
      setError("Najpierw wybierz pole w Import Review.");
      return;
    }
    let index = 0;
    const wantsUrl =
      /(^|_|\b)url($|_|\b)/i.test(target.field) || /url/i.test(target.label);
    if (wantsUrl) {
      const href = candidate.options.findIndex(
        (option) =>
          option.extraction.type === "attribute" &&
          option.extraction.attribute === "href",
      );
      if (href >= 0) index = href;
    }
    setCaptureCandidate(candidate);
    setCaptureMethodIndex(index);
    setCaptureDraft(capturedDraft(target, candidate.options[index]?.raw ?? ""));
    setCaptureNotice("Sprawdź przechwyconą wartość i zapisz ją do review.");
  }

  async function ensurePicker(): Promise<PickerClient> {
    const tab = await activeTab();
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
      throw new Error("Otwórz stronę HTTP(S), z której chcesz wydzielić wartość.");
    }

    if (pickerClientRef.current && pickerTabIdRef.current === tab.id) {
      return pickerClientRef.current;
    }

    closePickerConnection();
    setPickerConnecting(true);
    const token = ++pickerGenerationRef.current;
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["core.js", "picker.js"],
      });
      if (token !== pickerGenerationRef.current) {
        throw new Error("Połączenie ze stroną zmieniło się.");
      }

      // picker.ts already accepts this lightweight port name. Review uses an
      // explicit SELECTION RPC, so it does not compete with Workspace's
      // automatic selected-text sender.
      const port = browser.tabs.connect(tab.id, {
        name: "burbot-file-picker",
        frameId: 0,
      });
      const client = createPickerClient(port, (message) => {
        if (token !== pickerGenerationRef.current) return;
        if (message.event === "CAPTURE") {
          setPicking(false);
          acceptCapture(message.candidate);
        } else if (message.event === "MODE") {
          setPicking(message.picking);
        } else if (message.event === "ERROR") {
          setError(message.error);
        }
      });

      pickerClientRef.current = client;
      pickerPortRef.current = port;
      pickerTabIdRef.current = tab.id;
      port.onDisconnect.addListener(() => {
        if (pickerPortRef.current !== port) return;
        client.dispose();
        pickerClientRef.current = null;
        pickerPortRef.current = null;
        pickerTabIdRef.current = null;
        setPicking(false);
        setPickerConnecting(false);
      });
      return client;
    } finally {
      if (token === pickerGenerationRef.current) setPickerConnecting(false);
    }
  }

  async function stopInteractivePicker(): Promise<void> {
    const client = pickerClientRef.current;
    if (!client) {
      setPicking(false);
      return;
    }
    try {
      await client.request("STOP");
    } catch {
      closePickerConnection();
    }
  }

  async function refresh(open = false) {
    const next = await readImportReview();
    setSession(next);
    if (open && next) setMode("review");
  }

  useEffect(() => {
    void refresh();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      void refresh(detail?.open === true);
    };
    window.addEventListener("burbot:import-review-changed", changed);
    return () => window.removeEventListener("burbot:import-review-changed", changed);
  }, []);

  useEffect(() => {
    const reviewing = Boolean(session && mode === "review");
    document.documentElement.classList.toggle("import-review-mode", reviewing);

    if (!reviewing) {
      closePickerConnection();
      setCaptureTarget(null);
      setCaptureCandidate(null);
      void clearPageReviewHighlights().finally(() => {
        window.dispatchEvent(new Event("burbot:selector-highlights-refresh"));
      });
      return () => document.documentElement.classList.remove("import-review-mode");
    }

    void sendReviewHighlights(view);
    const sync = () => void sendReviewHighlights(view);
    const invalidatePicker = () => closePickerConnection();
    const updated = (
      tabId: number,
      change: { url?: string; status?: string },
    ) => {
      if (change.url || change.status === "complete") sync();
      if (
        pickerTabIdRef.current === tabId &&
        (change.url || change.status === "loading")
      ) {
        invalidatePicker();
      }
    };
    browser.tabs.onActivated.addListener(sync);
    browser.tabs.onActivated.addListener(invalidatePicker);
    browser.tabs.onUpdated.addListener(updated);

    return () => {
      browser.tabs.onActivated.removeListener(sync);
      browser.tabs.onActivated.removeListener(invalidatePicker);
      browser.tabs.onUpdated.removeListener(updated);
      closePickerConnection();
      document.documentElement.classList.remove("import-review-mode");
    };
  }, [session, mode, view.selectedObjectId, view.evidence]);

  async function persistReviewMutation(
    mutate: (current: ImportReviewSession, now: string) => void,
  ) {
    if (!session) return;
    setError("");
    try {
      const now = new Date().toISOString();
      mutate(session, now);
      await writeImportReview(session);
      setSession({
        ...session,
        previewState: { ...session.previewState },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  async function select(objectId: string) {
    if (!session) return;
    await stopInteractivePicker();
    session.selectedObjectId = objectId;
    session.updatedAt = new Date().toISOString();
    await writeImportReview(session);
    setSession({ ...session });
    setCaptureTarget(null);
    setCaptureCandidate(null);
    setCaptureNotice("");
    setError("");
  }

  function selectCaptureTarget(target: CaptureTarget): void {
    if (busy) return;
    void stopInteractivePicker();
    setCaptureTarget(target);
    setCaptureCandidate(null);
    setCaptureMethodIndex(0);
    setCaptureDraft(target.editorValue);
    setCaptureNotice("Możesz wpisać wartość ręcznie albo wydzielić ją z aktywnej strony.");
    setError("");
  }

  async function showFieldSource(field: string) {
    setError("");
    try {
      await focusFieldSource(view, field);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function togglePick() {
    if (!captureTarget) return;
    setError("");
    try {
      const client = await ensurePicker();
      await client.request(picking ? "STOP" : "PICK");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function useSelection() {
    if (!captureTarget) return;
    setError("");
    try {
      const client = await ensurePicker();
      acceptCapture(await client.request("SELECTION"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function usePageUrl() {
    if (!captureTarget) return;
    setError("");
    try {
      const client = await ensurePicker();
      acceptCapture(createPageUrlCandidate(await client.request("URL")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function nextCaptureTarget(current: CaptureTarget): CaptureTarget | null {
    if (current.kind === "object") {
      const index = view.fields.findIndex((field) => field.field === current.field);
      const next = view.fields.slice(index + 1).find((field) => !field.editorValue);
      return next && view.selectedObjectId
        ? targetFromObjectField(view.selectedObjectId, next)
        : null;
    }

    const variant = view.financing.find(
      (entry) => entry.id === current.financingId,
    );
    if (!variant) return null;
    const index = variant.fields.findIndex((field) => field.field === current.field);
    const next = variant.fields.slice(index + 1).find((field) => !field.editorValue);
    return next && view.selectedObjectId
      ? targetFromFinancingField(
          view.selectedObjectId,
          variant.id,
          variant.companySizeLabel,
          variant.variantNo,
          next,
        )
      : null;
  }

  async function saveCapture() {
    if (!session || !captureTarget) return;
    setBusy(true);
    setError("");
    let captureResult: ImportReviewCaptureResult | null = null;
    const currentTarget = captureTarget;
    try {
      const now = new Date().toISOString();
      if (captureCandidate) {
        const option = captureCandidate.options[captureMethodIndex];
        if (!option) throw new Error("Wybierz sposób odczytu wartości.");
        const client = await ensurePicker();
        if (
          comparableUrl(await client.request("URL")) !==
          comparableUrl(captureCandidate.pageUrl)
        ) {
          throw new Error("Strona zmieniła się. Wydziel wartość ponownie.");
        }
        if (currentTarget.kind === "object") {
          captureResult = captureImportReviewObjectField(
            session,
            currentTarget.objectId,
            currentTarget.field,
            captureDraft,
            captureCandidate.pageUrl,
            option.raw,
            now,
          );
        } else {
          captureResult = captureImportReviewFinancingField(
            session,
            currentTarget.objectId,
            currentTarget.financingId,
            currentTarget.field,
            captureDraft,
            now,
          );
        }
      } else if (currentTarget.kind === "object") {
        editImportReviewObjectField(
          session,
          currentTarget.objectId,
          currentTarget.field,
          captureDraft,
          now,
        );
      } else {
        editImportReviewFinancingField(
          session,
          currentTarget.objectId,
          currentTarget.financingId,
          currentTarget.field,
          captureDraft,
          now,
        );
      }

      await writeImportReview(session);
      setSession({ ...session, previewState: { ...session.previewState } });
      setCaptureCandidate(null);
      setCaptureMethodIndex(0);
      setCaptureNotice(
        captureResult?.evidenceMessage ?? "Wartość zapisana ręcznie w Import Review.",
      );

      const next = nextCaptureTarget(currentTarget);
      if (next) {
        setCaptureTarget(next);
        setCaptureDraft(next.editorValue);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!session?.selectedObjectId) return;
    setBusy(true);
    setError("");
    try {
      await stopInteractivePicker();
      const draft = await readActiveDraft();
      if (!draft) {
        throw new Error("Najpierw rozpocznij New commit w zakładce Workspace.");
      }

      const previewId = session.selectedObjectId;
      const plan = buildImportApprovalPlan(session, previewId);
      const now = new Date().toISOString();
      const staged = stageImportReviewObject(
        draft.workingState,
        plan,
        () => crypto.randomUUID(),
        now,
      );

      draft.workingState = staged.state;
      draft.updatedAt = now;
      await writeActiveDraft(draft);
      await publishUiState(draft.workingState);

      markImportObjectApproved(
        session,
        previewId,
        staged.stagedObjectId,
        now,
      );
      await writeImportReview(session);
      setSession({ ...session, previewState: { ...session.previewState } });
      setCaptureTarget(null);
      setCaptureCandidate(null);

      window.dispatchEvent(new Event("burbot:commit-changed"));
      window.dispatchEvent(new CustomEvent("burbot:import-review-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function closeReview() {
    if (!session) return;
    if (
      (view.pendingCount ?? 0) > 0 &&
      !confirm(
        "Zamknąć import review? Niezatwierdzone obiekty zostaną odrzucone.",
      )
    ) {
      return;
    }
    closePickerConnection();
    await clearImportReview();
    setSession(null);
    setMode("workspace");
    setCaptureTarget(null);
    setCaptureCandidate(null);
    await clearPageReviewHighlights();
    window.dispatchEvent(new Event("burbot:selector-highlights-refresh"));
  }

  if (!session) return null;

  const groups = ["operator", "project", "recruitment"].map((type) => ({
    type,
    label: groupLabel(type),
    objects: view.objects.filter(
      (object) =>
        object.type === type ||
        (type === "recruitment" && object.type === "nabor"),
    ),
  }));
  const selected = view.objects.find(
    (object) => object.id === view.selectedObjectId,
  );
  const readOnly = selected?.status === "APPROVED";
  const sourceUrls = [
    ...new Set([
      ...view.evidence.flatMap((entry) =>
        entry.sourceUrl ? [entry.sourceUrl] : [],
      ),
      ...view.files.flatMap((file) => [file.sourcePageUrl, file.url]),
    ].filter(Boolean)),
  ];
  const selectedCaptureKey = captureKey(captureTarget);
  const selectedOption = captureCandidate?.options[captureMethodIndex];

  return (
    <section className="import-review-shell">
      <nav className="workspace-mode-tabs" aria-label="Tryb pracy">
        <button
          type="button"
          className={mode === "workspace" ? "active" : ""}
          onClick={() => setMode("workspace")}
        >
          Workspace
        </button>
        <button
          type="button"
          className={mode === "review" ? "active" : ""}
          onClick={() => setMode("review")}
        >
          Import review <span>{view.pendingCount ?? 0}</span>
        </button>
      </nav>

      {mode === "review" && (
        <div className="import-review-panel">
          <header className="import-review-header">
            <div>
              <span className="eyebrow">IMPORT REVIEW</span>
              <strong>{view.fileName}</strong>
              <small>
                {view.approvedCount}/{view.objects.length} zatwierdzono
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => void closeReview()}
            >
              Zamknij
            </button>
          </header>
          <div className="import-review-progress">
            <span
              style={{
                width: `${
                  view.objects.length
                    ? ((view.approvedCount ?? 0) / view.objects.length) * 100
                    : 0
                }%`,
              }}
            />
          </div>

          <div className="import-review-layout">
            <aside className="import-review-list">
              {groups.map(
                (group) =>
                  group.objects.length > 0 && (
                    <details key={group.type} open>
                      <summary>
                        {group.label}
                        <span>{group.objects.length}</span>
                      </summary>
                      {group.objects.map((object) => (
                        <button
                          key={object.id}
                          type="button"
                          className={`${
                            object.id === view.selectedObjectId ? "selected " : ""
                          }${object.status === "APPROVED" ? "approved" : ""}`}
                          onClick={() => void select(object.id)}
                        >
                          <span>{object.label}</span>
                          <small>
                            {object.status === "APPROVED"
                              ? "✓"
                              : [
                                  object.evidenceCount
                                    ? `${object.evidenceCount} ev`
                                    : "",
                                  object.fileCount ? `${object.fileCount} plik` : "",
                                  object.financingCount
                                    ? `${object.financingCount} fin.`
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "do sprawdzenia"}
                          </small>
                        </button>
                      ))}
                    </details>
                  ),
              )}
            </aside>

            <div className="import-review-detail">
              {selected ? (
                <>
                  <div className="import-review-object-title">
                    <div>
                      <span className="eyebrow">{selected.type.toUpperCase()}</span>
                      <h2>{selected.label}</h2>
                    </div>
                    {!readOnly && (
                      <span className="import-review-edit-badge">Workspace mode</span>
                    )}
                  </div>

                  {sourceUrls.length > 0 && (
                    <div className="import-review-sources">
                      {sourceUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          className="text-button"
                          onClick={() => void openSource(url)}
                        >
                          Otwórz źródło ↗
                        </button>
                      ))}
                    </div>
                  )}

                  <section className="import-review-section">
                    <div className="import-review-section-heading">
                      <div>
                        <span className="eyebrow">DANE OBIEKTU</span>
                        <strong>{view.fields.length} pól</strong>
                      </div>
                      <small>Kliknij pole i pracuj dokładnie jak w Workspace.</small>
                    </div>
                    <div className="import-review-fields">
                      {view.fields.map((field) => {
                        const evidence = view.evidence.filter(
                          (entry) => entry.field === field.field,
                        );
                        const hasSource = evidence.some((entry) => entry.sourceUrl);
                        const color = field.evidenceCount
                          ? selectorColor(evidenceColorKey(view, field.field))
                          : null;
                        const key = `object:${field.field}`;
                        return (
                          <div
                            key={field.field}
                            className={`${field.evidenceCount ? "has-evidence " : ""}${
                              key === selectedCaptureKey ? "capture-selected" : ""
                            }`}
                            style={
                              color
                                ? {
                                    borderLeftColor: color.border,
                                    background: color.soft,
                                    boxShadow: `inset 3px 0 0 ${color.border}`,
                                  }
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className="import-review-field-select"
                              disabled={readOnly || busy}
                              onClick={() =>
                                selectCaptureTarget(
                                  targetFromObjectField(selected.id, field),
                                )
                              }
                            >
                              <span className="field-copy">
                                <span className="field-label">{field.label}</span>
                                <span
                                  className={`field-value${
                                    field.editorValue ? "" : " empty"
                                  }`}
                                >
                                  {field.value}
                                </span>
                              </span>
                              <span className="field-mark">
                                {field.editorValue ? "✓" : "Brak"}
                              </span>
                            </button>
                            {(field.evidenceCount > 0 || hasSource) && (
                              <div className="import-review-field-meta">
                                <span style={{ color: color?.border }}>
                                  {field.evidenceCount
                                    ? `${field.evidenceCount} evidence`
                                    : ""}
                                </span>
                                {hasSource && (
                                  <button
                                    type="button"
                                    className="import-review-source-button"
                                    style={{ color: color?.border }}
                                    onClick={() => void showFieldSource(field.field)}
                                  >
                                    Pokaż w źródle ↗
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {view.files.length > 0 && (
                    <section className="import-review-section">
                      <div className="import-review-section-heading">
                        <div>
                          <span className="eyebrow">PLIKI</span>
                          <strong>{view.files.length} przypiętych</strong>
                        </div>
                        <small>AI wskazało te pliki jako źródła obiektu.</small>
                      </div>
                      <div className="import-review-files">
                        {view.files.map((file) => (
                          <div key={file.id} className="import-review-file-card">
                            <ReviewEditor
                              type="text"
                              value={file.name}
                              disabled={readOnly || busy}
                              ariaLabel="Nazwa pliku"
                              onSave={(value) =>
                                persistReviewMutation((current, now) =>
                                  renameImportReviewFile(
                                    current,
                                    selected.id,
                                    file.id,
                                    value,
                                    now,
                                  ),
                                )
                              }
                            />
                            <a href={file.url} target="_blank" rel="noreferrer">
                              {file.url}
                            </a>
                            <div className="import-review-card-actions">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => void openSource(file.sourcePageUrl)}
                              >
                                Strona źródłowa ↗
                              </button>
                              <button
                                type="button"
                                className="text-button danger"
                                disabled={readOnly || busy}
                                onClick={() =>
                                  void persistReviewMutation((current, now) =>
                                    removeImportReviewFile(
                                      current,
                                      selected.id,
                                      file.id,
                                      now,
                                    ),
                                  )
                                }
                              >
                                Usuń
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {view.financing.length > 0 && (
                    <section className="import-review-section">
                      <div className="import-review-section-heading">
                        <div>
                          <span className="eyebrow">FINANSOWANIE</span>
                          <strong>{view.financing.length} wariantów</strong>
                        </div>
                        <small>
                          Kliknij pole finansowania, aby wydzielić je z tej samej strony.
                        </small>
                      </div>
                      <div className="import-review-financing">
                        {view.financing.map((variant) => (
                          <details
                            key={variant.id}
                            open
                            className="import-review-finance-card"
                          >
                            <summary>
                              <span>
                                {variant.companySizeLabel} · wariant {variant.variantNo}
                              </span>
                              <small>{variant.key}</small>
                            </summary>
                            <div className="import-review-finance-fields">
                              {variant.fields.map((field) => {
                                const key = `financing:${variant.id}:${field.field}`;
                                return (
                                  <button
                                    key={field.field}
                                    type="button"
                                    className={`import-review-finance-field${
                                      key === selectedCaptureKey
                                        ? " capture-selected"
                                        : ""
                                    }`}
                                    disabled={readOnly || busy}
                                    onClick={() =>
                                      selectCaptureTarget(
                                        targetFromFinancingField(
                                          selected.id,
                                          variant.id,
                                          variant.companySizeLabel,
                                          variant.variantNo,
                                          field,
                                        ),
                                      )
                                    }
                                  >
                                    <small>{field.label}</small>
                                    <strong>{field.value || "Nie ustawiono"}</strong>
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              className="text-button danger import-review-remove-finance"
                              disabled={readOnly || busy}
                              onClick={() =>
                                void persistReviewMutation((current, now) =>
                                  removeImportReviewFinancing(
                                    current,
                                    selected.id,
                                    variant.id,
                                    now,
                                  ),
                                )
                              }
                            >
                              Usuń wariant
                            </button>
                          </details>
                        ))}
                      </div>
                    </section>
                  )}

                  {!readOnly && captureTarget && (
                    <section
                      className="capture-area import-review-capture"
                      aria-label="Aktywne wydzielanie pola z Import Review"
                    >
                      <div className="capture-heading">
                        <span>
                          <small>WYDZIELANIE</small>
                          <strong>{captureTarget.label}</strong>
                          <span className="muted">{captureTarget.context}</span>
                        </span>
                        <span className="capture-heading-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Zamknij wydzielanie"
                            onClick={() => {
                              void stopInteractivePicker();
                              setCaptureTarget(null);
                              setCaptureCandidate(null);
                              setCaptureNotice("");
                            }}
                          >
                            ×
                          </button>
                        </span>
                      </div>

                      <div className="capture-tools">
                        <button
                          type="button"
                          disabled={busy || pickerConnecting}
                          onClick={() => void togglePick()}
                        >
                          {pickerConnecting
                            ? "Łączenie…"
                            : picking
                              ? "Anuluj picker"
                              : "Wybierz element"}
                        </button>
                        <button
                          type="button"
                          disabled={busy || pickerConnecting}
                          onClick={() => void useSelection()}
                        >
                          Użyj zaznaczenia
                        </button>
                        <button
                          type="button"
                          disabled={busy || pickerConnecting}
                          onClick={() => void usePageUrl()}
                        >
                          Użyj URL strony
                        </button>
                      </div>

                      {captureCandidate && (
                        <div className="import-review-capture-source">
                          <label htmlFor="import-review-capture-method">
                            Odczytaj ze strony
                          </label>
                          <select
                            id="import-review-capture-method"
                            value={String(captureMethodIndex)}
                            disabled={busy}
                            onChange={(event) => {
                              const index = Number(event.currentTarget.value);
                              setCaptureMethodIndex(index);
                              setCaptureDraft(
                                capturedDraft(
                                  captureTarget,
                                  captureCandidate.options[index]?.raw ?? "",
                                ),
                              );
                            }}
                          >
                            {captureCandidate.options.map((option, index) => (
                              <option key={`${option.label}:${index}`} value={index}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div className="source-sample">
                            {selectedOption?.raw ?? ""}
                          </div>
                        </div>
                      )}

                      <label htmlFor="import-review-capture-value">Wartość</label>
                      <div id="import-review-capture-value">
                        <CaptureValueControl
                          target={captureTarget}
                          value={captureDraft}
                          disabled={busy}
                          onChange={setCaptureDraft}
                        />
                      </div>
                      <p className="hint">{captureNotice}</p>
                      <button
                        type="button"
                        className="primary import-review-capture-save"
                        disabled={busy || !captureDraft}
                        onClick={() => void saveCapture()}
                      >
                        {captureCandidate
                          ? "Zapisz wydzielenie i przejdź dalej"
                          : "Zapisz wartość i przejdź dalej"}
                      </button>

                      {captureCandidate && (
                        <details className="import-review-capture-details">
                          <summary>Szczegóły przechwycenia</summary>
                          <pre>
                            {JSON.stringify(
                              {
                                pageUrl: captureCandidate.pageUrl,
                                selector: captureCandidate.selector,
                                extraction: selectedOption?.extraction,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </section>
                  )}

                  <p className="import-review-hint">
                    Import Review używa teraz tego samego flow co Workspace: wybierz pole,
                    wydziel element lub zaznaczenie albo wpisz wartość ręcznie, a dopiero
                    potem zatwierdź obiekt.
                  </p>
                  <button
                    type="button"
                    className="primary import-review-approve"
                    disabled={busy || selected.status === "APPROVED"}
                    onClick={() => void approve()}
                  >
                    {selected.status === "APPROVED"
                      ? "Zatwierdzono — obiekt jest w commicie"
                      : "Zatwierdź obiekt → dodaj do commita"}
                  </button>
                </>
              ) : (
                <p>Wybierz obiekt do sprawdzenia.</p>
              )}
              {error && <p className="commit-error">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
