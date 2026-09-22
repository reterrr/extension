import { useEffect, useMemo, useRef, useState } from "react";
import { publishUiState } from "../shared/api/storage";
import {
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import {
  buildImportApprovalPlan,
  findExistingImportObjectMatch,
  importReviewView,
  markImportObjectApproved,
  markImportObjectLinked,
  markImportObjectRejected,
  restoreRejectedImportObject,
  revokeApprovedImportObject,
} from "../shared/import/review";
import {
  clearImportReview,
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import {
  stageImportReviewObject,
  type ImportApprovalPlanWithRules,
  type ReviewedImportRule,
} from "../shared/import/stageReview";
import { selectorColor } from "../shared/selectorPalette";
import {
  OBJECT_VIEW_STORAGE_KEY,
  addObjectToView,
} from "../shared/search/objectView.js";
import type {
  ImportReviewSession,
  ImportReviewView,
} from "../shared/types/importReview";
import type { LegacyStoredRule } from "../shared/types/legacy-storage";
import {
  patchSidepanelUiState,
  readSidepanelUiState,
  type SidepanelMode,
} from "./uiSessionState";

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

function reviewedRules(
  current: ImportReviewSession,
  objectId: string,
): ReviewedImportRule[] {
  return current.previewState.rules
    .filter((rule) => rule.objectId === objectId)
    .map((rule: LegacyStoredRule) => {
      if (rule.target?.kind !== "funding") return { ...rule };
      const row = (current.previewState.financingRules ?? []).find(
        (entry) =>
          entry.objectId === objectId && String(entry.id) === rule.target!.id,
      );
      if (!row?.importKey) {
        throw new Error("Nie udało się zmapować reguły wariantu finansowania.");
      }
      return { ...rule, targetImportKey: String(row.importKey) };
    });
}

function requestWorkflowMode(mode: "view" | "commit" | "import"): void {
  window.dispatchEvent(
    new CustomEvent("burbot:request-workflow-mode", { detail: { mode } }),
  );
}

export function ImportReviewPanel() {
  const [session, setSession] = useState<ImportReviewSession | null>(null);
  const [mode, setMode] = useState<"workspace" | "review">("workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingTarget, setExistingTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const windowIdRef = useRef<number | null>(null);
  const modeRef = useRef<SidepanelMode>("workspace");
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const view = useMemo(() => importReviewView(session), [session]);

  function restoreScroll(top: number): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      });
    });
  }

  async function switchMode(nextMode: SidepanelMode): Promise<void> {
    if (nextMode === modeRef.current) return;
    const windowId = windowIdRef.current;
    const previousMode = modeRef.current;
    let targetScroll = 0;

    if (windowId !== null) {
      const saved = await readSidepanelUiState(windowId);
      targetScroll = saved.scroll[nextMode];
      await patchSidepanelUiState(windowId, {
        mode: nextMode,
        scroll: { [previousMode]: window.scrollY },
      });
    }

    modeRef.current = nextMode;
    setMode(nextMode);
    restoreScroll(targetScroll);
  }

  async function refresh(open = false) {
    const next = await readImportReview();
    setSession(next);
    if (open && next) {
      requestWorkflowMode("import");
      const windowId = windowIdRef.current;
      if (windowId !== null) {
        await patchSidepanelUiState(windowId, {
          mode: "review",
          scroll: {
            [modeRef.current]: window.scrollY,
            review: 0,
          },
        });
      }
      modeRef.current = "review";
      setMode("review");
      restoreScroll(0);
    }
  }

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const currentWindow = await browser.windows.getCurrent();
      if (disposed || currentWindow.id === undefined) return;
      windowIdRef.current = currentWindow.id;

      const [uiState, nextSession, workflowStorage] = await Promise.all([
        readSidepanelUiState(currentWindow.id),
        readImportReview(),
        browser.storage.session.get("burbot:workflow-mode"),
      ]);
      if (disposed) return;

      const workflowMode = workflowStorage["burbot:workflow-mode"];
      const globalImport = workflowMode === "import";
      const initialMode: SidepanelMode =
        nextSession && globalImport ? "review" : "workspace";
      modeRef.current = initialMode;
      setMode(initialMode);
      setSession(nextSession);
      restoreScroll(uiState.scroll[initialMode]);
    })();

    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      void refresh(detail?.open === true);
    };
    window.addEventListener("burbot:import-review-changed", changed);

    const workflowChanged = (event: Event) => {
      const next = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      const reviewMode = next === "import" ? "review" : "workspace";
      modeRef.current = reviewMode;
      setMode(reviewMode);
    };
    window.addEventListener("burbot:workflow-mode", workflowChanged);

    const workspaceReady = () => {
      const windowId = windowIdRef.current;
      if (windowId === null || modeRef.current !== "workspace") return;
      void readSidepanelUiState(windowId).then((state) => {
        if (modeRef.current === "workspace") {
          restoreScroll(state.scroll.workspace);
        }
      });
    };
    window.addEventListener("burbot:workspace-ready", workspaceReady);

    const onScroll = () => {
      if (scrollTimerRef.current !== undefined) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        const windowId = windowIdRef.current;
        if (windowId === null) return;
        void patchSidepanelUiState(windowId, {
          scroll: { [modeRef.current]: window.scrollY },
        });
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      disposed = true;
      window.removeEventListener("burbot:import-review-changed", changed);
      window.removeEventListener("burbot:workflow-mode", workflowChanged);
      window.removeEventListener("burbot:workspace-ready", workspaceReady);
      window.removeEventListener("scroll", onScroll);
      if (scrollTimerRef.current !== undefined) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    const selected =
      session?.selectedObjectId
        ? session.previewState.objects.find(
            (object) => object.id === session.selectedObjectId,
          )
        : undefined;

    if (!selected) {
      setExistingTarget(null);
      return;
    }

    void readActiveDraft().then((draft) => {
      if (cancelled) return;
      const match = findExistingImportObjectMatch(
        selected,
        draft?.workingState,
      );
      setExistingTarget(
        match
          ? {
              id: match.id,
              label: BurbotCore.displayName(match),
            }
          : null,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [session?.selectedObjectId, session?.updatedAt]);

  useEffect(() => {
    const reviewing = Boolean(session && mode === "review");
    document.documentElement.classList.toggle("import-review-mode", reviewing);

    if (!reviewing) {
      void clearPageReviewHighlights().finally(() => {
        window.dispatchEvent(new Event("burbot:selector-highlights-refresh"));
      });
      return () => document.documentElement.classList.remove("import-review-mode");
    }

    void sendReviewHighlights(view);
    const sync = () => void sendReviewHighlights(view);
    const updated = (
      _tabId: number,
      change: { url?: string; status?: string },
    ) => {
      if (change.url || change.status === "complete") sync();
    };
    browser.tabs.onActivated.addListener(sync);
    browser.tabs.onUpdated.addListener(updated);

    return () => {
      browser.tabs.onActivated.removeListener(sync);
      browser.tabs.onUpdated.removeListener(updated);
      document.documentElement.classList.remove("import-review-mode");
    };
  }, [session, mode, view.selectedObjectId, view.evidence]);

  async function select(objectId: string) {
    if (!session) return;
    session.selectedObjectId = objectId;
    session.updatedAt = new Date().toISOString();
    await writeImportReview(session);
    setSession({ ...session });
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

  async function approve() {
    if (!session?.selectedObjectId) return;
    setBusy(true);
    setError("");
    try {
      let draft = await readActiveDraft();
      if (!draft) {
        const created = (await browser.runtime.sendMessage({
          type: "BURBOT_COMMIT",
          op: "NEW",
        })) as { ok?: boolean; error?: string };
        if (!created?.ok) {
          throw new Error(created?.error ?? "Nie udało się uruchomić View.");
        }
        draft = await readActiveDraft();
      }
      if (!draft) throw new Error("Nie udało się uruchomić View.");

      const previewId = session.selectedObjectId;
      const plan: ImportApprovalPlanWithRules = {
        ...buildImportApprovalPlan(session, previewId, draft.workingState),
        reviewRules: reviewedRules(session, previewId),
      };
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

      const storedView = (await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY))[
        OBJECT_VIEW_STORAGE_KEY
      ];
      const nextView = addObjectToView(
        storedView,
        staged.stagedObjectId,
        draft.workingState.objects,
      );
      await browser.storage.session.set({
        [OBJECT_VIEW_STORAGE_KEY]: nextView,
      });

      for (const link of plan.existingReferenceLinks) {
        markImportObjectLinked(
          session,
          link.importKey,
          link.targetObjectId,
          now,
        );
      }

      markImportObjectApproved(
        session,
        previewId,
        staged.stagedObjectId,
        now,
      );
      await writeImportReview(session);
      setSession({ ...session, previewState: { ...session.previewState } });

      const windowId = windowIdRef.current;
      if (windowId !== null) {
        await patchSidepanelUiState(windowId, {
          workspace: {
            objectId: staged.stagedObjectId,
            active: null,
          },
        });
        const focusResponse = (await browser.runtime.sendMessage({
          type: "BURBOT_COMMIT",
          op: "FOCUS",
          windowId,
          objectId: staged.stagedObjectId,
        })) as { ok?: boolean };
        // Approval itself is authoritative. Focusing the workspace is QoL only.
        if (!focusResponse?.ok) {
          // The remembered objectId above still restores the correct object
          // when the sidepanel is reopened.
        }
      }

      window.dispatchEvent(new Event("burbot:commit-changed"));
      window.dispatchEvent(new CustomEvent("burbot:import-review-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rejectSelected() {
    if (!session?.selectedObjectId) return;
    markImportObjectRejected(
      session,
      session.selectedObjectId,
      new Date().toISOString(),
    );
    await writeImportReview(session);
    setSession({ ...session });
    window.dispatchEvent(new CustomEvent("burbot:import-review-changed"));
  }

  async function restoreSelected() {
    if (!session?.selectedObjectId) return;
    restoreRejectedImportObject(
      session,
      session.selectedObjectId,
      new Date().toISOString(),
    );
    await writeImportReview(session);
    setSession({ ...session });
    window.dispatchEvent(new CustomEvent("burbot:import-review-changed"));
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
    const windowId = windowIdRef.current;
    let workspaceScroll = 0;
    if (windowId !== null) {
      const uiState = await readSidepanelUiState(windowId);
      workspaceScroll = uiState.scroll.workspace;
      await patchSidepanelUiState(windowId, {
        mode: "workspace",
        scroll: { review: window.scrollY },
      });
    }
    await clearImportReview();
    setSession(null);
    modeRef.current = "workspace";
    setMode("workspace");
    restoreScroll(workspaceScroll);
    await clearPageReviewHighlights();
    requestWorkflowMode("view");
    window.dispatchEvent(new Event("burbot:selector-highlights-refresh"));
  }

  if (!session) {
    if (mode !== "review") return null;
    return (
      <section className="import-review-shell">
        <div className="import-empty-state">
          <span className="eyebrow">IMPORT</span>
          <h2>Brak aktywnego importu</h2>
          <p>Zaimportuj portable JSON. Obiekty pojawią się tutaj do sprawdzenia, a potem możesz dodać je do View.</p>
          <button
            type="button"
            className="primary"
            onClick={() => document.getElementById("import")?.click()}
          >
            Import JSON
          </button>
        </div>
      </section>
    );
  }

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
  const sourceUrls = [
    ...new Set([
      ...view.evidence.flatMap((entry) =>
        entry.sourceUrl ? [entry.sourceUrl] : [],
      ),
      ...view.files.flatMap((file) => [file.sourcePageUrl, file.url]),
    ]),
  ];

  return (
    <section className="import-review-shell">
      {mode === "review" && (
        <div className="import-review-panel">
          <header className="import-review-header">
            <div>
              <span className="eyebrow">IMPORT REVIEW</span>
              <strong>{view.fileName}</strong>
              <small>
                {view.approvedCount ?? 0} w View · {view.rejectedCount ?? 0} odrzucono · {view.pendingCount ?? 0} oczekuje
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
                          }${object.status === "APPROVED" ? "approved" : object.status === "REJECTED" ? "rejected" : ""}`}
                          onClick={() => void select(object.id)}
                        >
                          <span>{object.label}</span>
                          <small>
                            {object.status === "APPROVED"
                              ? "w View"
                              : object.status === "REJECTED"
                                ? "odrzucono"
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
                    <span className="import-review-edit-badge">Tylko podgląd</span>
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
                      <small>Dane z importu są tylko do odczytu.</small>
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
                        return (
                          <div
                            key={field.field}
                            className={`import-review-workspace-field ${field.evidenceCount ? "has-evidence" : ""}`}
                            data-review-field={field.field}
                            data-review-target-kind="object"
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
                            <div className="import-review-field-head">
                              <small>{field.label}</small>
                              {field.evidenceCount > 0 && (
                                <span style={{ color: color?.border }}>
                                  {field.evidenceCount} evidence
                                </span>
                              )}
                            </div>
                            <strong className="import-review-workspace-value">
                              {field.value || "Nie ustawiono"}
                            </strong>
                            {field.evidenceCount > 0 && hasSource && (
                              <div className="import-review-field-meta">
                                <span>{field.value}</span>
                                <button
                                  type="button"
                                  className="import-review-source-button"
                                  style={{ color: color?.border }}
                                  onClick={() => void showFieldSource(field.field)}
                                >
                                  Pokaż w źródle ↗
                                </button>
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
                            <strong>{file.name}</strong>
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
                        <small>Wartości zostaną zapisane jako konfiguracja finansowania.</small>
                      </div>
                      <div className="import-review-financing">
                        {view.financing.map((variant) => (
                          <details key={variant.id} open className="import-review-finance-card">
                            <summary>
                              <span>
                                {variant.companySizeLabel} · wariant {variant.variantNo}
                              </span>
                              <small>{variant.key}</small>
                            </summary>
                            <div className="import-review-finance-fields">
                              {variant.fields.map((field) => (
                                <label
                                  key={field.field}
                                  className="import-review-workspace-field"
                                >
                                  <small>{field.label}</small>
                                  <strong className="import-review-workspace-value">
                                    {field.value || "Nie ustawiono"}
                                  </strong>
                                </label>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </section>
                  )}

                  <p className="import-review-hint">
                    Import służy do sprawdzenia danych i źródeł. Zaakceptowany obiekt trafia najpierw do View — nie do Commit.
                  </p>
                  {existingTarget && selected.status !== "APPROVED" && (
                    <div className="import-review-update-existing">
                      <strong>Aktualizacja istniejącego obiektu</strong>
                      <span>{existingTarget.label}</span>
                      <small>
                        Dodanie do View zaktualizuje ten sam obiekt roboczy.
                        ID pozostanie bez zmian i duplikat nie zostanie utworzony.
                      </small>
                    </div>
                  )}
                  <div className="import-review-actions">
                    {selected.status === "REJECTED" ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void restoreSelected()}
                      >
                        Przywróć do sprawdzenia
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-button danger"
                          disabled={busy || selected.status === "APPROVED"}
                          onClick={() => void rejectSelected()}
                        >
                          Odrzuć import
                        </button>
                        <button
                          type="button"
                          className="primary import-review-approve"
                          disabled={busy || selected.status === "APPROVED"}
                          onClick={() => void approve()}
                        >
                          {selected.status === "APPROVED"
                            ? "Obiekt jest już w View"
                            : existingTarget
                              ? "Zastosuj zmiany → dodaj do View"
                              : "Dodaj obiekt do View"}
                        </button>
                      </>
                    )}
                  </div>
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
