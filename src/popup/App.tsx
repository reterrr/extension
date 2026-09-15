import { useState } from "react";

export function App() {
  const [error, setError] = useState("");

  async function openWorkspace() {
    setError("");
    try {
      await browser.sidebarAction.open();
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open Burbot.");
    }
  }

  return (
    <main className="ui-page">
      <section className="ui-card">
        <p className="ui-eyebrow">BURBOT</p>
        <h1>Extraction workspace</h1>
        <p className="ui-muted">
          Create objects from selected webpage text, then capture their fields in the side panel.
        </p>
        <div className="ui-actions">
          <button className="primary" onClick={() => void openWorkspace()}>
            Open Burbot
          </button>
          <button onClick={() => void browser.runtime.openOptionsPage()}>
            Options
          </button>
        </div>
        {error && <p className="ui-error">{error}</p>}
      </section>
    </main>
  );
}
