import { useEffect } from "react";
import "./geographyStyles";
import "./fileSourceStyles";
import { CommitPanel } from "./CommitPanel";

export function App() {
  useEffect(() => {
    void Promise.all([
      import("./workspace.js"),
      import("./importUi"),
      import("./geographyUi").then(({ initGeographyUi }) => initGeographyUi()),
      import("./fileSourcesUi").then(({ initFileSourcesUi }) => initFileSourcesUi()),
      import("./pdfCaptureUi").then(({ initPdfCaptureUi }) => initPdfCaptureUi()),
      import("./choiceEvidenceUi").then(({ initChoiceEvidenceUi }) =>
        initChoiceEvidenceUi(),
      ),
    ]);
  }, []);

  return (
    <>
      <header className="brandbar">
        <span className="brand">Burbot<span className="brand-dot">.</span></span>
        <span className="local-badge">EXTRACTION WORKSPACE</span>
      </header>
      <CommitPanel />
      <div className="connection-bar">
        <span id="connection">Connect a webpage to begin</span>
        <div className="connection-actions">
          <input id="import-file" type="file" accept="application/json,.json" hidden />
          <button id="import" className="text-button">Import JSON</button>
          <button id="connect" className="text-button">Connect</button>
        </div>
      </div>
      <main>
        <section id="empty" className="empty-state">
          <span className="eyebrow">START ON THE PAGE</span>
          <h1>See it. Select it.<br />Make it structured.</h1>
          <p>Highlight a project, recruitment or operator name on a webpage.</p>
          <p>
            <strong>Right-click → Create Burbot object</strong><br />
            Choose its type. We’ll open it here, ready to capture.
          </p>
        </section>
        <section id="workspace" hidden>
          <div className="object-header">
            <span id="object-kind" className="eyebrow" />
            <h1 id="object-title" />
            <div className="header-actions">
              <details id="switcher">
                <summary>Change object <span aria-hidden="true">⌄</span></summary>
                <div id="object-options" className="popover" />
              </details>
              <details id="more">
                <summary aria-label="Object actions">•••</summary>
                <div className="popover menu">
                  <button id="export">Export workspace state</button>
                  <button id="delete" className="danger">Delete object</button>
                </div>
              </details>
            </div>
            <div className="progress-label">
              <span id="progress" /><span id="rule-count" />
            </div>
            <progress id="progress-bar" value={0} max={1} aria-label="Fields completed" />
          </div>

          <div id="fields" />

          <section id="file-sources-section" className="business-section" hidden>
            <div className="section-heading">
              <div>
                <h2>Źródła plikowe</h2>
                <p className="muted">
                  Przypnij oryginalny link do pliku. Dla PDF Burbot buduje selektory tekstowe względem numeru strony i kontekstu zaznaczenia.
                </p>
              </div>
            </div>
            <div id="file-source-list" className="file-source-list" />
            <div className="file-source-toolbar">
              <button id="read-from-file" className="text-button" type="button">
                Read from file
              </button>
            </div>
            <p id="file-source-mode-hint" className="file-source-mode-hint" hidden>
              Kliknij link do PDF na stronie. Esc anuluje tryb.
            </p>
          </section>

          <section id="geography-section" className="business-section" hidden>
            <div className="section-heading">
              <div>
                <h2>Geografia</h2>
                <p className="muted">
                  Wybierz zakres ze słownika. Tekst na stronie może być opcjonalnym potwierdzeniem.
                </p>
              </div>
            </div>
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
          </section>

          <section id="funding-section" className="business-section" hidden>
            <h2>Funding</h2>
            <div id="funding" />
          </section>
          <section id="documents-section" className="business-section" hidden>
            <details id="documents-panel">
              <summary className="section-summary">
                <span><strong>Documents</strong><small id="document-count" /></span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div id="documents" />
            </details>
          </section>
          <section className="review-section">
            <button id="preview" className="text-button" disabled>↻ Preview re-extraction</button>
            <div id="results" hidden>
              <div id="result-list" />
              <button id="apply" className="primary" disabled>Apply successful results</button>
            </div>
          </section>
        </section>
      </main>
      <p id="notice" role="status" aria-live="polite" />
      <div id="capture-hint" className="capture-hint" hidden>
        Select a field to capture a value from this page.
      </div>
      <section id="capture-area" className="capture-area" hidden aria-label="Active field capture">
        <div className="capture-heading">
          <span>
            <small>CAPTURING</small><strong id="active-label" />
            <span id="active-context" className="muted" />
          </span>
          <button id="deselect" className="icon-button" aria-label="Deselect field">×</button>
        </div>
        <div className="capture-tools">
          <button id="pick">Pick element</button>
          <button id="selected-text">Use selected text</button>
          <button id="page-url">Use page URL</button>
        </div>
        <div id="capture-source" hidden>
          <label htmlFor="method">Read from page</label>
          <select id="method" />
          <div id="sample" className="source-sample" />
        </div>
        <label id="value-label" htmlFor="edit-value">Value</label>
        <div id="value-control" />
        <p id="converted" className="hint" />
        <button id="save" className="primary">Save & next</button>
        <details id="rule-details">
          <summary>Extraction details</summary>
          <pre id="rule" />
        </details>
      </section>
    </>
  );
}
