import { peekWorkspaceState } from "./workspaceData";

let startup: Promise<void> | undefined;

function notice(error: unknown): void {
  const node = document.getElementById("notice");
  if (!node) return;
  node.className = "error";
  node.textContent = error instanceof Error ? error.message : String(error);
}

function once(load: () => Promise<unknown>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () =>
    (pending ??= load()
      .then(() => undefined)
      .catch((error) => {
        pending = undefined;
        throw error;
      }));
}

export function startWorkspace(): Promise<void> {
  return (startup ??= boot().catch((error) => {
    startup = undefined;
    notice(error);
    throw error;
  }));
}

async function boot(): Promise<void> {
  const files = once(async () => {
    const { initFileSourcesUi } = await import("./fileSourcesUi");
    await initFileSourcesUi();
  });
  const geography = once(async () => {
    const { initGeographyUi } = await import("./geographyUi");
    await initGeographyUi();
  });
  const operators = once(async () => {
    const { initOperatorAssignmentsUi } =
      await import("./operatorAssignmentsUi");
    await initOperatorAssignmentsUi();
  });
  let highlightsStarted = false;
  let latestPreview: CustomEvent["detail"] = null;
  const highlights = once(async () => {
    highlightsStarted = true;
    const { initSelectorHighlightsUi } = await import("./selectorHighlightsUi");
    await initSelectorHighlightsUi();
  });
  const pdf = once(async () => {
    const { initPdfCaptureUi } = await import("./pdfCaptureUi");
    await initPdfCaptureUi();
  });

  const workspace = await import("./workspace.js");
  await workspace.workspaceReady;

  for (const [id, load] of [
    ["file-sources-panel", files],
    ["geography-panel", geography],
    ["operator-assignments-panel", operators],
  ] as const) {
    const panel = document.getElementById(id) as HTMLDetailsElement;
    const body = panel.querySelector<HTMLElement>(".workspace-section-body")!;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.hidden = true;
    body.before(status);
    body.inert = true;
    body.hidden = true;
    let loading = false;
    const open = async () => {
      if (
        !panel.open ||
        panel.closest<HTMLElement>("section")?.hidden ||
        panel.dataset.featureReady === "true" ||
        loading
      )
        return;
      loading = true;
      status.hidden = false;
      status.textContent = "Ładowanie…";
      panel.setAttribute("aria-busy", "true");
      try {
        await load();
        panel.dataset.featureReady = "true";
        body.inert = false;
        body.hidden = false;
        status.hidden = true;
      } catch (error) {
        status.textContent = "Nie udało się załadować sekcji. ";
        const retry = document.createElement("button");
        retry.textContent = "Odśwież panel";
        retry.onclick = () => window.location.reload();
        status.append(retry);
        notice(error);
      } finally {
        loading = false;
        panel.removeAttribute("aria-busy");
      }
    };
    panel.addEventListener("toggle", () => void open());
    window.addEventListener("burbot:workspace-rendered", () => void open());
    void open();
  }

  // These small modules supply the base editor and restore section preferences.
  const { initWorkspaceRedesignUi } = await import("./workspaceRedesignUi");
  await initWorkspaceRedesignUi();
  const { initChoiceEvidenceUi } = await import("./choiceEvidenceUi");
  initChoiceEvidenceUi();
  const { initCaptureFeedbackUi } = await import("./captureFeedbackUi");
  initCaptureFeedbackUi();
  const { initObjectReconnectUi } = await import("./objectReconnectUi");
  await initObjectReconnectUi();

  const currentWindow = await browser.windows.getCurrent();
  const windowId = currentWindow.id;
  const port = browser.runtime.connect({ name: "burbot-workspace" });
  port.postMessage({ windowId });
  window.addEventListener("pagehide", () => port.disconnect(), { once: true });

  const maybeHighlights = () => {
    const state = peekWorkspaceState();
    if (
      state &&
      (state.rules.length ||
        state.fieldEvidence?.length ||
        state.importSources?.length ||
        state.fileSources?.length)
    ) {
      void highlights().catch(notice);
    }
  };
  window.addEventListener("burbot:workspace-state-changed", maybeHighlights);
  window.addEventListener("burbot:selector-capture-preview", (event) => {
    latestPreview = (event as CustomEvent).detail;
    if (!latestPreview && !highlightsStarted) return;
    void highlights()
      .then(async () => {
        const { setSelectorPreview } = await import("./selectorHighlightsUi");
        setSelectorPreview(latestPreview);
      })
      .catch(notice);
  });
  maybeHighlights();

  const shortcutKey = `burbot:file-mode-toggle:${windowId}`;
  const openFiles = () => {
    window.dispatchEvent(
      new CustomEvent("burbot:request-workflow-mode", {
        detail: { mode: "view" },
      }),
    );
    (document.getElementById("file-sources-panel") as HTMLDetailsElement).open =
      true;
    void files().catch(notice);
  };
  // Pending shortcut is stored by the background before broadcasting. Let the
  // feature consume that stamp, so the first press is neither lost nor doubled.
  browser.runtime.onMessage.addListener(
    (message: { type?: string; windowId?: number }) => {
      if (
        message?.type === "BURBOT_TOGGLE_FILE_MODE" &&
        message.windowId === windowId
      )
        openFiles();
      return undefined;
    },
  );
  const pending = (await browser.storage.session.get(shortcutKey))[shortcutKey];
  if (pending && Date.now() - pending.createdAt <= 5000) openFiles();

  // Capture can arrive from a PDF reader that was already open on restoration.
  browser.runtime.onMessage.addListener(
    (message: { type?: string; windowId?: number }) => {
      if (message?.type === "BURBOT_PDF_CAPTURE") {
        void pdf()
          .then(async () => {
            const { receivePdfCapture } = await import("./pdfCaptureUi");
            await receivePdfCapture(message);
          })
          .catch(notice);
      }
      return undefined;
    },
  );
  const checkReader = async () => {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (tab?.url?.startsWith(browser.runtime.getURL("pdf-reader.html")))
      await pdf();
  };
  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) void checkReader().catch(notice);
  });
  browser.tabs.onUpdated.addListener((_id, change, tab) => {
    if (
      tab?.active &&
      tab.windowId === windowId &&
      (change.url || change.status === "complete")
    ) {
      void checkReader().catch(notice);
    }
  });
  void checkReader().catch(notice);

  // File picking itself stays synchronous in its owning module; exports can
  // safely import their implementation before starting the requested action.
  document.getElementById("export-excel")!.onclick = () => {
    void import("./excelExportUi")
      .then(({ exportExcel }) => exportExcel())
      .catch(notice);
  };
}
