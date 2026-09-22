import { useEffect, useMemo, useState } from "react";
import type {
  CommitRelatedChange,
  CommitSessionObject,
  CommitSessionView,
  CommitValueChange,
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

const VALUE_LABELS: Record<string, string> = {
  OGLOSZONY: "Ogłoszony",
  PLANOWANY: "Planowany",
  AKTYWNY: "Aktywny",
  ZAWIESZONY: "Zawieszony",
  ZAMKNIETY: "Zamknięty",
  ZAKONCZONY: "Zakończony",
  ANULOWANY: "Anulowany",
  OPERATOR: "Operator",
  PARTNER: "Partner",
  GLOWNY: "Główny",
  DODATKOWY: "Dodatkowy",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Nazwa",
  external_number: "Numer / nazwa naboru",
  source_number: "Numer źródłowy",
  sequence_number: "Numer kolejny",
  number: "Numer projektu",
  status: "Status",
  operator_id: "Operator",
  project_id: "Projekt",
  type: "Typ",
  nip: "NIP",
  role: "Rola",
  address: "Adres",
  website: "Strona WWW",
  notes: "Uwagi",
  sourceUrl: "Źródło",
  start_date: "Data rozpoczęcia",
  end_date: "Data zakończenia",
  planned_start_date: "Planowana data rozpoczęcia",
  planned_end_date: "Planowana data zakończenia",
  dataRozpoczeciaOd: "Rozpoczęcie od",
  dataRozpoczeciaDo: "Rozpoczęcie do",
  dataZakonczeniaOd: "Zakończenie od",
  dataZakonczeniaDo: "Zakończenie do",
  announcements_site_url: "Strona naborów",
  documents_url: "Strona dokumentów",
  action_code: "Kod działania",
  direct_recruitment_link: "Bezpośredni link do naboru",
  funding_rules: "Zasady dofinansowania",
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

function statusLabel(status: CommitSessionObject["status"]): string {
  if (status === "NEW") return "NEW";
  if (status === "MODIFIED") return "MODIFIED";
  if (status === "DELETED") return "DELETED";
  return "UNCHANGED";
}

function typeLabel(type: CommitSessionObject["type"]): string {
  if (type === "operator") return "Operator";
  if (type === "project") return "Projekt";
  return "Nabór";
}

function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("pl-PL"));
}

function displayDiffValue(value: string | undefined): string {
  if (!value) return "";
  return VALUE_LABELS[value] ?? value;
}

function relatedCount(change: CommitRelatedChange): number {
  return change.added + change.modified + change.removed;
}

function objectChangeCount(object: CommitSessionObject): number {
  return (
    object.changes.length +
    object.relatedChanges.reduce((sum, change) => sum + relatedCount(change), 0)
  );
}

function RelatedChange({ change }: { change: CommitRelatedChange }) {
  return (
    <div className="commit-related-change">
      <span>{change.label}</span>
      <span className="commit-related-counts">
        {change.added > 0 && <b className="is-added">+{change.added}</b>}
        {change.modified > 0 && <b className="is-modified">~{change.modified}</b>}
        {change.removed > 0 && <b className="is-removed">−{change.removed}</b>}
      </span>
    </div>
  );
}

