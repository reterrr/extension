import { useEffect, useMemo, useState } from "react";
import { publishUiState } from "../shared/api/storage";
import {
  readActiveDraft,
  writeActiveDraft,
} from "../shared/commits/draftStore";
import {
  buildImportApprovalPlan,
  importReviewView,
  markImportObjectApproved,
} from "../shared/import/review";
import {
  clearImportReview,
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import { stageImportReviewObject } from "../shared/import/stageReview";
import { selectorColor } from "../shared/selectorPalette";
import type {
  ImportReviewSession,
  ImportReviewView,
} from "../shared/types/importReview";

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

export function ImportReviewPanel() {
  const [session, setSession] = useState<ImportReviewSession | null>(null);
  const [mode, setMode] = useState<"workspace" | "review">("workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const view = useMemo(() => importReviewView(session), [session]);

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
    await clearImportReview();
    setSession(null);
    setMode("workspace");
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
                    Import Review służy wyłącznie do sprawdzenia danych i źródeł. Zmiany wykonuj po zatwierdzeniu w Workspace.
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
