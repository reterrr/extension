import { useEffect, useMemo, useState } from "react";
import {
  buildGeographySearchIndex,
  compileObjectSearch,
  createObjectSearchDocument,
} from "../shared/search/objectSearch.js";
import {
  OBJECT_VIEW_STORAGE_KEY,
  addObjectToView,
  createObjectView,
  normalizeObjectView,
  removeObjectFromView,
} from "../shared/search/objectView.js";
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
  const [view, setView] = useState<ObjectView | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function refreshState() {
    try {
      setState(await send<LegacyStorageState>("BURBOT_DATA", "GET"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function refreshView(nextState = state) {
    const stored = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
    setView(
      normalizeObjectView(
        stored[OBJECT_VIEW_STORAGE_KEY],
        nextState.objects,
      ) as ObjectView | null,
    );
  }

  useEffect(() => {
    void (async () => {
      const next = await send<LegacyStorageState>("BURBOT_DATA", "GET");
      setState(next);
      await refreshView(next);
    })().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );

    const stateChanged = (event: Event) => {
      const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail
        ?.state;
      if (next) {
        setState(next);
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
        void refreshView();
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
              : "Cała baza"}
          </strong>
          <small>
            {view?.query
              ? `Z filtra: ${view.query}`
              : view
                ? "Ręcznie wybrany zestaw"
                : "Ustaw View filtrem albo dodaj obiekty przyciskiem +"}
          </small>
        </div>
        {view && (
          <button type="button" className="text-button" onClick={() => run(clear)}>
            Wyczyść
          </button>
        )}
      </header>

      {view && (
        <div className="view-members">
          {activeObjects.length ? (
            activeObjects.map((object) => (
              <div key={object.id} className="view-member">
                <button
                  type="button"
                  className="view-member-open"
                  onClick={() => run(() => openObject(object.id))}
                >
                  <strong>{displayName(object)}</strong>
                  <small>{typeLabel(object)}</small>
                </button>
                <button
                  type="button"
                  className="view-member-remove"
                  aria-label={`Usuń ${displayName(object)} z View`}
                  onClick={() => run(() => remove(object.id))}
                >
                  −
                </button>
              </div>
            ))
          ) : (
            <p className="view-manager-empty">
              View jest pusty. Dodaj obiekty poniżej.
            </p>
          )}
        </div>
      )}

      <div className="view-search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Filtr, np. woj:małopolskie /Nowy Sącz/i type:nabory'
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

      {compiled.error && <p className="view-manager-error">{compiled.error}</p>}

      {query.trim() && !compiled.error && (
        <div className="view-search-results">
          {matches.slice(0, 60).map((object) => {
            const inView = Boolean(view?.objectIds.includes(object.id));
            return (
              <div key={object.id} className="view-search-result">
                <button
                  type="button"
                  className="view-search-open"
                  onClick={() => run(() => openObject(object.id))}
                >
                  <strong>{displayName(object)}</strong>
                  <small>{typeLabel(object)}</small>
                </button>
                <button
                  type="button"
                  className="view-search-toggle"
                  aria-label={
                    inView
                      ? `Usuń ${displayName(object)} z View`
                      : `Dodaj ${displayName(object)} do View`
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
          {!matches.length && (
            <p className="view-manager-empty">Brak pasujących obiektów.</p>
          )}
          {matches.length > 60 && (
            <small className="view-manager-more">
              Pokazano pierwsze 60 z {matches.length}. Zawęź filtr.
            </small>
          )}
        </div>
      )}

      {error && <p className="view-manager-error">{error}</p>}
    </section>
  );
}
