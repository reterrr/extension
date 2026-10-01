import "./commitStyles";
import { useEffect, useMemo, useState } from "react";
import type {
  CommitReviewItem,
  CommitSessionObject,
  CommitSessionView,
} from "../shared/types/commit";

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
  planned_start_low_date: "Planowany start — data od",
  planned_start_ceil_date: "Planowany start — data do",
  planned_start_time: "Planowany start — godzina",
  planned_start_low_time: "Planowany start — godzina od (legacy)",
  planned_start_ceil_time: "Planowany start — godzina do (legacy)",
  planned_end_low_date: "Planowany koniec — data od",
  planned_end_ceil_date: "Planowany koniec — data do",
  planned_end_time: "Planowany koniec — godzina",
  planned_end_low_time: "Planowany koniec — godzina od (legacy)",
  planned_end_ceil_time: "Planowany koniec — godzina do (legacy)",
  planned_start_low_year: "Planowany start — rok od",
  planned_start_ceil_year: "Planowany start — rok do",
  planned_start_low_month: "Planowany start — miesiąc od",
  planned_start_ceil_month: "Planowany start — miesiąc do",
  planned_start_low_week: "Planowany start — tydzień od",
  planned_start_ceil_week: "Planowany start — tydzień do",
  planned_start_low_quarter: "Planowany start — kwartał od",
  planned_start_ceil_quarter: "Planowany start — kwartał do",
  planned_end_low_year: "Planowany koniec — rok od",
  planned_end_ceil_year: "Planowany koniec — rok do",
  planned_end_low_month: "Planowany koniec — miesiąc od",
  planned_end_ceil_month: "Planowany koniec — miesiąc do",
  planned_end_low_week: "Planowany koniec — tydzień od",
  planned_end_ceil_week: "Planowany koniec — tydzień do",
  planned_end_low_quarter: "Planowany koniec — kwartał od",
  planned_end_ceil_quarter: "Planowany koniec — kwartał do",
  planned_start_date: "Planowana data rozpoczęcia (legacy)",
  planned_end_date: "Planowana data zakończenia (legacy)",
  dataRozpoczeciaOd: "Data rozpoczęcia",
  godzinaRozpoczecia: "Godzina start",
  dataZakonczeniaDo: "Data zakończenia",
  godzinaZakonczenia: "Godzina koniec",
  dataRozpoczeciaDo: "Rozpoczęcie do (legacy)",
  dataZakonczeniaOd: "Zakończenie od (legacy)",
  planowanyStartTydzien: "Planowany start — tydzień miesiąca",
  planowanyKoniecTydzien: "Planowany koniec — tydzień miesiąca",
  announcements_site_url: "Strona naborów",
  documents_url: "Strona dokumentów",
  action_code: "Kod działania",
  direct_recruitment_link: "Bezpośredni link do naboru",
  funding_rules: "Zasady dofinansowania",
  metadata: "Pozostałe informacje",
  importKey: "Identyfikator importu",
  evidence: "Źródła potwierdzające",
  fileType: "Format pliku",
  url: "Adres pliku",
  display_name: "Nazwa dokumentu",
  sourcePageUrl: "Strona źródłowa",
  purpose: "Przeznaczenie",
  has_fields: "Pola do wypełnienia",
  intended_use: "Sposób użycia",
  client_requirement: "Wymaganie wobec klienta",
  signature_requirement: "Podpis",
  operatorId: "Operator",
  operatorType: "Rola operatora",
  company_size: "Wielkość firmy",
  variant_no: "Numer wariantu",
  value: "Wartość",
  terytCode: "Kod TERYT",
  kind: "Rodzaj",
  sourceImportKey: "Źródło dokumentu",
  sourcePageImportKey: "Źródło strony",
};

async function sendCommit<T>(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op,
    ...payload,
  })) as { ok?: boolean; value?: T; error?: string };
  if (!response?.ok)
    throw new Error(response?.error ?? "Nie udało się zapisać decyzji.");
  return response.value as T;
}
function typeLabel(type: string) {
  return type === "operator"
    ? "Operator"
    : type === "project"
      ? "Projekt"
      : "Nabór";
}
function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const definitions = [
    BurbotFunding?.fields,
    BurbotDocuments?.fields,
    ...Object.values(BurbotSchema).map((schema) => schema.fields),
  ] as Array<Record<string, { label?: string }>>;
  for (const fields of definitions)
    if (fields?.[field]?.label) return fields[field].label!;
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}
function displayValue(value?: string): string {
  return value ? (VALUE_LABELS[value] ?? value) : "Brak wartości";
}
const decisionLabel = {
  save: "Do zapisu",
  later: "Do dopracowania",
  discarded: "Cofnięta — bez zmiany",
};
const statusLabel = {
  ADDED: "Dodano",
  MODIFIED: "Zmieniono",
  REMOVED: "Usunięto",
};

