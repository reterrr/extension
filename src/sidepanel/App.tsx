import { useEffect } from "react";
import "./geographyStyles";
import "./fileSourceStyles";
import "./commitStyles";
import "./workspaceRedesignStyles";
import "./importReviewStyles";
import { CommitPanel } from "./CommitPanel";
import { ImportReviewPanel } from "./ImportReviewPanel";

export function App() {
  useEffect(() => {
    void Promise.all([
      import("./workspace.js"),
      import("./importUi"),
      import("./excelExportUi"),
      import("./geographyUi").then(({ initGeographyUi }) => initGeographyUi()),
      import("./fileSourcesUi").then(({ initFileSourcesUi }) => initFileSourcesUi()),
      import("./pdfCaptureUi").then(({ initPdfCaptureUi }) => initPdfCaptureUi()),
      import("./choiceEvidenceUi").then(({ initChoiceEvidenceUi }) =>
        initChoiceEvidenceUi(),
      ),
      import("./captureFeedbackUi").then(({ initCaptureFeedbackUi }) =>
        initCaptureFeedbackUi(),
      ),
      import("./objectReconnectUi").then(({ initObjectReconnectUi }) =>
        initObjectReconnectUi(),
      ),
      import("./workspaceRedesignUi").then(({ initWorkspaceRedesignUi }) =>
        initWorkspaceRedesignUi(),
      ),
    ]);
  }, []);

  return (
    <>
      <header className="brandbar">
        <span className="brand">Burbot<span className="brand-dot">.</span></span>
        <span className="local-badge">EXTRACTION WORKSPACE</span>
      </header>
      <ImportReviewPanel />
      <CommitPanel />
      <div className="connection-bar">
        <span id="connection">Połącz stronę, aby wydzielać wartości</span>
        <div className="connection-actions">
          <input id="import-file" type="file" accept="application/json,.json" hidden />
          <button id="import" className="text-button">Import JSON</button>
          <button id="connect" className="text-button">Połącz</button>
        </div>
      </div>
      <main>
        <section id="empty" className="empty-state">
          <span className="eyebrow">ZACZNIJ NA STRONIE</span>
          <h1>Zaznacz. Zapisz.<br />Uporządkuj dane.</h1>
          <p>Zaznacz nazwę projektu, naboru albo operatora na stronie.</p>
          <p>
            <strong>Prawy przycisk → Create Burbot object</strong><br />
            Wybierz typ obiektu. Otworzymy go tutaj i przeprowadzimy Cię przez kolejne pola.
          </p>
        </section>
        <section id="workspace" hidden>
          <div className="object-header">
            <span id="object-kind" className="eyebrow" />
            <h1 id="object-title" />
            <div className="header-actions">
              <details id="switcher">
                <summary>Zmień obiekt <span aria-hidden="true">⌄</span></summary>
                <div id="object-options" className="popover" />
              </details>
              <details id="more">
                <summary aria-label="Akcje obiektu">•••</summary>
                <div className="popover menu">
                  <button id="export-excel">Eksportuj Excel</button>
                  <button id="export">Eksportuj workspace JSON</button>
                  <button id="delete" className="danger">Usuń obiekt</button>
                </div>
              </details>
            </div>
            <div id="active-object-view" className="active-object-view" hidden>
              <span className="active-object-view-badge">VIEW</span>
              <span id="active-object-view-count" className="active-object-view-count" />
              <span id="active-object-view-query" className="active-object-view-query" />
              <button id="export-object-view" type="button" className="text-button">
                Eksport AI
              </button>
              <button id="clear-object-view" type="button" className="text-button">
                Wyczyść
              </button>
            </div>
            <div className="progress-label">
              <span id="progress" /><span id="rule-count" />
            </div>
            <progress id="progress-bar" value={0} max={1} aria-label="Uzupełnione pola" />
          </div>

          <div id="fields" />

          <section id="operator-contacts-section" className="business-section" hidden>
            <details id="operator-contacts-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Kontakty operatora</strong>
                  <small>Wiele adresów email i numerów telefonu</small>
                </span>
                <span id="operator-contact-count" className="workspace-section-status">Brak kontaktów</span>
              </summary>
              <div className="workspace-section-body">
                <div id="operator-contacts" />
              </div>
            </details>
          </section>

          <section id="file-sources-section" className="business-section" hidden>
            <details id="file-sources-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Źródła plikowe</strong>
                  <small>PDF-y i dokumenty przypięte do obiektu</small>
                </span>
                <span id="file-source-count" className="workspace-section-status">Brak plików</span>
              </summary>
              <div className="workspace-section-body">
                <p className="muted">
                  Przypnij oryginalny link do pliku. Dla PDF Burbot zapisuje selektory tekstowe względem strony i kontekstu zaznaczenia.
                </p>
                <div id="file-source-list" className="file-source-list" />
                <div className="file-source-toolbar">
                  <button id="read-from-file" className="text-button" type="button">
                    + Dodaj plik ze strony
                  </button>
                </div>
                <p id="file-source-mode-hint" className="file-source-mode-hint" hidden>
                  Kliknij link do PDF na stronie. Esc anuluje tryb.
                </p>
              </div>
            </details>
          </section>

          <section id="geography-section" className="business-section" hidden>
            <details id="geography-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Geografia</strong>
                  <small>Zakres terytorialny projektu lub naboru</small>
                </span>
                <span id="geography-count" className="workspace-section-status">Brak zakresu</span>
              </summary>
              <div className="workspace-section-body">
                <div id="geography-list" />
                <details id="geography-add" className="geography-add">
                  <summary className="text-button">+ Dodaj geografię</summary>
                  <div className="geography-form">
                    <label htmlFor="geography-role">Rola</label>
                    <select id="geography-role" />

                    <label htmlFor="geography-type">Typ</label>
                    <select id="geography-type" />

                    <label htmlFor="geography-search">Wyszukaj</label>
                    <input
                      id="geography-search"
                      type="search"
                      autoComplete="off"
                      placeholder="np. Mazowieckie, Rzeszów, rzeszowski"
                    />
                    <div id="geography-results" className="geography-results" />
                    <p id="geography-help" className="hint" />
                  </div>
                </details>
              </div>
            </details>
          </section>

          <section id="funding-section" className="business-section" hidden>
            <details id="funding-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Warianty dofinansowania</strong>
                  <small>Przełączaj wielkość firmy bez przewijania powtarzalnych bloków</small>
                </span>
                <span id="funding-status" className="workspace-section-status">Nie skonfigurowano</span>
              </summary>
              <div className="workspace-section-body">
                <div id="funding" />
              </div>
            </details>
          </section>

          <section id="documents-section" className="business-section" hidden>
            <details id="documents-panel" className="workspace-section-card">
              <summary className="section-summary workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Dokumenty</strong>
                  <small>Wymagane, opcjonalne i wewnętrzne</small>
                </span>
                <span id="document-count">Nie skonfigurowano</span>
              </summary>
              <div className="workspace-section-body">
                <div id="documents" />
              </div>
            </details>
          </section>

          <section className="review-section">
            <button id="preview" className="text-button" disabled>↻ Sprawdź ponowne wydzielenie</button>
            <div id="results" hidden>
              <div id="result-list" />
              <button id="apply" className="primary" disabled>Zastosuj poprawne wyniki</button>
            </div>
          </section>
        </section>
      </main>
      <p id="notice" role="status" aria-live="polite" />
      <div id="capture-hint" className="capture-hint" hidden>
        Wybierz pole, aby wydzielić wartość z aktywnej strony.
      </div>
      <section id="capture-area" className="capture-area" hidden aria-label="Aktywne wydzielanie pola">
        <div className="capture-heading">
          <span>
            <small>WYDZIELANIE</small><strong id="active-label" />
            <span id="active-context" className="muted" />
          </span>
          <span className="capture-heading-actions">
            <button
              id="capture-collapse"
              className="icon-button"
              type="button"
              aria-label="Zwiń panel wydzielania"
              aria-expanded="true"
            >
              ⌄
            </button>
            <button id="deselect" className="icon-button" aria-label="Zamknij wydzielanie">×</button>
          </span>
        </div>
        <div className="capture-tools">
          <button id="pick">Wybierz element</button>
          <button id="selected-text">Użyj zaznaczenia</button>
          <button id="page-url">Użyj URL strony</button>
        </div>
        <div id="capture-source" hidden>
          <label htmlFor="method">Odczytaj ze strony</label>
          <select id="method" />
          <div id="sample" className="source-sample" />
        </div>
        <label id="value-label" htmlFor="edit-value">Wartość</label>
        <div id="value-control" />
        <p id="converted" className="hint" />
        <button id="save" className="primary">Zapisz i przejdź dalej</button>
        <details id="rule-details">
          <summary>Szczegóły reguły</summary>
          <pre id="rule" />
        </details>
      </section>
    </>
  );
}
