import { useEffect } from "react";

export function App() {
  useEffect(() => {
    void Promise.all([import("./workspace.js"), import("./importUi")]);
  }, []);

  return (
    <>
      <header className="brandbar">
        <span className="brand">Burbot<span className="brand-dot">.</span></span>
        <span className="local-badge">EXTRACTION WORKSPACE</span>
      </header>
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
                  <button id="export">Export JSON</button>
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
