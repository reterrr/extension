import { useCallback, useEffect, useRef, useState } from "react";
import "./geographyStyles";
import "./fileSourceStyles";
import "./commitStyles";
import "./workspaceRedesignStyles";
import "./importReviewStyles";
import "./workflowTabsStyles";
import { ActiveViewPanel } from "./ActiveViewPanel";
import { CommitPanel } from "./CommitPanel";
import { ImportReviewPanel } from "./ImportReviewPanel";
import {
  patchSidepanelUiState,
  readSidepanelUiState,
  type SidepanelMode,
} from "./uiSessionState";

function restoreScroll(top: number): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });
  });
}

export function App() {
  const [mode, setMode] = useState<SidepanelMode>("view");
  const modeRef = useRef<SidepanelMode>("view");
  const windowIdRef = useRef<number | null>(null);

  const navigate = useCallback(async (next: SidepanelMode) => {
    if (next === modeRef.current) return;
    const previous = modeRef.current;
    let targetScroll = 0;
    const windowId = windowIdRef.current;

    if (windowId !== null) {
      const saved = await readSidepanelUiState(windowId);
      targetScroll = saved.scroll[next];
      await patchSidepanelUiState(windowId, {
        mode: next,
        scroll: { [previous]: window.scrollY },
      });
    }

    modeRef.current = next;
    setMode(next);
    restoreScroll(targetScroll);
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const currentWindow = await browser.windows.getCurrent();
      if (disposed || currentWindow.id === undefined) return;
      windowIdRef.current = currentWindow.id;
      const uiState = await readSidepanelUiState(currentWindow.id);
      if (disposed) return;
      modeRef.current = uiState.mode;
      setMode(uiState.mode);
      restoreScroll(uiState.scroll[uiState.mode]);
    })();

    const requested = (event: Event) => {
      const next = (event as CustomEvent<{ mode?: SidepanelMode }>).detail?.mode;
      if (next) void navigate(next);
    };
    window.addEventListener("burbot:navigate", requested);

    return () => {
      disposed = true;
      window.removeEventListener("burbot:navigate", requested);
    };
  }, [navigate]);

  useEffect(() => {
    document.documentElement.dataset.burbotMode = mode;
  }, [mode]);

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
        <span className="brand">
          Burbot<span className="brand-dot">.</span>
        </span>
        <span className="local-badge">EXTRACTION WORKSPACE</span>
      </header>

      <nav className="workflow-tabs" aria-label="Etap pracy">
        <button
          type="button"
          className={mode === "view" ? "active" : ""}
          onClick={() => void navigate("view")}
        >
          Widok
        </button>
        <button
          type="button"
          className={mode === "commit" ? "active" : ""}
          onClick={() => void navigate("commit")}
        >
          Commit
        </button>
        <button
          type="button"
          className={mode === "import" ? "active" : ""}
          onClick={() => void navigate("import")}
        >
          Import
        </button>
      </nav>

      <section className="workflow-panel" hidden={mode !== "commit"}>
        <CommitPanel />
      </section>

      <section className="workflow-panel view-workflow" hidden={mode !== "view"}>
        <ActiveViewPanel />
        <div className="connection-bar">
          <span id="connection">Połącz stronę, aby wydzielać wartości</span>
          <div className="connection-actions">
            <button id="connect" className="text-button">
              Połącz
            </button>
          </div>
        </div>

        <main>
          <section id="empty" className="empty-state">
            <span className="eyebrow">AKTYWNY WIDOK</span>
            <h1>
              Wybierz obiekty.
              <br />
              Potem pracuj na nich.
            </h1>
            <p>
              Ustaw Widok regexem w wyszukiwarce albo ręcznie dodawaj i usuwaj
              obiekty przy wynikach.
            </p>
          </section>
          <section id="workspace" hidden>
            <div className="object-header">
              <span id="object-kind" className="eyebrow" />
              <h1 id="object-title" />
              <div className="header-actions">
                <details id="switcher">
                  <summary>
                    Zmień obiekt <span aria-hidden="true">⌄</span>
                  </summary>
                  <div id="object-options" className="popover" />
                </details>
                <details id="more">
                  <summary aria-label="Akcje obiektu">•••</summary>
                  <div className="popover menu">
                    <button id="export-excel">Eksportuj Excel</button>
                    <button id="export">Eksportuj workspace JSON</button>
                    <button id="delete" className="danger">
                      Usuń obiekt
                    </button>
                  </div>
                </details>
              </div>
              <div id="active-object-view" className="active-object-view" hidden>
                <span className="active-object-view-badge">VIEW</span>
                <span
                  id="active-object-view-count"
                  className="active-object-view-count"
                />
                <span
                  id="active-object-view-query"
                  className="active-object-view-query"
                />
                <button
                  id="remove-current-from-view"
                  type="button"
                  className="text-button"
                >
                  − z Widoku
                </button>
                <button
                  id="edit-current-in-commit"
                  type="button"
                  className="text-button"
                >
                  Edytuj w commicie
                </button>
                <button
                  id="export-object-view"
                  type="button"
                  className="text-button"
                >
                  Eksport AI
                </button>
                <button
                  id="clear-object-view"
                  type="button"
                  className="text-button"
                >
                  Wyczyść
                </button>
              </div>
              <div className="progress-label">
                <span id="progress" />
                <span id="rule-count" />
              </div>
              <progress
                id="progress-bar"
                value={0}
                max={1}
                aria-label="Uzupełnione pola"
              />
            </div>

            <div id="fields" />

            <section
              id="operator-contacts-section"
              className="business-section"
              hidden
            >
              <details
                id="operator-contacts-panel"
                className="workspace-section-card"
              >
                <summary className="workspace-section-summary">
                  <span className="workspace-section-title">
                    <strong>Kontakty operatora</strong>
                    <small>Wiele adresów email i numerów telefonu</small>
                  </span>
                  <span
                    id="operator-contact-count"
                    className="workspace-section-status"
                  >
                    Brak kontaktów
                  </span>
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
                  <span
                    id="file-source-count"
                    className="workspace-section-status"
                  >
                    Brak plików
                  </span>
                </summary>
                <div className="workspace-section-body">
                  <p className="muted">
                    Przypnij oryginalny link do pliku. Dla PDF Burbot zapisuje
                    selektory tekstowe względem strony i kontekstu zaznaczenia.
                  </p>
                  <div id="file-source-list" className="file-source-list" />
                  <div className="file-source-toolbar">
                    <button
                      id="read-from-file"
                      className="text-button"
                      type="button"
                    >
                      + Dodaj plik ze strony
                    </button>
                  </div>
                  <p
                    id="file-source-mode-hint"
                    className="file-source-mode-hint"
                    hidden
                  >
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
                  <span id="geography-count" className="workspace-section-status">
                    Brak zakresu
                  </span>
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
                    <small>
                      Przełączaj wielkość firmy bez przewijania powtarzalnych
                      bloków
                    </small>
                  </span>
                  <span id="funding-status" className="workspace-section-status">
                    Nie skonfigurowano
                  </span>
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
              <button id="preview" className="text-button" disabled>
                ↻ Sprawdź ponowne wydzielenie
              </button>
              <div id="results" hidden>
                <div id="result-list" />
                <button id="apply" className="primary" disabled>
                  Zastosuj poprawne wyniki
                </button>
              </div>
            </section>
          </section>
        </main>

        <div id="capture-hint" className="capture-hint" hidden>
          Wybierz pole, aby wydzielić wartość z aktywnej strony.
        </div>
        <section
          id="capture-area"
          className="capture-area"
          hidden
          aria-label="Aktywne wydzielanie pola"
        >
          <div className="capture-heading">
            <span>
              <small>WYDZIELANIE</small>
              <strong id="active-label" />
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
              <button
                id="deselect"
                className="icon-button"
                aria-label="Zamknij wydzielanie"
              >
                ×
              </button>
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
          <label id="value-label" htmlFor="edit-value">
            Wartość
          </label>
          <div id="value-control" />
          <p id="converted" className="hint" />
          <button id="save" className="primary">
            Zapisz i przejdź dalej
          </button>
          <details id="rule-details">
            <summary>Szczegóły reguły</summary>
            <pre id="rule" />
          </details>
        </section>
      </section>

      <section className="workflow-panel import-workflow" hidden={mode !== "import"}>
        <div className="import-toolbar">
          <div>
            <strong>Import JSON</strong>
            <small>Review → Widok → Commit</small>
          </div>
          <input
            id="import-file"
            type="file"
            accept="application/json,.json"
            hidden
          />
          <button id="import" className="primary">
            Wybierz plik
          </button>
        </div>
        <ImportReviewPanel
          active={mode === "import"}
          onNavigate={(next) => void navigate(next)}
        />
      </section>

      <p id="notice" role="status" aria-live="polite" />
    </>
  );
}
