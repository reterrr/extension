import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
  OBJECT_VIEW_STORAGE_KEY,
  addObjectToView,
  createObjectView,
  normalizeObjectView,
  removeObjectFromView,
} from "../shared/search/objectView.js";
import type {
  CommitSessionObject,
  CommitSessionView,
} from "../shared/types/commit";
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

function objectCountLabel(count: number): string {
  const form = new Intl.PluralRules("pl").select(count);
  return `${count} ${form === "one" ? "obiekt" : form === "few" ? "obiekty" : "obiektów"}`;
}

function statusLabel(entry: CommitSessionObject | undefined): string {
  if (!entry || entry.status === "UNCHANGED") return "";
  if (entry.status === "NEW") return "Nowy";
  if (entry.status === "DELETED") return "Usunięty";
  return "Zmieniony";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [limit, setLimit] = useState(100);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [activeObjectId, setActiveObjectId] = useState("");
  const [collapsed, setCollapsed] = useState(false);

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
    const activeChanged = () =>
      setActiveObjectId(
        document.getElementById("workspace")?.dataset.activeObjectId ?? "",
      );
    activeChanged();
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
        // A newly created object may be written to Active View immediately
        // after the background saves a newer working draft. Always refresh
        // the authoritative working state first; normalizing against a stale
        // React snapshot would incorrectly delete that fresh object id.
        void refreshState();
      }
    };

    window.addEventListener("burbot:workspace-state-changed", stateChanged);
    window.addEventListener("burbot:commit-changed", commitChanged);
    window.addEventListener("burbot:active-object-changed", activeChanged);
    browser.storage.onChanged.addListener(storageChanged);
    return () => {
      window.removeEventListener(
        "burbot:workspace-state-changed",
        stateChanged,
      );
      window.removeEventListener("burbot:commit-changed", commitChanged);
      window.removeEventListener("burbot:active-object-changed", activeChanged);
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
    if (compiled.error) return [];
    return state.objects
      .filter(
        (object) =>
          (typeFilter === "all" ||
            (object.type === "nabor" ? "recruitment" : object.type) ===
              typeFilter) &&
          compiled.matches(
            createObjectSearchDocument(
              object,
              displayName(object),
              typeLabel(object),
              geography.get(object.id) ?? {},
            ),
          ),
      )
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "pl"));
  }, [compiled, geography, typeFilter, state.objects]);

  useEffect(() => {
    if (pickerOpen && !dialog.current?.open) {
      dialog.current?.showModal();
      searchInput.current?.focus();
    } else if (!pickerOpen) dialog.current?.close();
  }, [pickerOpen]);
  useEffect(() => {
    const open = () => {
      window.dispatchEvent(
        new CustomEvent("burbot:request-workflow-mode", {
          detail: { mode: "view" },
        }),
      );
      setPickerOpen(true);
    };
    window.addEventListener("burbot:open-object-search", open);
    return () => window.removeEventListener("burbot:open-object-search", open);
  }, []);
  useEffect(() => setLimit(100), [query, typeFilter]);

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

  const catalogObjects = matches.slice(0, limit);

  async function persist(next: ObjectView | null) {
    if (next) {
      await browser.storage.session.set({ [OBJECT_VIEW_STORAGE_KEY]: next });
    } else {
      await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
    }
    setView(next);
  }

  async function add(objectId: string) {
    const next = addObjectToView(view, objectId, state.objects) as ObjectView;
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
    if (!matches.length) throw new Error("Brak wyników do utworzenia zestawu.");
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
      throw new Error("Najpierw wybierz obiekty.");
    }

    const exportedAt = new Date().toISOString();
    const payload = createAiViewExport({
      state,
      view,
      schema: globals().BurbotSchema ?? {},
      geographyCatalog: (globals().BurbotGeography?.catalog ?? []) as never[],
      exportedAt,
    });

    downloadJsonFile(aiViewExportFilename(exportedAt), payload);
  }

  async function openObject(objectId: string) {
    setPickerOpen(false);
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

  function resultKeys(event: KeyboardEvent, objectId?: string) {
    const rows = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>(
        ".view-search-open",
      ) ?? [],
    );
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = rows.indexOf(event.currentTarget as HTMLButtonElement);
      const next =
        index < 0
          ? event.key === "ArrowDown"
            ? 0
            : rows.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length;
      rows[next]?.focus();
    } else if (event.key === "Enter" && !objectId && rows.length) {
      event.preventDefault();
      rows[0].click();
    }
  }

  return (
    <section className="view-manager" aria-label="Zestaw roboczy">
      <header className="view-manager-header">
        <strong>{objectCountLabel(activeObjects.length)}</strong>
        <button
          type="button"
          className="view-search-launch"
          onClick={() => setPickerOpen(true)}
          aria-keyshortcuts="Control+k Meta+k"
        >
          Znajdź / wybierz <kbd>Ctrl K</kbd>
        </button>
      </header>
      <div className="view-manager-header-actions">
        <button
          type="button"
          className="view-manager-collapse"
          aria-controls="view-manager-body"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Pokaż zestaw" : "Zwiń zestaw"}
        </button>
        <details className="view-set-menu">
          <summary>Więcej</summary>
          <div>
            <button
              type="button"
              disabled={!activeObjects.length}
              onClick={() => run(exportView)}
            >
              Eksportuj zestaw
            </button>
            <button
              type="button"
              disabled={!activeObjects.length}
              onClick={() => run(clear)}
            >
              Wyczyść zestaw
            </button>
          </div>
        </details>
      </div>
      <div id="view-manager-body" hidden={collapsed}>
        <div className="view-members">
          {activeObjects.map((object) => (
            <div
              key={object.id}
              className={
                activeObjectId === object.id
                  ? "view-member is-active"
                  : "view-member"
              }
            >
              <button
                type="button"
                className="view-member-open"
                aria-current={activeObjectId === object.id ? "true" : undefined}
                title={displayName(object)}
                onClick={() => run(() => openObject(object.id))}
              >
                <strong>{displayName(object)}</strong>
                <small>
                  {[typeLabel(object), statusLabel(commitById.get(object.id))]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
              <button
                type="button"
                className="view-member-remove"
                aria-label={"Usuń " + displayName(object) + " z zestawu"}
                title="Usuń z zestawu roboczego"
                onClick={() => run(() => remove(object.id))}
              >
                −
              </button>
            </div>
          ))}
          {!activeObjects.length && (
            <p className="view-manager-empty">
              Wyszukaj obiekty, nad którymi chcesz pracować.
            </p>
          )}
        </div>
      </div>
      <dialog
        className="view-search-dialog"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dialog.current?.close();
            setPickerOpen(false);
          }
        }}
        onCancel={() => setPickerOpen(false)}
        onClose={() => setPickerOpen(false)}
        aria-labelledby="object-search-title"
      >
        <header className="view-dialog-header">
          <div>
            <h2 id="object-search-title">Wybierz obiekty</h2>
            <small>Enter otwiera · ↑ ↓ nawigują · Esc zamyka</small>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            aria-label="Zamknij wyszukiwarkę"
          >
            Zamknij <kbd>Esc</kbd>
          </button>
        </header>
        <div className="view-dialog-search">
          <input
            ref={searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => resultKeys(event)}
            placeholder="Nazwa, numer, NIP lub geografia…"
            aria-label="Szukaj obiektu"
            aria-describedby="view-search-help"
            aria-invalid={Boolean(compiled.error)}
          />
          <select
            aria-label="Typ obiektu"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">Wszystkie typy</option>
            <option value="recruitment">Nabory</option>
            <option value="project">Projekty</option>
            <option value="operator">Operatorzy</option>
          </select>
        </div>
        <details className="view-search-help">
          <summary>Filtry zaawansowane</summary>
          <small id="view-search-help">
            woj:małopolskie · type:nabory · /Nowy Sącz/i
          </small>
        </details>
        {compiled.error && (
          <p className="view-manager-error" role="alert">
            {compiled.error}
          </p>
        )}
        <div className="view-catalog-head">
          <strong>
            {matches.length}{" "}
            {new Intl.PluralRules("pl").select(matches.length) === "one"
              ? "wynik"
              : new Intl.PluralRules("pl").select(matches.length) === "few"
                ? "wyniki"
                : "wyników"}
          </strong>
          <span>{activeObjects.length} w zestawie</span>
        </div>
        <div className="view-search-results" aria-label="Wyniki wyszukiwania">
          {catalogObjects.map((object) => (
            <div key={object.id} className="view-search-result">
              <label className="view-result-membership">
                <input
                  type="checkbox"
                  checked={Boolean(view?.objectIds.includes(object.id))}
                  aria-label={"W zestawie: " + displayName(object)}
                  onChange={(event) =>
                    run(() =>
                      event.target.checked ? add(object.id) : remove(object.id),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="view-search-open"
                onKeyDown={(event) => resultKeys(event, object.id)}
                aria-current={activeObjectId === object.id ? "true" : undefined}
                onClick={() => run(() => openObject(object.id))}
              >
                <strong>{displayName(object)}</strong>
                <small>
                  {[
                    typeLabel(object),
                    String(object.values?.nip ?? object.values?.number ?? ""),
                    statusLabel(commitById.get(object.id)),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            </div>
          ))}
          {!catalogObjects.length && !compiled.error && (
            <p className="view-manager-empty">Brak pasujących obiektów.</p>
          )}
          {matches.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 100)}>
              Pokaż kolejne 100
            </button>
          )}
        </div>
        <footer className="view-dialog-footer">
          <button
            type="button"
            disabled={Boolean(compiled.error) || !matches.length}
            onClick={() => run(setFromSearch)}
          >
            Ustaw wyniki jako zestaw ({matches.length})
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setPickerOpen(false)}
          >
            Gotowe · {activeObjects.length} wybranych
          </button>
        </footer>
        {error && (
          <p className="view-manager-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
      {error && !pickerOpen && (
        <p className="view-manager-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