function ReviewRow({
  item,
  busy,
  onDecide,
}: {
  item: CommitReviewItem;
  busy: boolean;
  onDecide: (item: CommitReviewItem, decision: string) => void;
}) {
  const discarded = item.selection === "discarded";
  const title = item.group === "Pola" ? fieldLabel(item.label) : item.label;
  return (
    <article
      className={"review-row is-" + item.selection}
      data-change-id={item.id}
    >
      <header className="review-row-header">
        <label className="review-check">
          <input
            type="checkbox"
            disabled={busy || discarded}
            checked={item.selection === "save"}
            onChange={(event) =>
              onDecide(item, event.target.checked ? "save" : "later")
            }
            aria-label={"Zapisz: " + title}
          />
          <strong>{title}</strong>
        </label>
        <span className={"review-kind kind-" + item.status.toLowerCase()}>
          {discarded ? "Cofnięto" : statusLabel[item.status]}
        </span>
        <span className="review-decision">{decisionLabel[item.selection]}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(item, discarded ? "restore" : "discard")}
        >
          {discarded ? "Przywróć propozycję" : "Cofnij zmianę"}
        </button>
      </header>
      <div className="review-values">
        <div className="review-value-label" aria-hidden="true">
          Pole
        </div>
        <div className="review-value-label">W bazie</div>
        <div className="review-value-label">
          {discarded
            ? "Pozostaje"
            : item.selection === "later"
              ? "Propozycja · na później"
              : "Po zapisaniu"}
        </div>
        {item.details.map((detail) => (
          <div className="review-value-row" key={detail.key ?? detail.field}>
            <span className="review-property">
              {detail.subject && (
                <strong>
                  {detail.subject}
                  <br />
                </strong>
              )}
              {fieldLabel(detail.field)}
            </span>
            <span className="review-before">
              <small>W bazie</small>
              {displayValue(detail.before)}
            </span>
            <span className={discarded ? "review-kept" : "review-after"}>
              <small>{discarded ? "Pozostaje" : "Propozycja"}</small>
              {displayValue(discarded ? detail.before : detail.after)}
            </span>
          </div>
        ))}
      </div>
      {discarded && (
        <details className="review-discarded-proposal">
          <summary>Cofnięta propozycja</summary>
          {item.details.map((detail) => (
            <p key={detail.key ?? detail.field}>
              {detail.subject && `${detail.subject} · `}
              {fieldLabel(detail.field)}:{" "}
              <del>{displayValue(detail.after)}</del>
            </p>
          ))}
        </details>
      )}
    </article>
  );
}

