import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGeographySearchIndex,
  compileObjectSearch,
  createObjectSearchDocument,
} from "../shared/search/objectSearch.js";
import {
  aiViewExportFilename,
  createAiViewExport,
} from "../shared/export/aiViewExport.js";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";
import { revokeApprovedImportObject } from "../shared/import/review";
import {
  OBJECT_VIEW_STORAGE_KEY,
  addObjectToView,
  createObjectView,
  normalizeObjectView,
  removeObjectFromView,
} from "../shared/search/objectView.js";
import type { CommitSessionObject, CommitSessionView } from "../shared/types/commit";
import type {
  LegacyStorageState,
  LegacyStoredObject,
} from "../shared/types/legacy-storage";

interface RuntimeResponse<T> {
  ok?: boolean;
  value?: T;
  error?: string;
}

interface ObjectView {
  version: 1;
  objectIds: string[];
  query: string;
  type: string;
  createdAt: string;
}

const EMPTY_STATE: LegacyStorageState = {
  version: 1,
  revision: 0,
  objects: [],
  rules: [],
};

const EMPTY_COMMIT: CommitSessionView = {
  active: false,
  dirty: false,
  objects: [],
};

function globals() {
  return globalThis as typeof globalThis & {
    BurbotCore?: { displayName?: (object: LegacyStoredObject) => string };
    BurbotSchema?: Record<string, { label?: string }>;
    BurbotGeography?: { catalog?: unknown[] };
    BurbotDocuments?: { catalog?: unknown[] };
  };
}

function displayName(object: LegacyStoredObject): string {
  const formatter = globals().BurbotCore?.displayName;
  if (formatter) return formatter(object);
  return String(
    object.values?.name ??
      object.values?.external_number ??
      object.label ??
      object.id,
  );
}

function typeLabel(object: LegacyStoredObject): string {
  const key = object.type === "nabor" ? "recruitment" : object.type;
  return globals().BurbotSchema?.[key]?.label ?? key;
}

function statusLabel(entry: CommitSessionObject | undefined): string {
  if (!entry || entry.status === "UNCHANGED") return "";
  if (entry.status === "NEW") return "NEW";
  if (entry.status === "DELETED") return "DELETED";
  return "MODIFIED";
}

function downloadJsonFile(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function send<T>(
  type: "BURBOT_DATA" | "BURBOT_COMMIT",
  op: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    type,
    op,
    ...extra,
  })) as RuntimeResponse<T>;
  if (!response?.ok) throw new Error(response?.error ?? "Operation failed.");
  return response.value as T;
}

