const root = document.getElementById("root");
if (!root) throw new Error("Missing PDF reader root element.");

root.innerHTML = `
  <div class="reader-shell">
    <aside class="reader-sidebar">
      <span class="eyebrow">BURBOT PDF READER</span>
      <h1 id="source-name">PDF source</h1>
      <div class="hint">Obiekt: <strong id="object-name"></strong></div>
      <a id="source-url" class="source-link" target="_blank" rel="noopener noreferrer"></a>

      <div class="reader-card">
        <label for="field">Pole docelowe</label>
        <select id="field"></select>

        <label>Zaznaczony tekst</label>
        <div id="selected-text" class="selected-value">Nic nie zaznaczono.</div>

        <label for="field-value">Wartość po normalizacji</label>
        <div id="value-control"></div>
        <p id="converted"></p>
        <button id="save" class="primary" disabled>Zapisz wartość + selector</button>

        <p id="selector-status"></p>
        <details id="selector-details" hidden>
          <summary>Selector PDF</summary>
          <pre id="selector-json"></pre>
        </details>
      </div>

      <p id="notice" role="status" aria-live="polite"></p>
      <p class="hint">
        Zaznacz tekst na jednej stronie PDF-a. Selector zapisuje numer strony oraz
        exact/prefix/suffix względem kanonicznej warstwy tekstowej.
      </p>
    </aside>

    <main class="reader-main">
      <div class="reader-topline">
        <span id="page-count"></span>
        <span>Tekstowy widok ekstrakcyjny</span>
      </div>
      <div id="loading">Ładowanie i indeksowanie PDF-a…</div>
      <div id="pages"></div>
    </main>
  </div>
`;

export {};
