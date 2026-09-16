import { useEffect, useMemo, useState } from "react";
import type {
  CommitSessionObject,
  CommitSessionView,
} from "../shared/types/commit";

interface CommitResponse<T> {
  ok?: boolean;
  value?: T;
  error?: string;
}

interface CommitResult {
  session: CommitSessionView;
}

const EMPTY_SESSION: CommitSessionView = {
  active: false,
  dirty: false,
  objects: [],
};

async function sendCommit<T>(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op,
    ...payload,
  })) as CommitResponse<T>;

  if (!response?.ok) {
    throw new Error(response?.error ?? "Commit operation failed.");
  }
  return response.value as T;
}

async function currentWindowId(): Promise<number> {
  const window = await browser.windows.getCurrent();
  if (window.id === undefined) throw new Error("Could not resolve the current window.");
  return window.id;
}

function statusLabel(status: CommitSessionObject["status"]): string | null {
  if (status === "NEW") return "NEW";
  if (status === "MODIFIED") return "MODIFIED";
  if (status === "DELETED") return "DELETED";
  return null;
}

function ObjectGroup({
  label,
  createType,
  objects,
  busy,
  onFocus,
  onCreate,
}: {
  label: string;
  createType: "project" | "operator" | "recruitment";
  objects: CommitSessionObject[];
  busy: boolean;
  onFocus: (objectId: string) => Promise<void>;
  onCreate: (type: "project" | "operator" | "recruitment") => Promise<void>;
}) {
  return (
    <details className="commit-group">
      <summary>
        <span>{label}</span>
        <span className="commit-count">{objects.length}</span>
      </summary>
      <div className="commit-group-body">
        <button
          type="button"
          className="commit-add-object"
          disabled={busy}
          onClick={() => void onCreate(createType)}
          title="Najpierw zaznacz nazwę obiektu na aktywnej stronie"
        >
          + Dodaj z zaznaczenia
        </button>
        {objects.length === 0 ? (
          <p className="commit-empty">Brak obiektów w bazie.</p>
        ) : (
          <div className="commit-object-list">
            {objects.map((object) => {
              const badge = statusLabel(object.status);
              const deleted = object.status === "DELETED";
              return (
                <button
                  key={object.id}
                  type="button"
                  className={`commit-object-row${deleted ? " commit-object-deleted" : ""}`}
                  disabled={busy || deleted}
                  onClick={() => void onFocus(object.id)}
                >
                  <span className="commit-object-label">{object.label}</span>
                  {badge && (
                    <span
                      className={`commit-status commit-status-${object.status.toLowerCase()}`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

export function CommitPanel() {
  const [session, setSession] = useState<CommitSessionView>(EMPTY_SESSION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const next = await sendCommit<CommitSessionView>("GET");
      setSession(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
    const listener = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "BURBOT_COMMIT_CHANGED"
      ) {
        void refresh();
      }
      return undefined;
    };
    const localChanged = () => void refresh();
    browser.runtime.onMessage.addListener(listener);
    window.addEventListener("burbot:commit-changed", localChanged);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      window.removeEventListener("burbot:commit-changed", localChanged);
    };
  }, []);

  const groups = useMemo(() => {
    const sort = (items: CommitSessionObject[]) =>
      [...items].sort((a, b) => {
        const rank = { NEW: 0, MODIFIED: 1, DELETED: 2, UNCHANGED: 3 } as const;
        return rank[a.status] - rank[b.status] || a.label.localeCompare(b.label, "pl");
      });
    return {
      operators: sort(session.objects.filter((object) => object.type === "operator")),
      projects: sort(session.objects.filter((object) => object.type === "project")),
      recruitments: sort(
        session.objects.filter(
          (object) => object.type === "recruitment" || object.type === "nabor",
        ),
      ),
    };
  }, [session.objects]);

  const stagedObjectCount = session.objects.filter(
    (object) => object.status !== "UNCHANGED",
  ).length;

  async function run<T>(work: () => Promise<T>, apply?: (value: T) => void) {
    setBusy(true);
    setError("");
    try {
      const value = await work();
      apply?.(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function focusObject(objectId: string) {
    await run(async () => {
      const windowId = await currentWindowId();
      return sendCommit<CommitSessionView>("FOCUS", { windowId, objectId });
    });
  }

  async function createObject(type: "project" | "operator" | "recruitment") {
    await run(
      async () => {
        const windowId = await currentWindowId();
        return sendCommit<CommitSessionView>("CREATE_OBJECT", {
          windowId,
          objectType: type,
        });
      },
      setSession,
    );
  }

  if (!session.active) {
    return (
      <section className="commit-panel commit-panel-idle">
        <div>
          <strong>Zmiany w bazie</strong>
          <p>Rozpocznij commit, zanim zaczniesz dodawać lub zmieniać obiekty.</p>
        </div>
        <button
          type="button"
          className="commit-primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => sendCommit<CommitSessionView>("NEW"),
              setSession,
            )
          }
        >
          New commit
        </button>
        {error && <p className="commit-error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="commit-panel commit-panel-active">
      <div className="commit-header">
        <div>
          <span className="commit-eyebrow">ACTIVE COMMIT</span>
          <strong>Commit {session.id?.slice(0, 8)}</strong>
          <small>
            baza r{session.baseRevision} · {stagedObjectCount} zmian obiektowych
          </small>
        </div>
        <span className={session.dirty ? "commit-dirty" : "commit-clean"}>
          {session.dirty ? "UNCOMMITTED" : "CLEAN"}
        </span>
      </div>

      <div className="commit-groups">
        <ObjectGroup
          label="Operatorzy"
          createType="operator"
          objects={groups.operators}
          busy={busy}
          onFocus={focusObject}
          onCreate={createObject}
        />
        <ObjectGroup
          label="Projekty"
          createType="project"
          objects={groups.projects}
          busy={busy}
          onFocus={focusObject}
          onCreate={createObject}
        />
        <ObjectGroup
          label="Nabory"
          createType="recruitment"
          objects={groups.recruitments}
          busy={busy}
          onFocus={focusObject}
          onCreate={createObject}
        />
      </div>

      <p className="commit-hint">
        Nowy obiekt: zaznacz jego nazwę na stronie i kliknij „Dodaj z zaznaczenia” albo użyj
        prawego przycisku → Create Burbot object.
      </p>

      <div className="commit-actions">
        <button
          type="button"
          className="commit-discard"
          disabled={busy}
          onClick={() => {
            if (!confirm("Odrzucić wszystkie staged zmiany w tym commicie?")) return;
            void run(
              () => sendCommit<CommitResult>("DISCARD"),
              (value) => setSession(value.session),
            );
          }}
        >
          Discard
        </button>
        <button
          type="button"
          className="commit-primary"
          disabled={busy || !session.dirty}
          onClick={() =>
            void run(
              () => sendCommit<CommitResult>("COMMIT"),
              (value) => setSession(value.session),
            )
          }
        >
          Commit to SQLite
        </button>
      </div>
      {error && <p className="commit-error">{error}</p>}
    </section>
  );
}
