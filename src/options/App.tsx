import { useEffect, useState } from "react";
import {
  loadCommittedState,
  resetWorkspaceStorage,
  workspaceStorageInfo,
} from "../shared/api/storage";
import type { LegacyStorageState } from "../shared/types/legacy-storage";

type StorageInfo = Awaited<ReturnType<typeof workspaceStorageInfo>>;

export function App() {
  const [state, setState] = useState<LegacyStorageState | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const [nextState, nextStorage] = await Promise.all([
        loadCommittedState(),
        workspaceStorageInfo(),
      ]);
      setState(nextState);
      setStorage(nextStorage);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read SQLite data.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function resetWorkspace() {
    if (!confirm("Delete the complete Burbot SQLite workspace and any active draft commit?")) return;
    try {
      await resetWorkspaceStorage();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="ui-page">
      <section className="ui-card">
        <p className="ui-eyebrow">BURBOT OPTIONS</p>
        <h1>SQLite workspace</h1>
        <p className="ui-muted">
          Durable Burbot data is stored in a normal SQLite file managed by the local DB service.
          Draft commits live separately in IndexedDB until committed.
        </p>
        <div className="ui-stat-grid">
          <div className="ui-stat"><strong>{state?.objects.length ?? 0}</strong><span>objects</span></div>
          <div className="ui-stat"><strong>{state?.rules.length ?? 0}</strong><span>rules</span></div>
          <div className="ui-stat"><strong>{state?.revision ?? 0}</strong><span>revision</span></div>
          <div className="ui-stat"><strong>{storage?.schemaVersion ?? 0}</strong><span>schema</span></div>
          <div className="ui-stat"><strong>{storage ? `${Math.ceil(storage.bytes / 1024)} KB` : "—"}</strong><span>SQLite file</span></div>
        </div>
        {storage?.path && (
          <p className="ui-muted"><strong>Database:</strong> {storage.path}</p>
        )}
        <div className="ui-actions">
          <button onClick={() => void refresh()}>Refresh</button>
          <button className="danger" onClick={() => void resetWorkspace()}>Reset SQLite workspace</button>
        </div>
        {error && <p className="ui-error">{error}</p>}
      </section>
    </main>
  );
}
