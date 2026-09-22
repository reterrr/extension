import { useEffect, useState } from "react";
import { readImportReview } from "../shared/import/reviewStore";

type WorkflowMode = "view" | "commit" | "import";
const KEY = "burbot:workflow-mode";

async function readMode(): Promise<WorkflowMode> {
  const stored = await browser.storage.session.get(KEY);
  const value = stored[KEY];
  return value === "commit" || value === "import" ? value : "view";
}

export function WorkflowTabs() {
  const [mode, setModeState] = useState<WorkflowMode>("view");
  const [importCount, setImportCount] = useState(0);

  async function refreshImportCount() {
    const review = await readImportReview();
    if (!review) {
      setImportCount(0);
      return;
    }
    setImportCount(
      review.objectOrder.filter(
        (id) => (review.statusByObjectId[id] ?? "PENDING") === "PENDING",
      ).length,
    );
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
    void refreshImportCount();

    const importChanged = () => void refreshImportCount();
    window.addEventListener("burbot:import-review-changed", importChanged);
    return () => {
      disposed = true;
      window.removeEventListener("burbot:import-review-changed", importChanged);
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
      </button>
      <button
        type="button"
        className={mode === "commit" ? "active" : ""}
        onClick={() => void setMode("commit")}
      >
        Commit
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
