import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadCommittedState } from "../shared/api/storage";
import {
  continuousLocal,
  enqueueOperation,
  readSyncSettings,
  readSyncState,
  reconcile,
  refreshRegistry,
  reportCapture,
  requestSyncAction,
  SyncError,
  syncSelector,
  syncSettingsKey,
  validateSyncSettings,
} from "../shared/backend-sync/client";
import {
  entityFor,
  identityKey,
  localRecords,
  makeCommitPreview,
  resolveBusinessObject,
  selectorIdentity,
  type LocalRecord,
} from "../shared/backend-sync/resolve";
import type {
  CommitPreview,
  ResolveAction,
  SyncSettings,
  SyncState,
} from "../shared/backend-sync/types";
import type { LegacyStorageState } from "../shared/types/legacy-storage";
import { BulkSyncOptions } from "./BulkSyncOptions";
import { ContinuousSyncOptions } from "./ContinuousSyncOptions";

const emptySettings: SyncSettings = {
  origin: "",
  token: "",
  syncApprovedCommits: false,
};

function display(value: unknown) {
  if (value == null) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function identityLabel(record: LocalRecord) {
  const { identity } = record;
  return identity.target
    ? `${identity.localObjectId} / ${identity.target.kind} / ${identity.target.id}`
    : identity.localObjectId;
}

export function BackendSyncOptions() {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [input, setInput] = useState(emptySettings);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [workspace, setWorkspace] = useState<LegacyStorageState | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [filter, setFilter] = useState("");
  const [existingId, setExistingId] = useState("");
  const [selectorId, setSelectorId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [preview, setPreview] = useState<CommitPreview | null>(null);
  const [historyReview, setHistoryReview] = useState<{
    keys: string[];
    expectedRevision: number;
    schemaRevisionId: string;
    workspaceUuid: string;
  } | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [continuousMode, setContinuousMode] = useState<boolean | null>(null);

  async function localState() {
    const [state, committed] = await Promise.all([
      readSyncState(),
      loadCommittedState(),
    ]);
    setSync(state);
    setWorkspace(committed);
    return { state, committed };
  }

  useEffect(() => {
    void localState().catch(() =>
      setError("SQLite synchronization data is unavailable."),
    );
    void readSyncSettings()
      .then(async (saved) => {
        setSettings(saved);
        if (!saved) return;
        setInput(saved);
        try {
          const registry = await refreshRegistry(saved);
          await localState();
          setMessage(`Connected to ${registry.name}.`);
        } catch {
          setMessage(
            "Backend unavailable. Cached identities and local editing are available.",
          );
        }
      })
      .catch(() => setError("Could not read the backend connection."));
  }, []);

  function action(operation: () => Promise<void>) {
    return async () => {
      setBusy(true);
      setError("");
      setMessage("");
      try {
        await operation();
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Synchronization failed.",
        );
      } finally {
        setBusy(false);
      }
    };
  }

  const records = useMemo(
    () => (workspace ? localRecords(workspace) : []),
    [workspace],
  );
  const labels = useMemo(
    () =>
      new Map(
        records.map((record) => [identityKey(record.identity), record.label]),
      ),
    [records],
  );
  const active = records.filter((record) =>
    selected.has(identityKey(record.identity)),
  );
  const visible = records.filter((record) =>
    (
      record.label +
      " " +
      identityLabel(record) +
      " " +
      record.identity.localType
    )
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  const bindingIndex = useMemo(
    () =>
      new Map(
        sync?.bindings.map((object) => [identityKey(object.identity), object]),
      ),
    [sync],
  );
  const bound = sync
    ? records.filter((record) =>
        resolveBusinessObject(sync, record.identity, bindingIndex),
      ).length
    : 0;
  const conflicts =
    sync?.operations.filter((op) => op.status === "CONFLICT") ?? [];
  const rules = workspace?.rules.filter((rule) => rule.selectorTree) ?? [];
  const published = new Set(sync?.selectors.map((entry) => entry.selectorUuid));
  const rule = rules.find(
    (entry) => entry.selectorTree?.selector.uuid === selectorId,
  );
  const registry = sync?.registry;

  async function connect(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      const next = validateSyncSettings(input);
      await refreshRegistry(next);
      await browser.storage.local.set({ [syncSettingsKey]: next });
      setSettings(next);
      await localState();
      setMessage("Server schema refreshed.");
    })();
  }

  function resolve(actionType: ResolveAction) {
    return action(async () => {
      if (!settings || !sync || !active.length) return;
      if (
        actionType === "create" &&
        !confirm(
          `Create server identities for up to ${active.length} selected records? Check existing matches first.`,
        )
      )
        return;
      if (
        actionType === "bind" &&
        (active.length !== 1 ||
          !/^[1-9]\d{0,18}$/.test(existingId) ||
          !confirm(`Bind this record to server object ${existingId}?`))
      )
        return;
      const ordered = [...active].sort(
        (a, b) => Number(!!a.identity.target) - Number(!!b.identity.target),
      );
      let failures = 0;
      for (const record of ordered) {
        const key = identityKey(record.identity);
        setStatuses((old) => ({ ...old, [key]: "RESOLVING" }));
        try {
          const result = await reconcile(
            settings,
            sync,
            record.identity,
            actionType,
            actionType === "bind" ? existingId : undefined,
          );
          setStatuses((old) => ({
            ...old,
            [key]: result.reason ?? result.status,
          }));
        } catch (error) {
          failures++;
          const status =
            error instanceof SyncError && error.status === 409
              ? "CONFLICT"
              : "SYNC_ERROR";
          setStatuses((old) => ({
            ...old,
            [key]: status + " " + (error instanceof Error ? error.message : ""),
          }));
        }
      }
      await localState();
      void requestSyncAction("wake").catch(() => undefined);
      setPreview(null);
      setMessage(
        failures
          ? `${failures} records need attention.`
          : "Selected records checked.",
      );
    });
  }

  function compare(historyKeys?: string[]) {
    return action(async () => {
      if (!settings || !sync) return;
      const keys = historyKeys ? new Set(historyKeys) : selected;
      const snapshot = historyKeys ? await localState() : null;
      const toCompare = historyKeys
        ? (snapshot?.committed ? localRecords(snapshot.committed) : []).filter(
            (record) => keys.has(identityKey(record.identity)),
          )
        : active;
      if (!toCompare.length) return;
      setPreview(null);
      setHistoryReview(null);
      // Refresh current heads for the comparison the user will actually review.
      for (const record of toCompare)
        await reconcile(
          settings,
          snapshot?.state ?? sync,
          record.identity,
          "preview",
        );
      const { state, committed } = await localState();
      if (!committed || !state.registry) return;
      const proposed = makeCommitPreview(state, null, committed, keys);
      if (historyKeys) {
        setHistoryReview({
          keys: historyKeys,
          expectedRevision: committed.revision,
          schemaRevisionId: state.registry.revisionId,
          workspaceUuid: state.workspaceUuid,
        });
      }
      setPreview(proposed);
      if (!proposed.operation)
        setMessage("The selected values have no changes to send.");
    });
  }

  useEffect(() => {
    if (preview && historyReview)
      document
        .getElementById("historical-value-preview")
        ?.scrollIntoView({ block: "nearest" });
  }, [preview, historyReview]);

  const sendPreview = action(async () => {
    if (!settings || !preview) return;
    if (historyReview) {
      await continuousLocal("approveValues", {
        origin: settings.origin,
        ...historyReview,
        preview: preview.operation,
        compared: preview.compared,
      });
      setHistoryReview(null);
      setPreview(null);
      await requestSyncAction("wake");
      setMessage("Value review saved.");
      return;
    }
    if (!preview.operation?.request) return;
    const current = await loadCommittedState();
    if (current?.revision !== preview.operation.localRevision)
      throw new Error(
        "The local workspace changed. Compare the selected values again.",
      );
    await enqueueOperation(preview.operation);
    setPreview(null);
    await requestSyncAction("legacy");
    await localState();
  });

  const uploadSelector = action(async () => {
    if (!settings || !sync || !rule || !sourceId) return;
    const identity = selectorIdentity(rule, records);
    if (!identity)
      throw new Error(
        "This selector's local target needs an explicit identity.",
      );
    if (
      !confirm("Synchronize this selector and its locally reviewed versions?")
    )
      return;
    await syncSelector(settings, sync, rule, identity, sourceId, true);
    await localState();
    setMessage("Selector bound to the server field.");
  });

  const uploadCapture = action(async () => {
    if (!settings || !sync || !rule || !snapshotId) return;
    const identity = selectorIdentity(rule, records);
    if (!identity) throw new Error("This selector's target is unresolved.");
    if (
      !confirm(
        "Send the latest successful selector evaluation to the selected server snapshot?",
      )
    )
      return;
    const receipt = await reportCapture(
      settings,
      sync,
      rule,
      identity,
      snapshotId,
    );
    setMessage(
      `Saved ${receipt.observationIds.length} DETECTED observation(s).`,
    );
  });

  return (
    <section className="ui-card ui-monitoring ui-backend-sync">
      <h2>Backend synchronization</h2>
      <form onSubmit={connect}>
        <label>
          Backend origin
          <input
            required
            value={input.origin}
            placeholder="https://burbot.example.org"
            onChange={(event) =>
              setInput({ ...input, origin: event.target.value })
            }
          />
        </label>
        <label>
          Workspace token
          <input
            required
            type="password"
            autoComplete="off"
            value={input.token}
            onChange={(event) =>
              setInput({ ...input, token: event.target.value })
            }
          />
        </label>
        {continuousMode === null && (
          <label className="ui-sync-checkbox">
            <input
              type="checkbox"
              checked={input.syncApprovedCommits}
              onChange={(event) =>
                setInput({
                  ...input,
                  syncApprovedCommits: event.target.checked,
                })
              }
            />
            Sync approved values for bound records
          </label>
        )}
        <div className="ui-actions">
          <button disabled={busy}>Refresh schema</button>
          <button
            type="button"
            disabled={busy}
            onClick={action(async () => {
              await localState();
            })}
          >
            Refresh local state
          </button>
        </div>
      </form>

      <ContinuousSyncOptions
        settings={settings}
        linked={Boolean(registry)}
        onMode={setContinuousMode}
        onReviewValues={(keys) => compare(keys)()}
      />

      {sync && (
        <p className="ui-muted">
          Workspace UUID <code>{sync.workspaceUuid}</code>
        </p>
      )}

      {registry && sync && (
        <>
          <p>
            {registry.name} · schema revision {registry.revisionId}
          </p>
          <p className="ui-muted">
            {bound} synchronized records · {records.length - bound} local or
            unresolved · {conflicts.length} commit conflicts
            <br />
            {
              rules.filter((item) =>
                published.has(item.selectorTree!.selector.uuid),
              ).length
            }{" "}
            bound selectors ·{" "}
            {
              rules.filter(
                (item) => !published.has(item.selectorTree!.selector.uuid),
              ).length
            }{" "}
            unresolved
          </p>
          <label>
            Find local records
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="ui-sync-records">
            {visible.slice(0, 100).map((record) => {
              const key = identityKey(record.identity);
              const binding = resolveBusinessObject(
                sync,
                record.identity,
                bindingIndex,
              );
              const definition = entityFor(registry, record.identity);
              return (
                <div className="ui-sync-record" key={key}>
                  <label className="ui-sync-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        setSelected(next);
                        setPreview(null);
                      }}
                    />
                    <span>
                      {record.label}
                      <small>
                        {identityLabel(record)} ·{" "}
                        {statuses[key] ?? binding?.status ?? "LOCAL_ONLY"}
                      </small>
                    </span>
                  </label>
                  <details>
                    <summary>Inspect identity</summary>
                    <dl>
                      <dt>Local ID</dt>
                      <dd>{identityLabel(record)}</dd>
                      <dt>Entity</dt>
                      <dd>
                        {definition?.key ?? "Unresolved"}{" "}
                        {definition?.businessEntityId}
                      </dd>
                      <dt>Server ID</dt>
                      <dd>{binding?.businessObjectId ?? "—"}</dd>
                    </dl>
                    {binding && (
                      <details>
                        <summary>Field and slot IDs</summary>
                        <ul>
                          {Object.entries(binding.objectFields).map(
                            ([name, slot]) => (
                              <li key={name}>
                                {name} · field {slot.businessEntityFieldId} ·
                                slot {slot.businessObjectFieldId}
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
          {visible.length > 100 && (
            <p className="ui-muted">
              Showing the first 100 results. Refine the search to find other
              records.
            </p>
          )}
          <div className="ui-actions">
            <button
              disabled={busy || !settings || !active.length}
              onClick={resolve("preview")}
            >
              Preview bindings
            </button>
            <button
              disabled={busy || !settings || !active.length}
              onClick={resolve("resolve")}
            >
              Resolve selected
            </button>
            <button
              disabled={
                busy ||
                !settings ||
                !active.length ||
                !registry.permissions.create
              }
              onClick={resolve("create")}
            >
              Create selected identities
            </button>
            <button
              disabled={
                busy ||
                !settings ||
                !active.length ||
                !registry.permissions.commit
              }
              onClick={compare()}
            >
              Compare selected values
            </button>
          </div>
          {registry.permissions.bindExisting && (
            <>
              <label>
                Existing server object ID
                <input
                  inputMode="numeric"
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                />
              </label>
              <button
                disabled={
                  busy || !settings || active.length !== 1 || !existingId
                }
                onClick={resolve("bind")}
              >
                Bind selected record
              </button>
            </>
          )}

          {preview && (preview.operation || historyReview) && (
            <div
              className="ui-sync-preview"
              id={historyReview ? "historical-value-preview" : undefined}
            >
              <h3>Review proposed server changes</h3>
              {preview.differences.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Field</th>
                      <th>Server</th>
                      <th>Proposed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.differences.map((row) => (
                      <tr key={identityKey(row.identity) + row.field}>
                        <td>
                          {labels.get(identityKey(row.identity)) ??
                            row.identity.localObjectId}
                          {row.identity.target &&
                            ` / ${row.identity.target.id}`}
                        </td>
                        <td>{row.field}</td>
                        <td>{display(row.server)}</td>
                        <td>{display(row.proposed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.operation?.skipped.map((row) => (
                <p key={identityKey(row.identity) + row.field}>
                  {row.identity.localObjectId} · {row.field} · {row.reason}
                </p>
              ))}
              <button
                disabled={
                  busy ||
                  (!preview.operation?.request &&
                    (!historyReview ||
                      Boolean(preview.operation?.skipped.length)))
                }
                onClick={sendPreview}
              >
                {historyReview && !preview.operation?.request
                  ? "Mark values reviewed"
                  : "Confirm server synchronization"}
              </button>
            </div>
          )}

          <details className="ui-sync-details">
            <summary>Selector and capture synchronization</summary>
            <label>
              Local selector
              <select
                value={selectorId}
                onChange={(e) => setSelectorId(e.target.value)}
              >
                <option value="">Choose a selector</option>
                {rules.map((item) => (
                  <option
                    key={item.selectorTree!.selector.uuid}
                    value={item.selectorTree!.selector.uuid}
                  >
                    {item.objectId} / {item.field}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approved server source
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">Choose a source</option>
                {registry.sources.map((item) => (
                  <option key={item.sourceId} value={item.sourceId}>
                    {item.url ?? item.sourceId}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !rule || !sourceId || !settings}
              onClick={uploadSelector}
            >
              Synchronize selector
            </button>
            <label>
              Server snapshot ID
              <input
                inputMode="numeric"
                value={snapshotId}
                onChange={(e) => setSnapshotId(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !rule || !snapshotId || !settings}
              onClick={uploadCapture}
            >
              Send latest capture
            </button>
          </details>

          <details className="ui-sync-details">
            <summary>Queued commits and conflicts</summary>
            <button
              disabled={busy || !settings}
              onClick={action(async () => {
                if (!settings) return;
                await requestSyncAction("legacy");
                await localState();
              })}
            >
              Retry pending commits
            </button>
            {sync.operations.slice(0, 50).map((op) => (
              <details key={op.operationId}>
                <summary>
                  Local revision {op.localRevision} · {op.status}
                  {op.result?.code && ` · ${op.result.code}`}
                </summary>
                {op.result?.message && <p>{op.result.message}</p>}
                {op.skipped.map((row) => (
                  <p key={identityKey(row.identity) + row.field}>
                    {row.identity.localObjectId} · {row.field} · {row.reason}
                  </p>
                ))}
                {op.status === "CONFLICT" && op.request && (
                  <ul>
                    {op.request.changes.flatMap((change) =>
                      change.fields.map((field) => (
                        <li key={field.businessObjectFieldId}>
                          {change.identity.localObjectId} ·{" "}
                          {field.persistentKey} · proposed{" "}
                          {display(field.value)}
                          {op.result?.object?.businessObjectId ===
                            change.businessObjectId &&
                            ` · server ${display(op.result.object.objectFields[field.persistentKey]?.value)}`}
                        </li>
                      )),
                    )}
                  </ul>
                )}
              </details>
            ))}
          </details>
        </>
      )}
      <BulkSyncOptions
        settings={settings}
        onSynchronized={async () => {
          if (settings) await refreshRegistry(settings).catch(() => undefined);
          await localState();
          void requestSyncAction("wake").catch(() => undefined);
        }}
      />
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
    </section>
  );
}
