import { useEffect, useState } from "react";
import {
  configureContinuous,
  continuousLocal,
  continuousSignalKey,
  readContinuousSummary,
  readSyncReview,
  requestSyncAction,
} from "../shared/backend-sync/client";
import type {
  ContinuousSummary,
  Identity,
  SyncDependency,
  SyncReviewPage,
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
  SOURCE_AMBIGUOUS:
    "More than one granted Source matches. Review the Source selection.",
  SOURCE_ACCESS_DENIED: "This workspace does not have access to the Source.",
  REFERENCE_AMBIGUOUS:
    "More than one local record matches the reference. Review the reference.",
  LOCAL_RECORD_MISSING:
    "The referenced record is missing from committed SQLite.",
  DEPENDENCY_CYCLE:
    "These records reference one another. Review a binding to release the cycle.",
  WAITING_UPSTREAM_JOB: "Waiting for a required identity.",
  IDENTITY_REVIEW_REQUIRED: "Preview or explicitly match this identity below.",
  EXPLICIT_LEGACY_MATCH_REQUIRED:
    "Explicitly match this legacy recruitment below.",
  LOCAL_FILE_REQUIRES_SERVER_SOURCE:
    "Register a Source for this local file before synchronizing it.",
  WORKSPACE_TOKEN_REQUIRED: "Reconnect with a valid workspace token.",
  INVALID_SYNC_TOKEN: "Reconnect with a valid workspace token.",
  WORKSPACE_ACCESS_DENIED: "This token belongs to a different workspace.",
  BIND_PERMISSION_REQUIRED: "This workspace cannot bind existing objects.",
};

function problemText(code = "Synchronization needs attention") {
  return messages[code] ?? code.toLowerCase().replaceAll("_", " ");
}

async function openRecord(identity: Identity) {
  const opening = browser.sidebarAction.open();
  await opening;
  const { id: windowId } = await browser.windows.getCurrent();
  const result = await browser.runtime.sendMessage({
    type: "BURBOT_COMMIT",
    op: "FOCUS",
    windowId,
    objectId: identity.localObjectId,
  });
  if (!result?.ok)
    throw new Error(result?.error ?? "Could not open the local record.");
}

function DependencyList({ entries }: { entries: SyncDependency[] }) {
  return (
    <ul>
      {entries.map((item, index) => (
        <li key={index}>
          {item.label && <strong>{item.label} · </strong>}
          {problemText(item.upstreamCode ?? item.code)}
          {item.localExists !== undefined && (
            <small>
              {" "}
              · {item.localExists ? "Committed record" : "Missing locally"}
            </small>
          )}
          {item.upstreamId && (
            <small>
              {" "}
              · Job <code>{item.upstreamId}</code> · {item.upstreamStatus}
            </small>
          )}
          {item.chain && <DependencyList entries={item.chain} />}
        </li>
      ))}
    </ul>
  );
}

