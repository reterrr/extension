import { useEffect, useMemo, useState } from "react";
import {
  importReviewView,
  markImportObjectPending,
} from "../shared/import/review";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import {
  normalizeObjectView,
  OBJECT_VIEW_STORAGE_KEY,
} from "../shared/search/objectView.js";
import type { ImportReviewSession } from "../shared/types/importReview";
import type { LegacyStorageState } from "../shared/types/legacy-storage";
import { stageImportedObjectToCommit } from "./importWorkflow";

async function workspaceState(): Promise<LegacyStorageState | null> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op: "GET",
  })) as {
    ok?: boolean;
    value?: LegacyStorageState;
  };
  return response?.ok && response.value ? response.value : null;
}

function typeLabel(type: string): string {
  if (type === "operator") return "Operator";
  if (type === "project") return "Projekt";
  return "Nabór";
}

export function ActiveViewPanel() {
  const [session, setSession] = useState<ImportReviewSession | null>(null);
  const [viewInfo, setViewInfo] = useState<{
    count: number;
    query: string;
    explicit: boolean;
  }>({ count: 0, query: "", explicit: false });
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [review, state, stored] = await Promise.all([
      readImportReview(),
      workspaceState(),
      browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY),
    ]);
    setSession(review);
    if (!state) return;

    const activeView = normalizeObjectView(
      stored[OBJECT_VIEW_STORAGE_KEY],
      state.objects,
    );
    setViewInfo({
      count: activeView?.objectIds.length ?? state.objects.length,
      query:
        activeView?.query ||
        (activeView && activeView.type !== "all"
          ? "type:" + activeView.type
          : ""),
      explicit: Boolean(activeView),
    });
  }

  useEffect(() => {
    void refresh();

    const changed = () => void refresh();
    const runtimeChanged = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        ["BURBOT_IMPORT_REVIEW_CHANGED", "BURBOT_COMMIT_CHANGED"].includes(
          String((message as { type?: unknown }).type ?? ""),
        )
      ) {
        void refresh();
      }
      return undefined;
    };
    window.addEventListener("burbot:import-review-changed", changed);
    window.addEventListener("burbot:object-view-changed", changed);
    window.addEventListener("burbot:workspace-state-changed", changed);
    browser.runtime.onMessage.addListener(runtimeChanged);
    return () => {
      window.removeEventListener("burbot:import-review-changed", changed);
      window.removeEventListener("burbot:object-view-changed", changed);
      window.removeEventListener("burbot:workspace-state-changed", changed);
      browser.runtime.onMessage.removeListener(runtimeChanged);
    };
  }, []);

  const review = useMemo(() => importReviewView(session), [session]);
  const imported = review.objects.filter((object) => object.status === "IN_VIEW");

  async function removeImported(previewObjectId: string) {
    if (!session) return;
    setBusyId(previewObjectId);
    setError("");
    try {
      markImportObjectPending(
        session,
        previewObjectId,
        new Date().toISOString(),
      );
      await writeImportReview(session);
      setSession({ ...session, previewState: { ...session.previewState } });
      window.dispatchEvent(
        new CustomEvent("burbot:import-review-changed"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId("");
    }
  }

  async function stageImported(previewObjectId: string) {
    setBusyId(previewObjectId);
    setError("");
    try {
      const { stagedObjectId } =
        await stageImportedObjectToCommit(previewObjectId);
      const window = await browser.windows.getCurrent();
      if (window.id !== undefined) {
        await browser.runtime.sendMessage({
          type: "BURBOT_COMMIT",
          op: "FOCUS",
          windowId: window.id,
          objectId: stagedObjectId,
        });
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="active-view-panel">
      <div className="active-view-panel-heading">
        <div>
          <span className="eyebrow">AKTYWNY WIDOK</span>
          <strong>
            {viewInfo.count} {viewInfo.count === 1 ? "obiekt" : "obiektów"}
          </strong>
          <small>
            {viewInfo.explicit
              ? viewInfo.query || "widok ustawiony ręcznie"
              : "wszystkie obiekty · ustaw regex w wyszukiwarce obiektów"}
          </small>
        </div>
        <span className="active-view-mode-badge">
          {viewInfo.explicit ? "FILTERED" : "ALL"}
        </span>
      </div>

      {imported.length > 0 && (
        <div className="active-view-imports">
          <div className="active-view-imports-heading">
            <strong>Z importu</strong>
            <small>{imported.length} czeka na commit</small>
          </div>
          {imported.map((object) => (
            <div key={object.id} className="active-view-import-row">
              <div>
                <strong>{object.label}</strong>
                <small>{typeLabel(object.type)} · zaakceptowano do Widoku</small>
              </div>
              <div className="active-view-import-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(busyId)}
                  onClick={() => void removeImported(object.id)}
                >
                  Usuń z Widoku
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busyId)}
                  onClick={() => void stageImported(object.id)}
                >
                  {busyId === object.id ? "Dodaję…" : "Dodaj do commita"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="active-view-error">{error}</p>}
    </section>
  );
}
