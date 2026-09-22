import { useEffect, useState } from "react";
import { readImportReview } from "../shared/import/reviewStore";
import { OBJECT_VIEW_STORAGE_KEY } from "../shared/search/objectView.js";
import type { CommitSessionView } from "../shared/types/commit";

type WorkflowMode = "view" | "commit" | "import";
const KEY = "burbot:workflow-mode";

interface CommitResponse<T> {
  ok?: boolean;
  value?: T;
}

async function readMode(): Promise<WorkflowMode> {
  const stored = await browser.storage.session.get(KEY);
  const value = stored[KEY];
  return value === "commit" || value === "import" ? value : "view";
}

async function commitCount(): Promise<number> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op: "GET",
  })) as CommitResponse<CommitSessionView>;
  if (!response?.ok) return 0;
  return response.value.objects.filter(
    (object) => object.staged && object.status !== "UNCHANGED",
  ).length;
}

async function viewCount(): Promise<number> {
  const stored = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
  const value = stored[OBJECT_VIEW_STORAGE_KEY] as
    | { objectIds?: unknown }
    | undefined;
  return Array.isArray(value?.objectIds) ? value.objectIds.length : 0;
}

export function WorkflowTabs() {
  const [mode, setModeState] = useState<WorkflowMode>("view");
  const [importCount, setImportCount] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [activeViewCount, setActiveViewCount] = useState(0);

  async function refreshCounts() {
    const [review, staged, viewed] = await Promise.all([
      readImportReview(),
      commitCount(),
      viewCount(),
    ]);

    setImportCount(
      review
        ? review.objectOrder.filter(
            (id) => (review.statusByObjectId[id] ?? "PENDING") === "PENDING",
          ).length
        : 0,
    );
    setStagedCount(staged);
    setActiveViewCount(viewed);
  }

  async function setMode(next: WorkflowMode) {
    setModeState(next);
    await browser.storage.session.set({ [KEY]: next });
    document.documentElement.dataset.workflowMode = next;
    window.dispatchEvent(
      new CustomEvent("burbot:workflow-mode", { detail: { mode: next } }),
    );
  }

  useEffect(() => {
    let disposed = false;
    void readMode().then((initial) => {
      if (disposed) return;
      setModeState(initial);
      document.documentElement.dataset.workflowMode = initial;
      window.dispatchEvent(
        new CustomEvent("burbot:workflow-mode", { detail: { mode: initial } }),
      );
    });
    void refreshCounts();

    const refresh = () => void refreshCounts();
    const modeRequested = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: WorkflowMode }>).detail?.mode;
      if (requested === "view" || requested === "commit" || requested === "import") {
        void setMode(requested);
      }
    };
    const storageChanged = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      area: string,
    ) => {
      if (
        area === "session" &&
        (changes[OBJECT_VIEW_STORAGE_KEY] || changes[KEY])
      ) {
        void refreshCounts();
      }
    };

    window.addEventListener("burbot:import-review-changed", refresh);
    window.addEventListener("burbot:commit-changed", refresh);
    window.addEventListener("burbot:workspace-state-changed", refresh);
    window.addEventListener("burbot:request-workflow-mode", modeRequested);
    browser.storage.onChanged.addListener(storageChanged);
    return () => {
      disposed = true;
      window.removeEventListener("burbot:import-review-changed", refresh);
      window.removeEventListener("burbot:commit-changed", refresh);
      window.removeEventListener("burbot:workspace-state-changed", refresh);
      window.removeEventListener("burbot:request-workflow-mode", modeRequested);
      browser.storage.onChanged.removeListener(storageChanged);
    };
  }, []);

  return (
    <nav className="workflow-tabs" aria-label="Workflow Burbot">
      <button
        type="button"
        className={mode === "view" ? "active" : ""}
        onClick={() => void setMode("view")}
      >
        View
        {activeViewCount > 0 && <span>{activeViewCount}</span>}
      </button>
      <button
        type="button"
        className={mode === "commit" ? "active" : ""}
        onClick={() => void setMode("commit")}
      >
        Commit
        {stagedCount > 0 && <span>{stagedCount}</span>}
      </button>
      <button
        type="button"
        className={mode === "import" ? "active" : ""}
        onClick={() => void setMode("import")}
      >
        Import
        {importCount > 0 && <span>{importCount}</span>}
      </button>
    </nav>
  );
}
