import { useEffect, useMemo, useState } from "react";
import { loadCommittedState } from "../shared/api/storage";
import {
  listBulkJobs,
  readBulkJob,
  startBulkJob,
} from "../shared/backend-sync/client";
import type {
  BulkJobSummary,
  BulkPlan,
  BulkProgress,
  BulkRow,
  Discovery,
  StoredBulkJob,
} from "../shared/backend-sync/bulkTypes";
import { executeBulkJob } from "../shared/backend-sync/bulkExecutor";
import {
  approveBulkPreview,
  makeBulkPreview,
} from "../shared/backend-sync/bulkPlanner";
import {
  canonicalSourceUrl,
  discoverSources,
} from "../shared/backend-sync/sourceDiscovery";
import type { SyncSettings } from "../shared/backend-sync/types";
import type { LegacyStorageState } from "../shared/types/legacy-storage";

const pageSize = 25;
const statusName = (status: string) =>
  status.toLowerCase().replaceAll("_", " ");

function scanRows(discovery: Discovery): BulkRow[] {
  return [
    ...discovery.sources.map((source): BulkRow => ({
      key: source.key,
      kind: "source",
      label: source.type,
      url: source.url ?? undefined,
      provenance: source.provenance,
      status: source.issue ?? "PENDING",
      reason:
        source.issue === "SOURCE_URL_INVALID"
          ? "Check the Source URL."
          : undefined,
    })),
    ...discovery.selectors.map(
      ({ key, rule, sourceKeys, pendingEvidence }): BulkRow => ({
        key,
        kind: "selector",
        label: rule.selectorTree
          ? `${rule.selectorTree.selector.target.field} · ${rule.selectorTree.selector.uuid}`
          : `${rule.field} · ${rule.id}`,
        objectId: rule.selectorTree?.selector.target.objectId ?? rule.objectId,
        status: rule.selectorTree
          ? sourceKeys.length > 1
            ? "SOURCE_AMBIGUOUS"
            : sourceKeys.length
              ? "PENDING"
              : "SOURCE_MISSING"
          : "UNSUPPORTED",
        pendingEvidence,
      }),
    ),
  ];
}

function withProgress(rows: BulkRow[], progress: Record<string, BulkProgress>) {
  return rows.map((row) => {
    const result = progress[row.key];
    return result
      ? {
          ...row,
          status: result.status,
          reason: result.reason,
          sourceId:
            result.source?.sourceId ??
            result.selector?.sourceId ??
            row.sourceId,
        }
      : row;
  });
}

