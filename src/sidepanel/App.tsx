import { useEffect } from "react";
import "./geographyStyles";
import "./operatorAssignmentsStyles";
import "./fileSourceStyles";
import "./commitStyles";
import "./workspaceRedesignStyles";
import "./importReviewStyles";
import "./workflowStyles";
import { CommitPanel } from "./CommitPanel";
import { ImportReviewPanel } from "./ImportReviewPanel";
import { WorkflowTabs } from "./WorkflowTabs";
import { ViewManagerPanel } from "./ViewManagerPanel";

export function App() {
  useEffect(() => {
    void Promise.all([
      import("./workspace.js"),
      import("./importUi"),
      import("./excelExportUi"),
      import("./operatorAssignmentsUi").then(({ initOperatorAssignmentsUi }) =>
        initOperatorAssignmentsUi(),
      ),
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
      <WorkflowTabs />
      <ViewManagerPanel />
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
      <main id="workspace-main">
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
              <details id="more">
                <summary aria-label="Akcje obiektu">•••</summary>
                <div className="popover menu">
                  <button id="export-excel">Eksportuj Excel</button>
                  <button id="export">Eksportuj workspace JSON</button>
                  <button id="delete" className="danger">Usuń obiekt</button>
                </div>
              </details>
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
                  <strong>Pliki</strong>
                  <small>Nazwa z pliku · oznaczenia ustawiasz po dodaniu</small>
                </span>
                <span id="file-source-count" className="workspace-section-status">Brak plików</span>
              </summary>
              <div className="workspace-section-body">
                <p className="muted">
                  Dodaj plik ze strony (.doc, .docx, .pdf, .xlsx, .png, .jpg, .jpeg). Nazwę pliku Burbot zachowuje technicznie, a Ty uzupełniasz nazwę dokumentu, cel, pola do wypełnienia, przeznaczenie, wymagalność i podpis.
                </p>
                <div id="file-source-list" className="file-source-list" />
                <div className="file-source-toolbar">
                  <button id="read-from-file" className="text-button" type="button">
                    + Dodaj plik ze strony
                  </button>
                </div>
                <p id="file-source-mode-hint" className="file-source-mode-hint" hidden>
                  Kliknij link do pliku .doc, .docx, .pdf, .xlsx, .png, .jpg lub .jpeg. Esc anuluje tryb.
                </p>
              </div>
            </details>
          </section>

          <section id="operator-assignments-section" className="business-section" hidden>
            <details id="operator-assignments-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Operatorzy</strong>
                  <small>Projekt lub nabór może mieć kilku operatorów</small>
                </span>
                <span id="operator-assignment-count" className="workspace-section-status">Brak operatorów</span>
              </summary>
              <div className="workspace-section-body">
                <div id="operator-assignment-list" />
                <div className="operator-assignment-add">
                  <label htmlFor="operator-assignment-select">
                    Operator
                    <select id="operator-assignment-select" />
                  </label>
                  <label htmlFor="operator-assignment-role">
                    Rola
                    <select id="operator-assignment-role" defaultValue="DODATKOWY">
                      <option value="GLOWNY">Główny</option>
                      <option value="DODATKOWY">Dodatkowy</option>
                    </select>
                  </label>
                  <button id="operator-assignment-add-button" type="button">
                    + Dodaj
                  </button>
                </div>
              </div>
            </details>
          </section>

          <section id="geography-section" className="business-section" hidden>
            <details id="geography-panel" className="workspace-section-card">
              <summary className="workspace-section-summary">
                <span className="workspace-section-title">
                  <strong>Geografia</strong>
                  <small id="geography-subtitle">Zakres terytorialny projektu lub naboru</small>
                </span>
                <span id="geography-count" className="workspace-section-status">Brak zakresu</span>
              </summary>
              <div className="workspace-section-body">
                <div id="geography-list" />
                <details id="geography-add" className="geography-add">
                  <summary className="text-button">+ Dodaj geografię</summary>
                  <div className="geography-form">
                    <label id="geography-operator-label" htmlFor="geography-operator" hidden>Operator naboru</label>
                    <select id="geography-operator" hidden />

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
