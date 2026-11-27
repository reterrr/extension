import { useEffect, useState } from "react";
import {
  configureContinuous,
  continuousSignalKey,
  readContinuousSummary,
  requestSyncAction,
} from "../shared/backend-sync/client";
import type {
  ContinuousSummary,
  SyncSettings,
} from "../shared/backend-sync/types";

const messages: Record<string, string> = {
  BACKEND_UNAVAILABLE: "Backend unavailable. The operation will retry.",
  SCHEMA_REVISION_CHANGED:
    "The backend schema changed. Refresh the schema and review the values.",
  CANONICAL_VALUE_CHANGED:
    "A server value changed. Compare the selected values before approving a new write.",
  FIELD_BINDING_CHANGED: "The server field changed. Review the field mapping.",
  FIELD_UNSUPPORTED: "The server schema no longer contains this field.",
  ENTITY_DEFINITION_UNRESOLVED:
    "The business type is missing from the current server schema.",
  CREATE_PERMISSION_REQUIRED:
    "This workspace cannot create backend identities.",
  COMMIT_PERMISSION_REQUIRED: "This workspace cannot accept approved values.",
  OBJECT_ARCHIVED: "The backend object is archived.",
  OBJECT_BINDING_CHANGED: "The backend identity needs review.",
  SOURCE_UNRESOLVED:
    "Bind the Source through Bulk Source & Selector Synchronization.",
  SOURCE_ACCESS_DENIED: "This workspace does not have access to the Source.",
  REFERENCE_AMBIGUOUS:
    "More than one local record matches the reference. Review the reference.",
  IDENTITY_REVIEW_REQUIRED: "Preview or explicitly match this identity below.",
  EXPLICIT_LEGACY_MATCH_REQUIRED:
    "Explicitly match this legacy recruitment below.",
  LOCAL_FILE_REQUIRES_SERVER_SOURCE:
    "Register a Source for this local file before synchronizing it.",
  WORKSPACE_TOKEN_REQUIRED: "Reconnect with a valid workspace token.",
};

function problemText(problem: ContinuousSummary["problems"][number]) {
  if (problem.code === "REFERENCE_UNRESOLVED")
    return problem.message
      ? `Waiting for ${problem.message} to be bound.`
      : "A referenced record needs a backend binding.";
  const code = problem.code ?? "Synchronization needs attention";
  return messages[code] ?? code.toLowerCase().replaceAll("_", " ");
}

export function ContinuousSyncOptions({
  settings,
  linked,
  onMode,
}: {
  settings: SyncSettings | null;
  linked: boolean;
  onMode: (mode: boolean | null) => void;
}) {
  const [summary, setSummary] = useState<ContinuousSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const current = await readContinuousSummary();
    setSummary(current);
    onMode(current.mode);
  }

  useEffect(() => {
    const read = () =>
      void refresh().catch(() =>
        setError(
          "Continuous sync status is unavailable. Check the local SQLite service.",
        ),
      );
    read();
    const updated: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, area) => {
      if (area === "local" && changes[continuousSignalKey]) read();
    };
    browser.storage.onChanged.addListener(updated);
    return () => browser.storage.onChanged.removeListener(updated);
  }, [settings, linked, onMode]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Synchronization failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const enabled = summary?.mode === true;
  const hasIssues = Boolean(summary?.problems.length);
  const state =
    busy || summary?.running
      ? "Synchronizing"
      : enabled
        ? hasIssues
          ? "Needs attention"
          : summary?.pending
            ? "Queued"
            : "Ready"
        : summary?.mode === false
          ? "Paused"
          : "Off";
  const available = Boolean(settings && summary?.linked && !busy);

  return (
    <div className="ui-sync-details">
      <label className="ui-sync-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!available}
          onChange={(event) => {
            if (!settings) return;
            const next = event.currentTarget.checked;
            void run(async () => {
              await configureContinuous(settings, next);
              await requestSyncAction("configure");
            });
          }}
        />
        Continuous Backend Sync
      </label>
      {!summary?.linked && (
        <p className="ui-muted">
          Refresh the backend schema to enable automatic synchronization.
        </p>
      )}
      {summary?.linked && (
        <>
          <p>
            {state} · {summary.pending} pending · {summary.synced} synchronized
            · {summary.conflicts} conflicts
          </p>
          <p className="ui-muted">
            Last successful synchronization{" "}
            {summary.lastSuccess
              ? new Date(summary.lastSuccess).toLocaleString()
              : "—"}
          </p>
          <p className="ui-muted">
            Use Preview bindings below to reconcile existing local records.
          </p>
          <div className="ui-actions">
            <button
              type="button"
              disabled={!available || summary.mode === null}
              onClick={() => void run(() => requestSyncAction("sync"))}
            >
              Sync now
            </button>
            <button
              type="button"
              disabled={!available || !hasIssues}
              onClick={() => void run(() => requestSyncAction("retry"))}
            >
              Retry failed
            </button>
          </div>
          {hasIssues && (
            <details open>
              <summary>Last issue · {summary.problems[0].label}</summary>
              <ul>
                {summary.problems.map((item) => (
                  <li key={item.id}>
                    {item.label} · {problemText(item)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
    </div>
  );
}
