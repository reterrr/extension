import { useEffect, useState } from "react";
import { readImportReviewCount } from "../shared/import/reviewSummary";
import { readCommitSummary } from "./commitSummary";
import { readWorkspaceState } from "./workspaceData";
import {
  OBJECT_VIEW_STORAGE_KEY,
  normalizeObjectView,
} from "../shared/search/objectView.js";

type WorkflowMode = "view" | "commit" | "import";
const KEY = "burbot:workflow-mode";

async function readMode(): Promise<WorkflowMode> {
  const stored = await browser.storage.session.get(KEY);
  const value = stored[KEY];
  return value === "commit" || value === "import" ? value : "view";
}

async function commitCount(): Promise<number> {
  return (await readCommitSummary()).objects.length;
}

async function viewCount(): Promise<number> {
  const [stored, stateResponse] = await Promise.all([
    browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY),
    readWorkspaceState(),
  ]);
  const value = stored[OBJECT_VIEW_STORAGE_KEY];
  if (!value || !stateResponse) return 0;
  const normalized = normalizeObjectView(value, stateResponse.objects);
  return normalized?.objectIds.length ?? 0;
}

export function WorkflowTabs() {
  const [mode, setModeState] = useState<WorkflowMode>("view");
  const [importCount, setImportCount] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [activeViewCount, setActiveViewCount] = useState(0);

  async function refreshCounts() {
    const [review, staged, viewed] = await Promise.all([
      readImportReviewCount(),
      commitCount(),
      viewCount(),
    ]);

    setImportCount(review);
    setStagedCount(staged);
    setActiveViewCount(viewed);
  }

  async function setMode(next: WorkflowMode) {
    setModeState(next);
    document.documentElement.dataset.workflowMode = next;
    window.dispatchEvent(
      new CustomEvent("burbot:workflow-mode", { detail: { mode: next } }),
    );
    await browser.storage.session.set({ [KEY]: next });
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
    void refreshCounts().catch(() => undefined);

    let queued = false;
    let running = false;
    let again = false;
    const refresh = () => {
      again = true;
      if (queued || running) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (disposed) return;
        again = false;
        running = true;
        void refreshCounts()
          .catch(() => undefined)
          .finally(() => {
            running = false;
            if (again && !disposed) refresh();
          });
      });
    };
    const modeRequested = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: WorkflowMode }>).detail
        ?.mode;
      if (
        requested === "view" ||
        requested === "commit" ||
        requested === "import"
      ) {
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
        refresh();
      }
    };

    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new Event("burbot:open-object-search"));
      } else if (
        event.altKey &&
        !mod &&
        ["1", "2", "3"].includes(event.key) &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        void setMode(
          (["view", "commit", "import"] as const)[Number(event.key) - 1],
        );
      } else if (
        mod &&
        event.key === "Enter" &&
        document.documentElement.dataset.workflowMode === "view" &&
        !document.querySelector("dialog[open]")
      ) {
        const save = document.getElementById(
          "save",
        ) as HTMLButtonElement | null;
        if (save && !save.disabled && save.getClientRects().length) {
          event.preventDefault();
          save.click();
        }
      }
    };

    window.addEventListener("burbot:import-review-changed", refresh);
    window.addEventListener("burbot:commit-changed", refresh);
    window.addEventListener("burbot:workspace-state-changed", refresh);
    window.addEventListener("burbot:request-workflow-mode", modeRequested);
    browser.storage.onChanged.addListener(storageChanged);
    document.addEventListener("keydown", keyboard);
    return () => {
      disposed = true;
      window.removeEventListener("burbot:import-review-changed", refresh);
      window.removeEventListener("burbot:commit-changed", refresh);
      window.removeEventListener("burbot:workspace-state-changed", refresh);
      window.removeEventListener("burbot:request-workflow-mode", modeRequested);
      browser.storage.onChanged.removeListener(storageChanged);
      document.removeEventListener("keydown", keyboard);
    };
  }, []);

  return (
    <nav className="workflow-tabs" aria-label="Tryb pracy">
      <button
        type="button"
        className={mode === "view" ? "active" : ""}
        aria-pressed={mode === "view"}
        title="Obiekty · Alt+1"
        aria-keyshortcuts="Alt+1"
        onClick={() => void setMode("view")}
      >
        Obiekty
        {activeViewCount > 0 && <span>{activeViewCount}</span>}
      </button>
      <button
        type="button"
        className={mode === "commit" ? "active" : ""}
        aria-pressed={mode === "commit"}
        title="Zapis zmian · Alt+2"
        aria-keyshortcuts="Alt+2"
        onClick={() => void setMode("commit")}
      >
        Zapis zmian
        {stagedCount > 0 && <span>{stagedCount}</span>}
      </button>
      <button
        type="button"
        className={mode === "import" ? "active" : ""}
        aria-pressed={mode === "import"}
        title="Import · Alt+3"
        aria-keyshortcuts="Alt+3"
        onClick={() => void setMode("import")}
      >
        Import
        {importCount > 0 && <span>{importCount}</span>}
      </button>
    </nav>
  );
}
