import { useEffect, useMemo, useState } from "react";
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
import type { ImportReviewSession, ImportReviewView } from "../shared/types/importReview";
import type { LegacyStorageState } from "../shared/types/legacy-storage";

const EMPTY: ImportReviewView = { active: false, objects: [], fields: [], evidence: [] };

type DataResponse<T> = { ok?: boolean; value?: T; error?: string };

async function data<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = (await browser.runtime.sendMessage({ type: "BURBOT_DATA", op, ...payload })) as DataResponse<T>;
  if (!response?.ok) throw new Error(response?.error ?? "Workspace operation failed.");
  return response.value as T;
}

async function commitActive(): Promise<boolean> {
  const response = (await browser.runtime.sendMessage({ type: "BURBOT_COMMIT", op: "GET" })) as DataResponse<{ active: boolean }>;
  return Boolean(response?.ok && response.value?.active);
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

async function clearPageReviewHighlights(): Promise<void> {
  const window = await browser.windows.getCurrent();
  const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
  if (!tab?.id) return;
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["import-review-highlights.js"] });
    await browser.tabs.sendMessage(tab.id, { type: "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS", highlights: [] });
  } catch {
    // Visual review is best-effort.
  }
}

async function showEvidence(view: ImportReviewView): Promise<void> {
  const window = await browser.windows.getCurrent();
  const [tab] = await browser.tabs.query({ active: true, windowId: window.id });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;
  const url = comparableUrl(tab.url);
  const highlights = view.evidence
    .filter((entry) => entry.sourceUrl && comparableUrl(entry.sourceUrl) === url)
    .map((entry) => ({
      id: entry.id,
      exact: entry.exact,
      prefix: entry.prefix,
      suffix: entry.suffix,
      colorKey: `${view.selectedObjectId}:${entry.field}`,
    }));
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["import-review-highlights.js"] });
    await browser.tabs.sendMessage(tab.id, { type: "BURBOT_SHOW_IMPORT_REVIEW_HIGHLIGHTS", highlights });
  } catch {
    // Evidence can still be reviewed in the sidebar if a page blocks injection.
  }
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
    const changed = (event: Event) => void refresh((event as CustomEvent<{ open?: boolean }>).detail?.open === true);
    window.addEventListener("burbot:import-review-changed", changed);
    return () => window.removeEventListener("burbot:import-review-changed", changed);
  }, []);

  useEffect(() => {
    const reviewing = Boolean(session && mode === "review");
    document.documentElement.classList.toggle("import-review-mode", reviewing);
    if (reviewing) void showEvidence(view);
    else void clearPageReviewHighlights();
    return () => document.documentElement.classList.remove("import-review-mode");
  }, [session, mode, view.selectedObjectId]);

  async function select(objectId: string) {
    if (!session) return;
    session.selectedObjectId = objectId;
    session.updatedAt = new Date().toISOString();
    await writeImportReview(session);
    setSession({ ...session });
  }

  async function approve() {
    if (!session?.selectedObjectId) return;
    setBusy(true);
    setError("");
    try {
      if (!(await commitActive())) throw new Error("Najpierw rozpocznij New commit w zakładce Workspace.");
      const previewId = session.selectedObjectId;
      const plan = buildImportApprovalPlan(session, previewId);
      let state = await data<LegacyStorageState>("GET");
      const beforeCount = state.objects.length;
      state = await data<LegacyStorageState>("IMPORT", {
        expectedRevision: state.revision,
        document: plan.document,
      });
      const imported = state.objects.slice(beforeCount);
      const selected = imported.find((object) => object.importKey === plan.selectedImportKey);
      if (!selected) throw new Error("Nie udało się odnaleźć zatwierdzonego obiektu w commicie.");

      for (const patch of plan.referencePatches) {
        const targetId = session.approvedObjectIdByImportKey[patch.targetImportKey];
        if (!targetId) throw new Error(`Brak zatwierdzonej referencji ${patch.targetImportKey}.`);
        state = await data<LegacyStorageState>("EDIT", {
          expectedRevision: state.revision,
          objectId: selected.id,
          field: patch.field,
          value: targetId,
        });
      }

      for (const importKey of plan.temporaryDependencyImportKeys) {
        const temporary = imported.find(
          (object) => object.importKey === importKey && object.id !== selected.id,
        );
        if (!temporary) continue;
        state = await data<LegacyStorageState>("DELETE", {
          expectedRevision: state.revision,
          objectId: temporary.id,
        });
      }

      markImportObjectApproved(session, previewId, selected.id, new Date().toISOString());
      await writeImportReview(session);
      setSession({ ...session });
      window.dispatchEvent(new CustomEvent("burbot:import-review-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function closeReview() {
    if (!session) return;
    if ((view.pendingCount ?? 0) > 0 && !confirm("Zamknąć import review? Niezatwierdzone obiekty zostaną odrzucone.")) return;
    await clearImportReview();
    setSession(null);
    setMode("workspace");
    await clearPageReviewHighlights();
  }

  if (!session) return null;

  const groups = ["operator", "project", "recruitment"].map((type) => ({
    type,
    label: groupLabel(type),
    objects: view.objects.filter((object) => object.type === type || (type === "recruitment" && object.type === "nabor")),
  }));
  const selected = view.objects.find((object) => object.id === view.selectedObjectId);
  const sourceUrls = [...new Set(view.evidence.flatMap((entry) => (entry.sourceUrl ? [entry.sourceUrl] : [])))];

  return (
    <section className="import-review-shell">
      <nav className="workspace-mode-tabs" aria-label="Tryb pracy">
        <button type="button" className={mode === "workspace" ? "active" : ""} onClick={() => setMode("workspace")}>Workspace</button>
        <button type="button" className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}>
          Import review <span>{view.pendingCount ?? 0}</span>
        </button>
      </nav>

      {mode === "review" && (
        <div className="import-review-panel">
          <header className="import-review-header">
            <div><span className="eyebrow">IMPORT REVIEW</span><strong>{view.fileName}</strong><small>{view.approvedCount}/{view.objects.length} zatwierdzono</small></div>
            <button type="button" className="text-button" onClick={() => void closeReview()}>Zamknij</button>
          </header>
          <div className="import-review-progress"><span style={{ width: `${view.objects.length ? ((view.approvedCount ?? 0) / view.objects.length) * 100 : 0}%` }} /></div>

          <div className="import-review-layout">
            <aside className="import-review-list">
              {groups.map((group) => group.objects.length > 0 && (
                <details key={group.type} open>
                  <summary>{group.label}<span>{group.objects.length}</span></summary>
                  {group.objects.map((object) => (
                    <button key={object.id} type="button" className={`${object.id === view.selectedObjectId ? "selected " : ""}${object.status === "APPROVED" ? "approved" : ""}`} onClick={() => void select(object.id)}>
                      <span>{object.label}</span><small>{object.status === "APPROVED" ? "✓" : `${object.evidenceCount} evidence`}</small>
                    </button>
                  ))}
                </details>
              ))}
            </aside>

            <div className="import-review-detail">
              {selected ? (
                <>
                  <div className="import-review-object-title"><span className="eyebrow">{selected.type.toUpperCase()}</span><h2>{selected.label}</h2></div>
                  {sourceUrls.length > 0 && <div className="import-review-sources">{sourceUrls.map((url) => <button key={url} className="text-button" onClick={() => void browser.tabs.update({ url })}>Otwórz źródło ↗</button>)}</div>}
                  <div className="import-review-fields">
                    {view.fields.map((field) => (
                      <div key={field.field} className={field.evidenceCount ? "has-evidence" : ""}>
                        <small>{field.label}</small><strong>{field.value}</strong>{field.evidenceCount > 0 && <span>{field.evidenceCount} evidence</span>}
                      </div>
                    ))}
                  </div>
                  <p className="import-review-hint">Na stronie podświetlane są wyłącznie evidence aktualnie wybranego obiektu.</p>
                  <button type="button" className="primary import-review-approve" disabled={busy || selected.status === "APPROVED"} onClick={() => void approve()}>
                    {selected.status === "APPROVED" ? "Zatwierdzono — obiekt jest w commicie" : "Zatwierdź obiekt → dodaj do commita"}
                  </button>
                </>
              ) : <p>Wybierz obiekt do sprawdzenia.</p>}
              {error && <p className="commit-error">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