export function ViewManagerPanel() {
  const [state, setState] = useState<LegacyStorageState>(EMPTY_STATE);
  const stateRef = useRef<LegacyStorageState>(EMPTY_STATE);
  const [commit, setCommit] = useState<CommitSessionView>(EMPTY_COMMIT);
  const [view, setView] = useState<ObjectView | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyObjectId, setBusyObjectId] = useState("");

  function applyState(nextState: LegacyStorageState) {
    stateRef.current = nextState;
    setState(nextState);
  }

  async function refreshState() {
    try {
      const [nextState, nextCommit] = await Promise.all([
        send<LegacyStorageState>("BURBOT_DATA", "GET"),
        send<CommitSessionView>("BURBOT_COMMIT", "GET"),
      ]);
      applyState(nextState);
      setCommit(nextCommit);
      await refreshView(nextState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function refreshView(nextState = stateRef.current) {
    const stored = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
    const raw = stored[OBJECT_VIEW_STORAGE_KEY];
    const normalized = normalizeObjectView(
      raw,
      nextState.objects,
    ) as ObjectView | null;
    setView(normalized);

    if (!raw) return;
    if (!normalized) {
      await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
      return;
    }

    const rawIds =
      typeof raw === "object" &&
      raw !== null &&
      Array.isArray((raw as { objectIds?: unknown }).objectIds)
        ? (raw as { objectIds: unknown[] }).objectIds.map(String)
        : [];
    if (
      rawIds.length !== normalized.objectIds.length ||
      rawIds.some((id, index) => id !== normalized.objectIds[index])
    ) {
      await browser.storage.session.set({
        [OBJECT_VIEW_STORAGE_KEY]: normalized,
      });
    }
  }

  useEffect(() => {
    void (async () => {
      const [next, nextCommit] = await Promise.all([
        send<LegacyStorageState>("BURBOT_DATA", "GET"),
        send<CommitSessionView>("BURBOT_COMMIT", "GET"),
      ]);
      applyState(next);
      setCommit(nextCommit);
      await refreshView(next);
    })().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );

    const stateChanged = (event: Event) => {
      const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail
        ?.state;
      if (next) {
        applyState(next);
        void refreshView(next);
      } else {
        void refreshState();
      }
    };
    const commitChanged = () => void refreshState();
    const storageChanged = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      area: string,
    ) => {
      if (area === "session" && changes[OBJECT_VIEW_STORAGE_KEY]) {
        void refreshView(stateRef.current);
      }
    };

    window.addEventListener("burbot:workspace-state-changed", stateChanged);
    window.addEventListener("burbot:commit-changed", commitChanged);
    browser.storage.onChanged.addListener(storageChanged);
    return () => {
      window.removeEventListener("burbot:workspace-state-changed", stateChanged);
      window.removeEventListener("burbot:commit-changed", commitChanged);
      browser.storage.onChanged.removeListener(storageChanged);
    };
  }, []);

  const geography = useMemo(
    () =>
      buildGeographySearchIndex(
        state.geographies ?? [],
        (globals().BurbotGeography?.catalog ?? []) as never[],
      ),
    [state.geographies],
  );

  const compiled = useMemo(() => compileObjectSearch(query), [query]);

  const matches = useMemo(() => {
    if (compiled.error || !query.trim()) return [];
    return state.objects.filter((object) =>
      compiled.matches(
        createObjectSearchDocument(
          object,
          displayName(object),
          typeLabel(object),
          geography.get(object.id) ?? {},
        ),
      ),
    );
  }, [compiled, geography, query, state.objects]);

  const activeObjects = useMemo(() => {
    if (!view) return [];
    const byId = new Map(state.objects.map((object) => [object.id, object]));
    return view.objectIds
      .map((id) => byId.get(id))
      .filter((object): object is LegacyStoredObject => Boolean(object));
  }, [state.objects, view]);

  const commitById = useMemo(
    () => new Map(commit.objects.map((entry) => [entry.id, entry])),
    [commit.objects],
  );

  useEffect(() => {
    if (!query && view?.query) setQuery(view.query);
  }, [view?.createdAt]);

  const catalogObjects = useMemo(() => {
    const source = query.trim() && !compiled.error ? matches : state.objects;
    return [...source]
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "pl"))
      .slice(0, 80);
  }, [compiled.error, matches, query, state.objects]);

  async function persist(next: ObjectView | null) {
    if (next) {
      await browser.storage.session.set({ [OBJECT_VIEW_STORAGE_KEY]: next });
    } else {
      await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
    }
    setView(next);
  }

  async function add(objectId: string) {
    const next = addObjectToView(
      view,
      objectId,
      state.objects,
    ) as ObjectView;
    await persist(next);
  }

  async function remove(objectId: string) {
    const next = removeObjectFromView(
      view,
      objectId,
      state.objects,
    ) as ObjectView | null;
    await persist(next);
  }

  async function setFromSearch() {
    if (compiled.error) throw new Error(compiled.error);
    if (!matches.length) throw new Error("Brak wyników do ustawienia View.");
    await persist(
      createObjectView(
        matches,
        query,
        "all",
        new Date().toISOString(),
      ) as ObjectView,
    );
  }

  async function clear() {
    await persist(null);
  }

  async function exportView() {
    if (!view?.objectIds.length) {
      throw new Error("Najpierw ustaw Active View.");
    }

    const exportedAt = new Date().toISOString();
    const payload = createAiViewExport({
      state,
      view,
      schema: globals().BurbotSchema ?? {},
      geographyCatalog: (globals().BurbotGeography?.catalog ?? []) as never[],
      documentCatalog: (globals().BurbotDocuments?.catalog ?? []) as never[],
      exportedAt,
    });

    downloadJsonFile(aiViewExportFilename(exportedAt), payload);
  }

  async function stageObject(objectId: string) {
    setBusyObjectId(objectId);
    try {
      const next = await send<CommitSessionView>(
        "BURBOT_COMMIT",
        "STAGE_OBJECT",
        { objectId },
      );
      setCommit(next);
    } finally {
      setBusyObjectId("");
    }
  }

  async function unstageObject(objectId: string) {
    setBusyObjectId(objectId);
    try {
      const next = await send<CommitSessionView>(
        "BURBOT_COMMIT",
        "UNSTAGE_OBJECT",
        { objectId },
      );
      setCommit(next);
    } finally {
      setBusyObjectId("");
    }
  }

  async function syncDiscardedImport(objectId: string) {
    const review = await readImportReview();
    if (!review) return;

    const importKeys = Object.entries(review.approvedObjectIdByImportKey)
      .filter(([, targetId]) => targetId === objectId)
      .map(([importKey]) => importKey);
    if (!importKeys.length) return;

    const now = new Date().toISOString();
    for (const importKey of importKeys) {
      const preview = review.previewState.objects.find(
        (object) => object.importKey === importKey,
      );
      if (
        preview &&
        review.statusByObjectId[preview.id] === "APPROVED"
      ) {
        revokeApprovedImportObject(review, preview.id, now);
      }
    }
    await writeImportReview(review);
    window.dispatchEvent(
      new CustomEvent("burbot:import-review-changed"),
    );
  }

  async function discardObjectChanges(objectId: string, label: string) {
    if (!confirm("Odrzucić wszystkie niezapisane zmiany obiektu „" + label + "”?")) {
      return;
    }
    setBusyObjectId(objectId);
    try {
      await send<CommitSessionView>("BURBOT_COMMIT", "DISCARD_OBJECT", {
        objectId,
      });
      await syncDiscardedImport(objectId);
      await refreshState();
    } finally {
      setBusyObjectId("");
    }
  }

  async function openObject(objectId: string) {
    if (!view?.objectIds.includes(objectId)) await add(objectId);
    const currentWindow = await browser.windows.getCurrent();
    if (currentWindow.id === undefined) return;
    await send("BURBOT_COMMIT", "FOCUS", {
      windowId: currentWindow.id,
      objectId,
    });
  }

  function run(work: () => Promise<void>) {
    setError("");
    void work().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }

  return (
    <section className="view-manager">
      <header className="view-manager-header">
        <div>
          <span className="eyebrow">ACTIVE VIEW</span>
          <strong>
            {view
              ? `${activeObjects.length} ${activeObjects.length === 1 ? "obiekt" : "obiektów"}`
              : "View nieustawiony"}
          </strong>
          <small>
            {view?.query
              ? `Filtr: ${view.query}`
              : view
                ? "Ręcznie wybrany zestaw"
                : "Najpierw wybierz obiekty: ustaw filtr/regex albo dodaj je ręcznie przyciskiem +"}
          </small>
        </div>
        <div className="view-manager-header-actions">
          {view && (
            <>
              <button
                type="button"
                className="text-button"
                onClick={() => run(exportView)}
              >
                Eksport View
              </button>
              <button type="button" className="text-button" onClick={() => run(clear)}>
                Wyczyść View
              </button>
            </>
          )}
        </div>
      </header>

      {view && (
        <div className="view-members">
          {activeObjects.length ? (
            activeObjects.map((object) => {
              const entry = commitById.get(object.id);
              const changed = Boolean(entry && entry.status !== "UNCHANGED");
              const busy = busyObjectId === object.id;
              return (
                <div key={object.id} className="view-member">
                  <button
                    type="button"
                    className="view-member-open"
                    onClick={() => run(() => openObject(object.id))}
                  >
                    <strong>{displayName(object)}</strong>
                    <small>
                      {typeLabel(object)}
                      {changed ? " · " + statusLabel(entry) : ""}
                    </small>
                  </button>

                  {changed && (
                    <button
                      type="button"
                      className={
                        entry?.staged
                          ? "view-member-stage is-staged"
                          : "view-member-stage"
                      }
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          entry?.staged
                            ? unstageObject(object.id)
                            : stageObject(object.id),
                        )
                      }
                    >
                      {entry?.staged ? "✓ Commit" : "→ Commit"}
                    </button>
                  )}

                  {changed && (
                    <button
                      type="button"
                      className="view-member-discard"
                      disabled={busy}
                      title="Odrzuć zmiany obiektu i wróć do stanu z SQLite"
                      onClick={() =>
                        run(() =>
                          discardObjectChanges(object.id, displayName(object)),
                        )
                      }
                    >
                      ↶
                    </button>
                  )}

                  <button
                    type="button"
                    className="view-member-remove"
                    aria-label={"Usuń " + displayName(object) + " z View"}
                    onClick={() => run(() => remove(object.id))}
                  >
                    −
                  </button>
                </div>
              );
            })
          ) : (
            <p className="view-manager-empty">
              View jest pusty. Dodaj obiekty poniżej.
            </p>
          )}
        </div>
      )}
      <details
        className="view-manager-catalog"
        open={Boolean(!view || activeObjects.length === 0)}
      >
        <summary>
          <span>
            <strong>Zarządzaj View</strong>
            <small>Tu definiujesz jedyny aktywny zestaw roboczy</small>
          </span>
          <span className="view-manager-catalog-count">
            {query.trim() && !compiled.error ? matches.length : state.objects.length}
          </span>
        </summary>

        <div className="view-manager-catalog-body">
          <div className="view-search">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Regex / filtr, np. woj:małopolskie /Nowy Sącz/i type:nabory'
              aria-label="Filtr View"
            />
            <button
              type="button"
              disabled={!query.trim() || Boolean(compiled.error) || !matches.length}
              onClick={() => run(setFromSearch)}
            >
              Ustaw View{matches.length ? ` · ${matches.length}` : ""}
            </button>
          </div>

          {compiled.error && (
            <p className="view-manager-error">{compiled.error}</p>
          )}

          <div className="view-catalog-head">
            <strong>{query.trim() ? "Wyniki filtra" : "Obiekty"}</strong>
            <small>
              {query.trim()
                ? matches.length + " wyników · kliknij + / −"
                : "Kliknij +, aby dodać ręcznie do View"}
            </small>
          </div>

          {!compiled.error && (
            <div className="view-search-results">
              {catalogObjects.map((object) => {
                const inView = Boolean(view?.objectIds.includes(object.id));
                const entry = commitById.get(object.id);
                return (
                  <div key={object.id} className="view-search-result">
                    <button
                      type="button"
                      className="view-search-open"
                      onClick={() => run(() => openObject(object.id))}
                    >
                      <strong>{displayName(object)}</strong>
                      <small>
                        {typeLabel(object)}
                        {entry && entry.status !== "UNCHANGED"
                          ? " · " + statusLabel(entry)
                          : ""}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="view-search-toggle"
                      aria-label={
                        (inView ? "Usuń " : "Dodaj ") +
                        displayName(object) +
                        (inView ? " z View" : " do View")
                      }
                      onClick={() =>
                        run(() => (inView ? remove(object.id) : add(object.id)))
                      }
                    >
                      {inView ? "−" : "+"}
                    </button>
                  </div>
                );
              })}
              {!catalogObjects.length && (
                <p className="view-manager-empty">Brak pasujących obiektów.</p>
              )}
              {(query.trim() ? matches.length : state.objects.length) > 80 && (
                <small className="view-manager-more">
                  Pokazano pierwsze 80. Zawęź filtr, aby znaleźć konkretny obiekt.
                </small>
              )}
            </div>
          )}
        </div>
      </details>

      {error && <p className="view-manager-error">{error}</p>}
    </section>
  );
}