function FieldChange({ change }: { change: CommitValueChange }) {
  return (
    <div className="commit-field-change">
      <span className="commit-field-name">{fieldLabel(change.field)}</span>
      <div className="commit-field-values">
        {change.status === "ADDED" ? (
          <span className="commit-value-after">+ {displayDiffValue(change.after)}</span>
        ) : change.status === "REMOVED" ? (
          <>
            <span className="commit-value-before">{displayDiffValue(change.before)}</span>
            <span className="commit-arrow">→</span>
            <span className="commit-value-removed">usunięto</span>
          </>
        ) : (
          <>
            <span className="commit-value-before">{displayDiffValue(change.before)}</span>
            <span className="commit-arrow">→</span>
            <span className="commit-value-after">{displayDiffValue(change.after)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeCard({
  object,
  busy,
  onFocus,
  onUnstage,
  onDiscard,
}: {
  object: CommitSessionObject;
  busy: boolean;
  onFocus: (objectId: string) => Promise<void>;
  onUnstage: (objectId: string) => Promise<void>;
  onDiscard: (objectId: string) => Promise<void>;
}) {
  const deleted = object.status === "DELETED";
  const count = objectChangeCount(object);

  return (
    <details
      className={"commit-change-card commit-change-" + object.status.toLowerCase()}
    >
      <summary>
        <span
          className={"commit-status commit-status-" + object.status.toLowerCase()}
        >
          {statusLabel(object.status)}
        </span>
        <span className="commit-change-copy">
          <strong>{object.label}</strong>
          <small>
            {typeLabel(object.type)}
            {count > 0
              ? " · " + count + " " + (count === 1 ? "zmiana" : "zmian")
              : ""}
          </small>
        </span>
        <span className="commit-chevron" aria-hidden="true">›</span>
      </summary>

      <div className="commit-change-body">
        {deleted && (
          <p className="commit-delete-note">Obiekt zostanie usunięty z SQLite.</p>
        )}

        {object.changes.length > 0 && (
          <div className="commit-field-diff">
            {object.changes.map((change) => (
              <FieldChange key={change.field} change={change} />
            ))}
          </div>
        )}

        {object.relatedChanges.length > 0 && (
          <div className="commit-related-diff">
            {object.relatedChanges.map((change) => (
              <RelatedChange key={change.key} change={change} />
            ))}
          </div>
        )}

        <div className="commit-object-actions">
          {!deleted && (
            <button
              type="button"
              className="commit-focus"
              disabled={busy}
              onClick={() => void onFocus(object.id)}
            >
              Otwórz w View
            </button>
          )}
          <button
            type="button"
            className="commit-unstage"
            disabled={busy}
            onClick={() => void onUnstage(object.id)}
          >
            Usuń z commita
          </button>
          <button
            type="button"
            className="commit-discard-object"
            disabled={busy}
            onClick={() => void onDiscard(object.id)}
          >
            Odrzuć zmiany obiektu
          </button>
        </div>
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

  const stagedObjects = useMemo(() => {
    const rank = { NEW: 0, MODIFIED: 1, DELETED: 2, UNCHANGED: 3 } as const;
    return session.objects
      .filter((object) => object.status !== "UNCHANGED" && object.staged)
      .sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          a.label.localeCompare(b.label, "pl"),
      );
  }, [session.objects]);

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

  async function unstageObject(objectId: string) {
    await run(
      () => sendCommit<CommitSessionView>("UNSTAGE_OBJECT", { objectId }),
      setSession,
    );
  }

  async function discardObject(objectId: string) {
    if (!confirm("Odrzucić wszystkie zmiany tego obiektu z View?")) return;
    await run(
      () => sendCommit<CommitSessionView>("DISCARD_OBJECT", { objectId }),
      setSession,
    );
  }


  if (!session.active) {
    return (
      <section className="commit-panel commit-panel-idle">
        <div>
          <strong>Zmiany w bazie</strong>
          <p>Uruchom View, aby rozpocząć pracę na zmianach przed zapisem do SQLite.</p>
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
        <div className="commit-title">
          <strong>Commit {session.id?.slice(0, 8)}</strong>
          <small>
            r{session.baseRevision} · {stagedObjects.length} w commicie
            {(session.pendingViewCount ?? 0) > 0
              ? " · " + session.pendingViewCount + " tylko w View"
              : ""}
          </small>
        </div>
        <span className={session.dirty ? "commit-dirty" : "commit-clean"}>
          {session.dirty ? "UNCOMMITTED" : "CLEAN"}
        </span>
      </div>

      <div className="commit-staged">
        {stagedObjects.length ? (
          stagedObjects.map((object) => (
            <ChangeCard
              key={object.id}
              object={object}
              busy={busy}
              onFocus={focusObject}
              onUnstage={unstageObject}
              onDiscard={discardObject}
            />
          ))
        ) : (
          <p className="commit-empty">Brak obiektów w commicie. Dodaj obiekt z zakładki View.</p>
        )}
      </div>

      <div className="commit-actions">
        <button
          type="button"
          className="commit-discard"
          disabled={busy}
          onClick={() => {
            if (!confirm("Odrzucić cały View i wszystkie niezapisane zmiany?")) return;
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