export function CommitPanel() {
  const [session, setSession] = useState<CommitSessionView>(EMPTY_SESSION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeId, setActiveId] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let frame: number | null = null;
    let running = false;
    let requested = false;
    let disposed = false;
    const refresh = () => {
      requested = true;
      if (frame !== null || running || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        requested = false;
        running = true;
        void sendCommit<CommitSessionView>("GET")
          .then((next) => { if (!disposed) setSession(next); })
          .catch((error) => { if (!disposed) setError(String(error.message ?? error)); })
          .finally(() => {
            running = false;
            if (requested && !disposed) refresh();
          });
      });
    };
    const listener = (event: unknown) => {
      if ((event as { type?: string })?.type === "BURBOT_COMMIT_CHANGED")
        refresh();
    };
    refresh();
    browser.runtime.onMessage.addListener(listener);
    window.addEventListener("burbot:commit-changed", refresh);
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      browser.runtime.onMessage.removeListener(listener);
      window.removeEventListener("burbot:commit-changed", refresh);
    };
  }, []);
  const objects = useMemo(
    () => session.objects.filter((object) => object.reviewItems?.length),
    [session.objects],
  );
  const items = objects.flatMap((object) => object.reviewItems ?? []);
  const selected = items.filter((item) => item.selection === "save").length;
  const deferred = items.filter((item) => item.selection === "later").length;
  const discarded = items.filter(
    (item) => item.selection === "discarded",
  ).length;
  const visibleObjects = objects.filter(
    (object) =>
      filter === "all" ||
      object.reviewItems?.some((item) => item.selection === filter),
  );
  const current =
    visibleObjects.find((object) => object.id === activeId) ??
    visibleObjects[0];
  const currentItems =
    current?.reviewItems?.filter(
      (item) => filter === "all" || item.selection === filter,
    ) ?? [];
  const groups = [...new Set(currentItems.map((item) => item.group))];

  async function run(work: () => Promise<CommitSessionView>) {
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setSession(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await sendCommit<CommitSessionView>("GET")
        .then(setSession)
        .catch(() => undefined);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (
          document.activeElement === document.body &&
          focused?.isConnected &&
          focused.getClientRects().length
        )
          focused.focus({ preventScroll: true });
      });
    }
  }
  function decide(item: CommitReviewItem, decision: string) {
    void run(() =>
      sendCommit("REVIEW_CHANGE", {
        changeId: item.id,
        fingerprint: item.fingerprint,
        decision,
      }),
    );
  }
  function openObject(object: CommitSessionObject) {
    void run(async () => {
      const window = await browser.windows.getCurrent();
      const value = await sendCommit<CommitSessionView>("FOCUS", {
        windowId: window.id,
        objectId: object.id,
      });
      globalThis.window.dispatchEvent(
        new CustomEvent("burbot:request-workflow-mode", {
          detail: { mode: "view" },
        }),
      );
      return value;
    });
  }

  return (
    <section
      className="commit-panel review-workspace"
      aria-label="Przegląd zmian"
      aria-busy={busy}
    >
      <header className="review-toolbar">
        <div>
          <h1>Porównaj i wybierz zmiany</h1>
          <p>
            Odznaczone propozycje zostają do dopracowania. Cofnięcie przywraca
            zapisaną wartość.
          </p>
        </div>
        <label>
          Pokazuj
          <select
            aria-label="Filtr zmian"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Wszystkie ({items.length})</option>
            <option value="save">Do zapisu ({selected})</option>
            <option value="later">Do dopracowania ({deferred})</option>
            <option value="discarded">Cofnięte ({discarded})</option>
          </select>
        </label>
      </header>
      <div className="review-layout">
        <label className="review-object-select">
          Obiekt
          <select
            aria-label="Obiekt do porównania"
            value={current?.id ?? ""}
            onChange={(event) => setActiveId(event.target.value)}
          >
            {!visibleObjects.length && <option value="">Brak zmian</option>}
            {visibleObjects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.label}
              </option>
            ))}
          </select>
        </label>
        <nav className="review-objects" aria-label="Obiekty ze zmianami">
          {visibleObjects.map((object) => (
            <button
              key={object.id}
              type="button"
              aria-current={current?.id === object.id ? "true" : undefined}
              onClick={() => setActiveId(object.id)}
            >
              <strong>{object.label}</strong>
              <small>
                {typeLabel(object.type)} ·{" "}
                {
                  object.reviewItems?.filter(
                    (item) => item.selection === "save",
                  ).length
                }{" "}
                do zapisu / {object.reviewItems?.length} zmian
              </small>
            </button>
          ))}
        </nav>
        <main className="review-detail">
          {current ? (
            <>
              <header className="review-object-header">
                <div>
                  <small>{typeLabel(current.type)}</small>
                  <h2>{current.label}</h2>
                </div>
                {current.status !== "DELETED" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openObject(current)}
                  >
                    Dopracuj obiekt
                  </button>
                )}
              </header>
              <div className="review-bulk-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      sendCommit("REVIEW_ALL", {
                        objectId: current.id,
                        decision: "save",
                      }),
                    )
                  }
                >
                  Zaznacz wszystkie
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      sendCommit("REVIEW_ALL", {
                        objectId: current.id,
                        decision: "later",
                      }),
                    )
                  }
                >
                  Wszystkie na później
                </button>
              </div>
              {groups.map((group) => (
                <section className="review-group" key={group}>
                  <h3>{group}</h3>
                  {currentItems
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <ReviewRow
                        key={item.id}
                        item={item}
                        busy={busy}
                        onDecide={decide}
                      />
                    ))}
                </section>
              ))}
            </>
          ) : (
            <div className="review-empty">
              <h2>
                {items.length
                  ? "Brak zmian dla tego filtra"
                  : "Wszystko zapisane"}
              </h2>
              <p>
                {items.length
                  ? "Wybierz inny filtr, aby zobaczyć pozostałe propozycje."
                  : "Zmiany z edycji i zaakceptowanego importu pojawią się tutaj automatycznie."}
              </p>
            </div>
          )}
        </main>
      </div>
      <footer className="review-footer">
        <div>
          <strong>{selected} do zapisu</strong>
          <span>
            {deferred} do dopracowania · {discarded} cofniętych
          </span>
        </div>
        <button
          type="button"
          className="commit-primary"
          disabled={busy || !selected}
          onClick={() =>
            void run(async () => {
              const value = await sendCommit<{ session: CommitSessionView }>(
                "COMMIT",
                {
                  expectedReview: items
                    .filter((item) => item.selection === "save")
                    .map(({ id, fingerprint }) => ({ id, fingerprint })),
                },
              );
              setMessage(
                "Zapisano wybrane zmiany. Odłożone propozycje nadal czekają na dopracowanie.",
              );
              return value.session;
            })
          }
        >
          {busy ? "Zapisywanie…" : `Zapisz wybrane (${selected})`}
        </button>
        {error && (
          <p className="commit-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="review-message" role="status">
            {message}
          </p>
        )}
      </footer>
    </section>
  );
}
