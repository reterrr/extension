import { useEffect, useState } from "react";
import { readImportReview } from "../shared/import/reviewStore";
import {
  OBJECT_VIEW_STORAGE_KEY,
  normalizeObjectView,
} from "../shared/search/objectView.js";
import type { CommitSessionView } from "../shared/types/commit";
import type { LegacyStorageState } from "../shared/types/legacy-storage";

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
  if (!response?.ok || !response.value) return 0;
  return response.value.objects.filter(
    (object) => object.status !== "UNCHANGED",
  ).length;
}

async function viewCount(): Promise<number> {
  const [stored, stateResponse] = await Promise.all([
    browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY),
    browser.runtime.sendMessage({
      type: "BURBOT_DATA",
      op: "GET",
    }) as Promise<CommitResponse<LegacyStorageState>>,
  ]);
  const value = stored[OBJECT_VIEW_STORAGE_KEY];
  if (!value || !stateResponse?.ok || !stateResponse.value) return 0;
  const normalized = normalizeObjectView(value, stateResponse.value.objects);
  return normalized?.objectIds.length ?? 0;
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
        void refreshCounts();
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