function saveReport(report: object) {
  const href = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = "burbot-bulk-sync-report.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function BulkSyncOptions({
  settings,
  onSynchronized,
}: {
  settings: SyncSettings | null;
  onSynchronized: () => Promise<unknown>;
}) {
  const [scan, setScan] = useState<{
    snapshot: LegacyStorageState;
    discovery: Discovery;
  } | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [jobs, setJobs] = useState<BulkJobSummary[]>([]);
  const [job, setJob] = useState<StoredBulkJob | null>(null);
  const [progress, setProgress] = useState<Record<string, BulkProgress>>({});
  const [selected, setSelected] = useState(new Set<string>());
  const [publishReviewed, setPublishReviewed] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function openJob(operationId: string) {
    const stored = await readBulkJob(operationId);
    setJob(stored);
    setProgress(
      Object.fromEntries(stored.progress.map((item) => [item.key, item])),
    );
    setStatus("");
    setPage(0);
  }

  useEffect(() => {
    void listBulkJobs()
      .then(({ jobs }) => {
        setJobs(jobs);
        if (jobs.length) return openJob(jobs[0].operationId);
      })
      .catch(() => setError("SQLite bulk sync history is unavailable."));
  }, []);

  function action(message: string, perform: () => Promise<void>) {
    return async () => {
      setBusy(message);
      setError("");
      try {
        await perform();
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Bulk synchronization failed.",
        );
      } finally {
        setBusy("");
      }
    };
  }

  function clearPreviewForScan() {
    setJob(null);
    setProgress({});
    setPlan(null);
    setSelected(new Set());
    setPublishReviewed(false);
    setStatus("");
    setPage(0);
  }

  const scanLocal = action("Scanning local sources…", async () => {
    const snapshot = await loadCommittedState();
    if (!snapshot)
      throw new Error("The SQLite workspace has no saved records to scan.");
    setScan({ snapshot, discovery: discoverSources(snapshot, corrections) });
    clearPreviewForScan();
  });

  const preview = action("Checking Source and selector bindings…", async () => {
    if (!settings || !scan) return;
    setPlan(null);
    setJob(null);
    setProgress({});
    setSelected(new Set());
    setPublishReviewed(false);
    setPlan(await makeBulkPreview(settings, scan.snapshot, scan.discovery));
    setStatus("");
    setPage(0);
  });

  async function chooseUrl(uuid: string, input: string) {
    await action("Checking the selected URL…", async () => {
      if (!scan) return;
      const url = canonicalSourceUrl(input);
      const next = { ...corrections, [uuid]: url };
      setCorrections(next);
      setScan({ ...scan, discovery: discoverSources(scan.snapshot, next) });
      clearPreviewForScan();
    })();
  }

  async function runJob(operationId: string) {
    if (!settings) return;
    try {
      await executeBulkJob(settings, operationId, {
        onProgress: (item) =>
          setProgress((previous) => ({ ...previous, [item.key]: item })),
      });
    } finally {
      await openJob(operationId);
      const result = await listBulkJobs();
      setJobs(result.jobs);
      await onSynchronized();
    }
  }

  const synchronize = action("Synchronizing approved items…", async () => {
    if (!settings || !plan) return;
    const approved = approveBulkPreview(plan, selected, publishReviewed);
    const sources = approved.tasks.filter((item) => item.kind === "source");
    const selectors = approved.tasks.filter((item) => item.kind === "selector");
    const creates = sources.filter((item) => item.request.allowCreate).length;
    const grants = sources.filter(
      (item) => item.request.allowGrantExisting,
    ).length;
    const reviews = selectors.filter((item) => item.publishReviewed).length;
    if (
      !confirm(
        `Synchronize ${sources.length} selected Sources and ${selectors.length} SelectorTrees?\n\n` +
          `Register up to ${creates} Sources and grant access to ${grants} existing Sources.\n` +
          `Publish reviewed versions for ${reviews} selectors.`,
      )
    )
      return;
    await startBulkJob(approved);
    await openJob(approved.operationId);
    await runJob(approved.operationId);
  });

  const baseRows = useMemo(
    () => job?.report ?? plan?.rows ?? (scan ? scanRows(scan.discovery) : []),
    [job, plan, scan],
  );
  const rows = useMemo(
    () => withProgress(baseRows, progress),
    [baseRows, progress],
  );
  const statuses = [...new Set(rows.map((row) => row.status))].sort();
  const query = filter.trim().toLowerCase();
  const matching = rows.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      (!status || row.status === status) &&
      [
        row.label,
        row.objectId,
        row.businessObjectFieldId,
        row.url,
        row.sourceId,
        ...(row.provenance ?? []),
      ].some((value) => value?.toLowerCase().includes(query)),
  );
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const planned = !!plan && !job;
  const eligible = new Set(
    planned
      ? [
          ...plan.sources.map((item) => item.key),
          ...plan.selectors
            .filter((item) => !item.publishReviewed || publishReviewed)
            .map((item) => item.key),
        ]
      : [],
  );
  const selection = [...selected].filter((key) => eligible.has(key));
  const retryable =
    job &&
    Object.values(progress).some(({ status }) =>
      ["PENDING", "SYNC_ERROR", "BLOCKED"].includes(status),
    );
  const pendingEvidence =
    job?.pendingEvidence ?? scan?.discovery.pendingEvidence ?? 0;
  const selectorsByKey = useMemo(
    () => new Map(scan?.discovery.selectors.map((item) => [item.key, item])),
    [scan],
  );
  const sourcesByKey = useMemo(
    () => new Map(scan?.discovery.sources.map((item) => [item.key, item])),
    [scan],
  );

  function exportReport() {
    const approved = new Set(job?.tasks.map(({ key }) => key) ?? selection);
    saveReport({
      operationId: job?.operationId ?? null,
      workspaceUuid: job?.workspaceUuid ?? plan?.workspaceUuid ?? null,
      localRevision: job?.localRevision ?? scan?.snapshot.revision,
      schemaRevisionId: job?.schemaRevisionId ?? plan?.schemaRevisionId,
      pendingEvidence,
      items: rows.map((row) => ({ ...row, selected: approved.has(row.key) })),
    });
  }

  return (
    <section className="ui-sync-details" aria-labelledby="bulk-sync-title">
      <h3 id="bulk-sync-title">Bulk Source &amp; Selector Synchronization</h3>
      <div className="ui-actions">
        <button disabled={!!busy} onClick={scanLocal}>
          Scan local sources
        </button>
        <button disabled={!!busy || !settings || !scan} onClick={preview}>
          Preview synchronization
        </button>
        <button
          disabled={!!busy || !settings || !selection.length}
          onClick={synchronize}
        >
          Synchronize selected
        </button>
        <button
          disabled={!!busy || !settings || !retryable}
          onClick={action("Resuming saved operation…", async () => {
            if (job) await runJob(job.operationId);
          })}
        >
          Retry failed
        </button>
        <button disabled={!rows.length} onClick={exportReport}>
          Export report
        </button>
      </div>
      {jobs.length > 0 && (
        <label>
          Saved operation
          <select
            disabled={!!busy}
            value={job?.operationId ?? ""}
            onChange={(event) => {
              const operationId = event.target.value;
              if (!operationId) {
                setJob(null);
                setProgress({});
                setPage(0);
              } else
                void action("Opening saved operation…", () =>
                  openJob(operationId),
                )();
            }}
          >
            <option value="">Current scan and preview</option>
            {jobs.map((entry) => (
              <option key={entry.operationId} value={entry.operationId}>
                {new Date(entry.createdAt).toLocaleString()} · {entry.synced}{" "}
                synced · {entry.pending} pending · {entry.failed} need attention
              </option>
            ))}
          </select>
        </label>
      )}
      {busy && <p role="status">{busy}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {(scan || job) && (
        <p>
          {scan && !job && (
            <>
              {scan.discovery.sources.length} Source candidates ·{" "}
              {
                new Set(
                  scan.discovery.sources.flatMap(({ url }) =>
                    url ? [url] : [],
                  ),
                ).size
              }{" "}
              unique URLs ·{" "}
              {
                scan.discovery.selectors.filter(({ rule }) => rule.selectorTree)
                  .length
              }{" "}
              SelectorTrees ·{" "}
            </>
          )}
          {job && (
            <>
              {
                Object.values(progress).filter(
                  (item) => item.status === "SYNCED",
                ).length
              }{" "}
              of {job.tasks.length} selected items synchronized ·{" "}
            </>
          )}
          {pendingEvidence} historic evidence entries pending registration
        </p>
      )}
      {planned && (
        <>
          <p>
            {
              plan.sources.filter((item) => item.request.expectedSourceId)
                .length
            }{" "}
            eligible existing Sources ·{" "}
            {plan.sources.filter((item) => item.request.allowCreate).length}{" "}
            proposed registrations ·{" "}
            {
              plan.selectors.filter(
                (item) => !item.publishReviewed && !item.alreadySynced,
              ).length
            }{" "}
            selectors ready ·{" "}
            {plan.selectors.filter((item) => item.alreadySynced).length} already
            synchronized ·{" "}
            {plan.selectors.filter((item) => item.publishReviewed).length}{" "}
            require review approval ·{" "}
            {plan.rows.filter((row) => row.kind === "selector").length -
              plan.selectors.length}{" "}
            need attention
          </p>
          {plan.selectors.some((item) => item.publishReviewed) && (
            <label className="ui-sync-checkbox">
              <input
                type="checkbox"
                checked={publishReviewed}
                disabled={!!busy}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setPublishReviewed(checked);
                  if (!checked)
                    setSelected(
                      (previous) =>
                        new Set(
                          [...previous].filter(
                            (key) =>
                              !plan.selectors.some(
                                (task) =>
                                  task.key === key && task.publishReviewed,
                              ),
                          ),
                        ),
                    );
                }}
              />
              Allow selected locally reviewed versions to be published
            </label>
          )}
          <div className="ui-actions">
            <button
              disabled={!!busy || !eligible.size}
              onClick={() => setSelected(new Set(eligible))}
            >
              Select eligible
            </button>
            <button
              disabled={!!busy || !selection.length}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
            <span>
              {selection.length} selected. Select the Source for each selector.
            </span>
          </div>
        </>
      )}
      {rows.length > 0 && (
        <>
          <div className="ui-bulk-filters">
            <label>
              Filter by Source, object or selector
              <input
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Item type
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All items</option>
                <option value="source">Sources</option>
                <option value="selector">Selectors</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All statuses</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {statusName(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ui-sync-preview">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {matching
                  .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                  .map((row) => {
                    const selector = !job && selectorsByKey.get(row.key);
                    const uuid =
                      selector && selector.rule.selectorTree?.selector.uuid;
                    const canCorrect =
                      uuid &&
                      [
                        "SOURCE_AMBIGUOUS",
                        "SOURCE_MISSING",
                        "SOURCE_URL_INVALID",
                        "SOURCE_TYPE_MISMATCH",
                      ].includes(row.status);
                    return (
                      <tr key={row.key}>
                        <td>
                          {planned ? (
                            <label className="ui-sync-checkbox">
                              <input
                                type="checkbox"
                                disabled={!!busy || !eligible.has(row.key)}
                                checked={
                                  selected.has(row.key) && eligible.has(row.key)
                                }
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setSelected((previous) => {
                                    const next = new Set(previous);
                                    if (checked) next.add(row.key);
                                    else next.delete(row.key);
                                    return next;
                                  });
                                }}
                              />
                              {row.label}
                            </label>
                          ) : (
                            row.label
                          )}
                          {row.objectId && (
                            <small className="ui-bulk-detail">
                              {row.objectId}
                            </small>
                          )}
                          {row.businessObjectFieldId && (
                            <small className="ui-bulk-detail">
                              Server field {row.businessObjectFieldId}
                            </small>
                          )}
                          {row.provenance?.length ? (
                            <small className="ui-bulk-detail">
                              {row.provenance[0]}
                              {row.provenance.length > 1 &&
                                ` · ${row.provenance.length} references`}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {row.url}
                          {row.sourceId && (
                            <small className="ui-bulk-detail">
                              Source {row.sourceId}
                            </small>
                          )}
                          {canCorrect && selector && (
                            <details>
                              <summary>Choose Source URL</summary>
                              {selector.sourceKeys.length > 1 && (
                                <select
                                  aria-label="Discovered Source URL"
                                  disabled={!!busy}
                                  value=""
                                  onChange={(event) => {
                                    if (event.target.value)
                                      void chooseUrl(uuid, event.target.value);
                                  }}
                                >
                                  <option value="">
                                    Choose a discovered URL
                                  </option>
                                  {selector.sourceKeys.flatMap((key) => {
                                    const source = sourcesByKey.get(key);
                                    return source?.url && source.type === "HTML"
                                      ? [
                                          <option key={key} value={source.url}>
                                            {source.url}
                                          </option>,
                                        ]
                                      : [];
                                  })}
                                </select>
                              )}
                              <form
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void chooseUrl(
                                    uuid,
                                    String(
                                      new FormData(event.currentTarget).get(
                                        "url",
                                      ) ?? "",
                                    ),
                                  );
                                }}
                              >
                                <label>
                                  Corrected URL
                                  <input
                                    name="url"
                                    type="url"
                                    required
                                    disabled={!!busy}
                                  />
                                </label>
                                <button disabled={!!busy}>Use URL</button>
                              </form>
                            </details>
                          )}
                        </td>
                        <td>
                          {statusName(row.status)}
                          {row.reason && (
                            <small className="ui-bulk-detail">
                              {row.reason}
                            </small>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {matching.length === 0 && <p>No matching items.</p>}
          <div className="ui-actions">
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous page
            </button>
            <span>
              Page {currentPage + 1} of {pages} · {matching.length} items
            </span>
            <button
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  );
}
