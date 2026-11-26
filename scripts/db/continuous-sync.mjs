import { randomUUID } from "node:crypto";
import { entityFor } from "../../src/shared/backend-sync/records.js";
import { approvedChanges } from "./approved-changes.mjs";

const leaseMs = 90_000;
const runnable = "'QUEUED','RETRY_PENDING','WAITING_DEPENDENCY'";
const issues = "'RETRY_PENDING','WAITING_DEPENDENCY','BLOCKED','CONFLICT'";
const decode = (value) => (value == null ? null : JSON.parse(value));

export function createContinuousSync(
  db,
  { workspace, requireWorkspace, readBinding, writeBinding, boundId, invalid },
) {
  const insert = db.prepare(`
    INSERT INTO backend_sync_operations
      (workspace_uuid, operation_id, local_revision, sync_status, payload_json,
       created_at, updated_at, identity_key, predecessor_id)
    VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)
  `);
  const newest = db.prepare(`
    SELECT operation_id, sync_status FROM backend_sync_operations
    WHERE workspace_uuid=? AND identity_key=?
    ORDER BY local_revision DESC LIMIT 1
  `);
  const readOperation = db.prepare(`
    SELECT * FROM backend_sync_operations WHERE workspace_uuid=? AND operation_id=?`);
  const eligible = `
    o.workspace_uuid=? AND o.identity_key IS NOT NULL AND o.sync_status IN (${runnable})
    AND (o.predecessor_id IS NULL OR EXISTS (
      SELECT 1 FROM backend_sync_operations p WHERE p.workspace_uuid=o.workspace_uuid
      AND p.operation_id=o.predecessor_id AND p.sync_status='SYNCED'
    ))
  `;

  function enqueue(
    before,
    state,
    legacyOperation,
    enqueueLegacy,
    reviewedObjectIds,
  ) {
    const row = workspace();
    if (row.continuous_mode == null) {
      if (legacyOperation) enqueueLegacy(legacyOperation);
      return { legacyQueued: Boolean(legacyOperation?.request) };
    }
    const timestamp = new Date().toISOString();
    const registry = decode(row.registry_json);
    const namespace = row.workspace_uuid;
    const reviewed = reviewedObjectIds && new Set(reviewedObjectIds);
    for (const { key, ...intent } of approvedChanges(
      before,
      state,
      registry,
      reviewed,
    )) {
      const operationId = randomUUID();
      const previous = newest.get(namespace, key);
      const binding = readBinding(namespace, key);
      const heads = {};
      for (const field of intent.fields) {
        const slot = binding?.objectFields[field.persistentKey];
        if (slot) heads[field.persistentKey] = slot;
      }
      insert.run(
        namespace,
        operationId,
        state.revision,
        JSON.stringify({
          ...intent,
          operationId,
          localRevision: state.revision,
          schemaRevisionId: registry.revisionId,
          boundObjectId: binding?.businessObjectId ?? null,
          heads,
        }),
        timestamp,
        timestamp,
        key,
        previous?.sync_status === "SYNCED"
          ? null
          : (previous?.operation_id ?? null),
      );
    }
    return { legacyQueued: false };
  }

  const configure = db.transaction(({ origin, enabled }) => {
    if (typeof enabled !== "boolean" || !origin)
      throw invalid(
        422,
        "Choose a backend connection before configuring continuous sync.",
      );
    const row = requireWorkspace(workspace().workspace_uuid, origin);
    if (!row.registry_json)
      throw invalid(409, "Refresh the backend schema first.");
    db.prepare(
      "UPDATE backend_workspace_identity SET continuous_mode=? WHERE id=1",
    ).run(Number(enabled));
  });

  function sourceId(namespace, registry, value) {
    if (registry.sources.some((entry) => entry.sourceId === value))
      return value;
    let canonical = value;
    try {
      const url = new URL(value);
      url.hash = "";
      canonical = url.href;
    } catch {
      // The dependency may be an exact local Source key.
    }
    const matches = db
      .prepare(
        `
      SELECT DISTINCT backend_source_id FROM backend_source_bindings
      WHERE workspace_uuid=? AND (local_source_key=? OR canonical_url=?) LIMIT 2
    `,
      )
      .all(namespace, value, canonical);
    return matches.length === 1 ? matches[0].backend_source_id : null;
  }

  const activeLease = db.prepare(`
    SELECT MIN(lease_until) AS deadline FROM backend_sync_operations
    WHERE workspace_uuid=? AND lease_until>0 AND lease_until>?
  `);
  const next = db.prepare(`
    SELECT * FROM backend_sync_operations o WHERE ${eligible}
    AND o.due_at<=? AND o.lease_until<=?
    ORDER BY o.local_revision, o.rowid LIMIT 1
  `);
  const nextDue = db.prepare(`
    SELECT MIN(MAX(o.due_at,o.lease_until)) AS deadline
    FROM backend_sync_operations o WHERE ${eligible}
  `);

  const claim = db.transaction(({ origin, manual }) => {
    const row = workspace();
    if (
      row.backend_origin !== origin ||
      row.continuous_mode == null ||
      (!manual && row.continuous_mode !== 1)
    )
      return { job: null, retryAt: null };
    const namespace = row.workspace_uuid;
    const now = Date.now();
    const active = activeLease.get(namespace, now).deadline;
    if (active) return { job: null, retryAt: active };
    const candidate = next.get(namespace, now, now);
    if (!candidate)
      return { job: null, retryAt: nextDue.get(namespace).deadline };
    const leaseId = randomUUID();
    db.prepare(
      `UPDATE backend_sync_operations SET lease_id=?, lease_until=?
      WHERE workspace_uuid=? AND operation_id=?`,
    ).run(leaseId, now + leaseMs, namespace, candidate.operation_id);
    const intent = decode(candidate.payload_json);
    const registry = decode(row.registry_json);
    const resolved = {};
    // A prepared request remains byte-for-byte stable even when dependencies change.
    let missing = null;
    if (!intent.request) {
      for (const dependency of intent.dependencies) {
        const id =
          dependency.type === "source"
            ? sourceId(namespace, registry, dependency.value)
            : dependency.key && boundId(namespace, dependency.key);
        if (id) resolved[dependency.lookup] = id;
        else if (
          !missing ||
          (dependency.type === "reference" && !dependency.key)
        )
          missing =
            dependency.type === "source"
              ? { code: "SOURCE_UNRESOLVED" }
              : {
                  code: dependency.ambiguous
                    ? "REFERENCE_AMBIGUOUS"
                    : "REFERENCE_UNRESOLVED",
                  blocked: !dependency.key,
                  ...(dependency.label && { message: dependency.label }),
                };
      }
    }
    const prior = candidate.predecessor_id
      ? readOperation.get(namespace, candidate.predecessor_id)
      : null;
    return {
      retryAt: null,
      job: {
        workspaceUuid: namespace,
        leaseId,
        intent,
        resolved,
        missing,
        registry: {
          ...registry,
          entities: [entityFor(registry, intent.identity)].filter(Boolean),
          sources: [],
        },
        confirmed: decode(prior?.result_json)?.confirmed ?? {},
      },
    };
  });

  function leased(scope) {
    const { workspaceUuid, origin, operationId, leaseId } = scope;
    requireWorkspace(workspaceUuid, origin);
    const item = readOperation.get(workspaceUuid, operationId);
    if (!item || !item.identity_key || !leaseId || item.lease_id !== leaseId)
      throw invalid(
        409,
        "The synchronization lease changed. The operation can be retried.",
      );
    return item;
  }

  const prepare = db.transaction(({ request, anchors, object, ...scope }) => {
    const item = leased(scope);
    const intent = decode(item.payload_json);
    if (
      intent.request ||
      request.operationId !== scope.operationId ||
      request.workspaceUuid !== scope.workspaceUuid
    )
      throw invalid(409, "The synchronization operation is already prepared.");
    if (!boundId(scope.workspaceUuid, item.identity_key))
      writeBinding(scope.workspaceUuid, object);
    db.prepare(
      `UPDATE backend_sync_operations SET payload_json=?
      WHERE workspace_uuid=? AND operation_id=?`,
    ).run(
      JSON.stringify({ ...intent, request, anchors }),
      scope.workspaceUuid,
      scope.operationId,
    );
  });

  const finish = db.transaction(({ status, result, ...scope }) => {
    const item = leased(scope);
    if (
      ![
        "SYNCED",
        "RETRY_PENDING",
        "WAITING_DEPENDENCY",
        "CONFLICT",
        "BLOCKED",
      ].includes(status)
    )
      throw invalid(422, "Invalid continuous synchronization status.");
    if (status === "SYNCED") {
      const row = workspace();
      const object = result.object;
      if (object?.schemaRevisionId === row.schema_revision_id) {
        const cached = readBinding(scope.workspaceUuid, item.identity_key);
        if (cached) {
          // The receipt describes the whole object. Advance only the fields this
          // Commit approved, so an unrelated server edit retains its conflict check.
          const fields = { ...cached.objectFields };
          for (const { persistentKey } of decode(item.payload_json).fields)
            if (persistentKey && object.objectFields[persistentKey])
              fields[persistentKey] = object.objectFields[persistentKey];
          writeBinding(scope.workspaceUuid, {
            ...object,
            objectFields: fields,
          });
        } else writeBinding(scope.workspaceUuid, object);
      }
    }
    const retry = status === "RETRY_PENDING" || status === "WAITING_DEPENDENCY";
    const attempts = item.sync_status === status ? item.attempt_count + 1 : 1;
    const delay = retry
      ? Math.min(
          status === "WAITING_DEPENDENCY" ? 60_000 : 300_000,
          1500 * 2 ** Math.min(attempts, 8) * (0.85 + Math.random() * 0.3),
        )
      : 0;
    db.prepare(
      `UPDATE backend_sync_operations SET sync_status=?, result_json=?, updated_at=?,
      due_at=?, attempt_count=?, lease_id=NULL, lease_until=0
      WHERE workspace_uuid=? AND operation_id=?`,
    ).run(
      status,
      JSON.stringify(result),
      new Date().toISOString(),
      retry ? Math.round(Date.now() + delay) : 0,
      attempts,
      scope.workspaceUuid,
      scope.operationId,
    );
  });

  const release = db.transaction((scope) => {
    leased(scope);
    db.prepare(
      `UPDATE backend_sync_operations SET lease_id=NULL, lease_until=0
      WHERE workspace_uuid=? AND operation_id=?`,
    ).run(scope.workspaceUuid, scope.operationId);
  });

  const retry = db.transaction(({ origin }) => {
    const { workspace_uuid: namespace } = requireWorkspace(
      workspace().workspace_uuid,
      origin,
    );
    db.prepare(
      `UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0, attempt_count=0
      WHERE workspace_uuid=? AND identity_key IS NOT NULL AND lease_until<=?
      AND sync_status IN ('BLOCKED','RETRY_PENDING','WAITING_DEPENDENCY')`,
    ).run(namespace, Date.now());
  });

  function summary() {
    const row = workspace();
    const namespace = row.workspace_uuid;
    const counts = db
      .prepare(
        `
      SELECT COALESCE(SUM(pending),0) AS pending,
        COALESCE(SUM(NOT pending AND NOT conflict),0) AS synced,
        COALESCE(SUM(conflict),0) AS conflicts
      FROM (
        SELECT MAX(sync_status NOT IN ('SYNCED','CONFLICT')) AS pending,
          MAX(sync_status='CONFLICT') AS conflict
        FROM backend_sync_operations WHERE workspace_uuid=? AND identity_key IS NOT NULL
        GROUP BY identity_key
      )
    `,
      )
      .get(namespace);
    const lastSuccess = db
      .prepare(
        `SELECT MAX(updated_at) AS time
      FROM backend_sync_operations WHERE workspace_uuid=? AND identity_key IS NOT NULL
      AND sync_status='SYNCED'`,
      )
      .get(namespace).time;
    const problems = db
      .prepare(
        `SELECT operation_id, sync_status,
      json_extract(payload_json, '$.label') AS label,
      json_extract(result_json, '$.code') AS code,
      json_extract(result_json, '$.message') AS message
      FROM backend_sync_operations WHERE workspace_uuid=? AND identity_key IS NOT NULL
      AND sync_status IN (${issues}) ORDER BY updated_at DESC LIMIT 12`,
      )
      .all(namespace)
      .map((item) => ({
        id: item.operation_id,
        label: item.label,
        status: item.sync_status,
        code: item.code,
        message: item.message,
      }));
    return {
      mode: row.continuous_mode == null ? null : row.continuous_mode === 1,
      linked: Boolean(row.registry_json),
      ...counts,
      lastSuccess,
      running: Boolean(activeLease.get(namespace, Date.now()).deadline),
      problems,
    };
  }

  return {
    enqueue,
    claim,
    configure,
    prepare,
    finish,
    release,
    retry,
    summary,
  };
}
