import { useEffect, useState } from "react";
import { STORAGE_KEY } from "../shared/api/storage";
import type { BurbotState } from "../shared/types/domain";

export function App() {
  const [state, setState] = useState<BurbotState | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
        | BurbotState
        | undefined;
      setState(stored ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read local data.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function resetWorkspace() {
    if (!confirm("Delete all locally stored Burbot objects and extraction rules?")) return;
    await browser.storage.local.remove(STORAGE_KEY);
    await refresh();
  }

  return (
    <main className="ui-page">
      <section className="ui-card">
        <p className="ui-eyebrow">BURBOT OPTIONS</p>
        <h1>Local workspace</h1>
        <p className="ui-muted">
          This build stores extraction data locally in Firefox. No backend connection is configured here.
        </p>
        <div className="ui-stat-grid">
          <div className="ui-stat"><strong>{state?.objects.length ?? 0}</strong><span>objects</span></div>
          <div className="ui-stat"><strong>{state?.rules.length ?? 0}</strong><span>rules</span></div>
          <div className="ui-stat"><strong>{state?.revision ?? 0}</strong><span>revision</span></div>
        </div>
        <div className="ui-actions">
          <button onClick={() => void refresh()}>Refresh</button>
          <button className="danger" onClick={() => void resetWorkspace()}>Reset local workspace</button>
        </div>
        {error && <p className="ui-error">{error}</p>}
      </section>
    </main>
  );
}