export function ContinuousSyncOptions({
  settings,
  linked,
  onMode,
  onReviewValues,
}: {
  settings: SyncSettings | null;
  linked: boolean;
  onMode: (mode: boolean | null) => void;
  onReviewValues: (keys: string[]) => Promise<void>;
}) {
  const [summary, setSummary] = useState<ContinuousSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"identity" | "value">("identity");
  const [page, setPage] = useState<SyncReviewPage>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matches, setMatches] = useState<Record<string, string>>({});

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

  async function loadReview(nextKind: "identity" | "value", after = "") {
    if (!settings) return;
    const next = await readSyncReview(settings, nextKind, after);
    setKind(nextKind);
    setPage(next);
    setSelected(new Set());
    setMatches({});
  }

  async function applyIdentityReview() {
    if (!settings) return;
    const entries = [...selected].map((key) => ({
      key,
      ...(matches[key]?.trim() && {
        existingBusinessObjectId: matches[key].trim(),
      }),
    }));
    const newCount = entries.filter(
      (item) => !item.existingBusinessObjectId,
    ).length;
    if (
      newCount &&
      !confirm(
        `Confirm that ${newCount} selected records represent genuinely new backend objects.`,
      )
    )
      return;
    await continuousLocal("approveIdentities", {
      origin: settings.origin,
      entries,
    });
    await requestSyncAction("wake");
    await loadReview("identity");
  }

  async function configure(enabled: boolean) {
    if (!settings) return;
    await configureContinuous(settings, enabled);
    await requestSyncAction("configure");
  }

  const enabled = summary?.mode === true;
  const hasIssues = Boolean(summary?.problems.length);
  const state =
    busy || summary?.running
      ? "Synchronizing"
      : enabled
        ? hasIssues
          ? "Needs attention"
          : summary?.pending ||
              summary?.reconciliation.queued ||
              (summary &&
                summary.reconciliation.scanned < summary.reconciliation.found)
            ? "Queued"
            : "Ready"
        : summary?.mode === false
          ? "Paused"
          : "Off";
  const available = Boolean(settings && summary?.linked && !busy);
  const counts = summary?.reconciliation;

  return (
    <div className="ui-sync-details">
      <label className="ui-sync-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!available}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            void run(() => configure(next));
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
          {counts && (
            <section aria-label="Initial reconciliation">
              <h3>Initial reconciliation</h3>
              <p role="status">
                {counts.scanned} of {counts.found} records checked ·{" "}
                {counts.alreadyBound} already bound · {counts.queued} identities
                queued · {counts.identityReview} need identity review ·{" "}
                {counts.valueReview} need value review · {counts.completed}{" "}
                completed
              </p>
              <div className="ui-actions">
                <button
                  type="button"
                  disabled={!available || enabled}
                  onClick={() => void run(() => configure(true))}
                >
                  {summary.mode === null
                    ? "Start reconciliation"
                    : "Resume reconciliation"}
                </button>
                <button
                  type="button"
                  disabled={!available || !counts.identityReview}
                  onClick={() => void run(() => loadReview("identity"))}
                >
                  Review identities
                </button>
                <button
                  type="button"
                  disabled={!available || !counts.valueReview}
                  onClick={() => void run(() => loadReview("value"))}
                >
                  Review values
                </button>
              </div>
              {page && (
                <div className="ui-sync-records">
                  {kind === "identity" && (
                    <p>
                      Enter an existing server object ID to bind it. Leave the
                      ID blank only for a genuinely new object.
                    </p>
                  )}
                  {!page.items.length && <p>No records on this review page.</p>}
                  {page.items.map(
                    ({
                      key,
                      label,
                      identity,
                      code,
                      pending,
                      conflictReview,
                    }) => (
                      <div className="ui-sync-record" key={key}>
                        <label className="ui-sync-checkbox">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            disabled={
                              busy ||
                              (kind === "value" &&
                                (pending || !page.permissions.commit))
                            }
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.currentTarget.checked) next.add(key);
                              else next.delete(key);
                              setSelected(next);
                            }}
                          />
                          <span>
                            {label}
                            {code && <small>{problemText(code)}</small>}
                            {kind === "value" && pending && (
                              <small>
                                Resolve the pending approved Commit first.
                              </small>
                            )}
                            {conflictReview && (
                              <small>
                                Compare the latest committed values to replace
                                the conflicting writes for this record.
                              </small>
                            )}
                          </span>
                        </label>
                        {kind === "identity" &&
                          page.permissions.bindExisting && (
                            <label>
                              Existing server object ID
                              <input
                                inputMode="numeric"
                                value={matches[key] ?? ""}
                                disabled={busy}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setMatches((old) => ({
                                    ...old,
                                    [key]: value,
                                  }));
                                }}
                              />
                            </label>
                          )}
                        <button
                          type="button"
                          onClick={() => void run(() => openRecord(identity))}
                        >
                          {identity.target
                            ? "Open owning record"
                            : "Open local record"}
                        </button>
                      </div>
                    ),
                  )}
                  <div className="ui-actions">
                    <button
                      type="button"
                      disabled={
                        !available ||
                        !selected.size ||
                        (kind === "identity" &&
                          !page.permissions.create &&
                          [...selected].some((key) => !matches[key]?.trim()))
                      }
                      onClick={() =>
                        void run(
                          kind === "identity"
                            ? applyIdentityReview
                            : () => onReviewValues([...selected]),
                        )
                      }
                    >
                      {kind === "identity"
                        ? "Confirm selected identities"
                        : "Compare selected values for review"}
                    </button>
                    <button
                      type="button"
                      disabled={!available}
                      onClick={() => void run(() => loadReview(kind))}
                    >
                      First page
                    </button>
                    <button
                      type="button"
                      disabled={!available || !page.next}
                      onClick={() =>
                        void run(() => loadReview(kind, page.next ?? ""))
                      }
                    >
                      Next page
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
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
                    {item.label} · {problemText(item.code)}
                    <button
                      type="button"
                      onClick={() => void run(() => openRecord(item.identity))}
                    >
                      {item.identity.target
                        ? "Open owning record"
                        : "Open local record"}
                    </button>
                    {!!item.dependencies?.length && (
                      <details>
                        <summary>Inspect dependency chain</summary>
                        <DependencyList entries={item.dependencies} />
                      </details>
                    )}
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
