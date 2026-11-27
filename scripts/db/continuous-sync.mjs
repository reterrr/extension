import { randomUUID } from "node:crypto";
import {
  entityFor,
  identityKey,
  localFieldKeys,
  recordKind,
  sourceLookupKey,
} from "../../src/shared/backend-sync/records.js";
import { approvedChanges, fieldDependencies } from "./approved-changes.mjs";
import { createReconciliationRecords } from "./reconciliation-records.mjs";

const leaseMs = 90_000;
const ready = "'QUEUED','RETRY_PENDING'";
const problems = "'RETRY_PENDING','WAITING_DEPENDENCY','BLOCKED','CONFLICT'";
const reviewLimit = 20;
const scanLimit = 64;
const reviewableConflicts = new Set([
  "CANONICAL_VALUE_CHANGED",
  "FIELD_BINDING_CHANGED",
  "SCHEMA_REVISION_CHANGED",
]);
const completedWork = new Set(["SYNCED", "SUPERSEDED"]);
const decode = (value) => (value == null ? null : JSON.parse(value));
const lookupFor = (kind, id) => JSON.stringify([kind, id]);

export function createContinuousSync(
  db,
  { workspace, requireWorkspace, readBinding, writeBinding, boundId, invalid },
) {
  const catalog = createReconciliationRecords(db);
  const insert = db.prepare(`
    INSERT INTO backend_sync_operations
      (workspace_uuid, operation_id, local_revision, sync_status, payload_json,
       created_at, updated_at, identity_key, predecessor_id, work_kind, priority)
    VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?)
  `);
  const lastCommit = db.prepare(`
    SELECT * FROM backend_sync_operations
    WHERE workspace_uuid=? AND identity_key=? AND work_kind='commit'
    ORDER BY local_revision DESC, rowid DESC LIMIT 1
  `);
  const creationProof = db.prepare(`
    SELECT 1 FROM backend_sync_operations
    WHERE workspace_uuid=? AND identity_key=? AND work_kind='commit'
      AND json_extract(payload_json, '$.canCreate')=1
      AND json_extract(payload_json, '$.schemaRevisionId')=?
    LIMIT 1
  `);
  const identityWork = db.prepare(`
    SELECT * FROM backend_sync_operations
    WHERE workspace_uuid=? AND identity_key=? AND work_kind='identity'
  `);
  const readOperation = db.prepare(`
    SELECT * FROM backend_sync_operations WHERE workspace_uuid=? AND operation_id=?
  `);
  const workspaceRevision = db.prepare(
    "SELECT revision FROM workspace_state WHERE id=1",
  );
  const clearEdges = db.prepare(`
    DELETE FROM backend_sync_dependencies WHERE workspace_uuid=? AND operation_id=?
  `);
  const addEdge = db.prepare(`
    INSERT OR IGNORE INTO backend_sync_dependencies VALUES (?, ?, ?, ?, ?)
  `);
  const wake = (column) =>
    db.prepare(`
      UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0
      WHERE workspace_uuid=? AND sync_status='WAITING_DEPENDENCY' AND lease_until=0
        AND operation_id IN (
          SELECT operation_id FROM backend_sync_dependencies WHERE workspace_uuid=? AND ${column}=?
        )
    `);
  const wakeByKey = wake("dependency_key");
  const wakeByLookup = wake("lookup");
  const wakeIdentity = db.prepare(`
    UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0
    WHERE workspace_uuid=? AND identity_key=? AND work_kind='identity'
      AND sync_status IN ('BLOCKED','CONFLICT','WAITING_DEPENDENCY') AND lease_until=0
  `);

  function bindingChanged(namespace, key) {
    wakeByKey.run(namespace, namespace, key);
    wakeIdentity.run(namespace, key);
  }

  function sourcesChanged(namespace, key, url) {
    for (const ref of new Set([key, url, sourceLookupKey(url)]))
      if (ref) wakeByLookup.run(namespace, namespace, lookupFor("source", ref));
  }

  function registryChanged(row, incoming) {
    const namespace = incoming.workspaceUuid;
    const previous = decode(row.registry_json);
    if (previous?.revisionId !== incoming.revisionId) {
      db.prepare(
        "UPDATE backend_sync_records SET scanned=0 WHERE scanned=-1",
      ).run();
      db.prepare(
        `
        UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0
        WHERE workspace_uuid=? AND lease_until=0 AND (sync_status='WAITING_DEPENDENCY'
          OR (work_kind='identity' AND sync_status='CONFLICT'
            AND json_extract(result_json,'$.code')='SCHEMA_REVISION_CHANGED'
            AND json_extract(payload_json,'$.resolution') IS NULL))
      `,
      ).run(namespace);
    }
    const priorSources = new Set(
      previous?.sources.map((source) => source.sourceId),
    );
    for (const source of incoming.sources)
      if (!priorSources.has(source.sourceId))
        sourcesChanged(
          namespace,
          source.sourceId,
          source.url ?? source.sourceId,
        );
  }

  function indexCommitted(state) {
    const row = workspace();
    const registry = decode(row.registry_json);
    const namespace = row.workspace_uuid;
    catalog.index(state, (key, localType, targetKind, value) => {
      if (!registry) return;
      wakeByKey.run(namespace, namespace, key);
      const kind = targetKind ?? recordKind(registry, { localType });
      wakeByLookup.run(namespace, namespace, lookupFor(kind, value));
    });
  }

  const migrate = db.transaction((state) => {
    const flag = "sync_reconciliation_index";
    const meta = db.prepare("SELECT value FROM app_meta WHERE key=?");
    if (meta.get(flag)) return;
    if (state) indexCommitted(state);
    // Older jobs used a retry timer without durable dependency edges.
    db.prepare(
      `
      UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0
      WHERE identity_key IS NOT NULL AND (
        sync_status='WAITING_DEPENDENCY' OR (
          sync_status='BLOCKED' AND json_extract(result_json, '$.code')
            IN ('REFERENCE_UNRESOLVED','REFERENCE_AMBIGUOUS','SOURCE_UNRESOLVED')
        )
      )
    `,
    ).run();
    db.prepare("INSERT INTO app_meta(key,value) VALUES (?, '1')").run(flag);
  });

  function addOperation(
    namespace,
    key,
    intent,
    predecessor = null,
    kind = "commit",
    priority = 0,
  ) {
    const time = new Date().toISOString();
    insert.run(
      namespace,
      intent.operationId,
      intent.localRevision,
      JSON.stringify(intent),
      time,
      time,
      key,
      predecessor,
      kind,
      priority,
    );
  }

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
    const registry = decode(row.registry_json);
    const namespace = row.workspace_uuid;
    const reviewed = reviewedObjectIds && new Set(reviewedObjectIds);
    for (const { key, newRecord, ...intent } of approvedChanges(
      before,
      state,
      registry,
      reviewed,
    )) {
      const prior = lastCommit.get(namespace, key);
      const binding = readBinding(namespace, key);
      const heads = {};
      for (const field of intent.fields) {
        const slot = binding?.objectFields[field.persistentKey];
        if (slot) heads[field.persistentKey] = slot;
      }
      addOperation(
        namespace,
        key,
        {
          ...intent,
          operationId: randomUUID(),
          localRevision: state.revision,
          schemaRevisionId: registry.revisionId,
          boundObjectId: binding?.businessObjectId ?? null,
          heads,
        },
        completedWork.has(prior?.sync_status)
          ? null
          : (prior?.operation_id ?? null),
      );
      if (newRecord) catalog.markValueReviewed(key);
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

  function ensureIdentity(namespace, registry, record, priority) {
    if (!record || record.ambiguous || !entityFor(registry, record.identity))
      return null;
    const existing = identityWork.get(namespace, record.key);
    if (existing) {
      if (priority < existing.priority)
        db.prepare(
          `
          UPDATE backend_sync_operations SET priority=? WHERE workspace_uuid=? AND operation_id=?
        `,
        ).run(priority, namespace, existing.operation_id);
      return existing.operation_id;
    }
    const operationId = randomUUID();
    const canCreate =
      !record.imported &&
      record.identity.localType !== "nabor" &&
      Boolean(creationProof.get(namespace, record.key, registry.revisionId));
    addOperation(
      namespace,
      record.key,
      {
        identity: record.identity,
        label: record.identity.target
          ? `${catalog.get(identityKey({ localObjectId: record.identity.localObjectId }))?.label ?? record.identity.localObjectId} · ${record.label}`
          : record.label,
        operationId,
        localRevision: workspaceRevision.get()?.revision ?? 0,
        schemaRevisionId: registry.revisionId,
        boundObjectId: null,
        canCreate,
        fields: [],
        heads: {},
      },
      null,
      "identity",
      priority,
    );
    return operationId;
  }

  function enabled(row, origin, manual) {
    return (
      row.backend_origin === origin &&
      row.continuous_mode != null &&
      (manual || row.continuous_mode === 1)
    );
  }

  const scan = db.transaction(({ origin, manual }) => {
    const row = workspace();
    if (!enabled(row, origin, manual)) return { scanned: 0, more: false };
    const registry = decode(row.registry_json);
    const namespace = row.workspace_uuid;
    const slice = catalog.pending(scanLimit + 1);
    for (const record of slice.slice(0, scanLimit)) {
      if (!entityFor(registry, record.identity)) {
        catalog.markScanned(record.key, -1);
        continue;
      }
      const bound = boundId(namespace, record.key);
      if (!bound) ensureIdentity(namespace, registry, record, 1);
      catalog.markScanned(record.key, bound ? 2 : 1);
    }
    return {
      scanned: Math.min(slice.length, scanLimit),
      more: slice.length > scanLimit,
    };
  });

  function sourceBinding(namespace, registry, value) {
    if (registry.sources.some((entry) => entry.sourceId === value))
      return { id: value };
    const matches = db
      .prepare(
        `
      SELECT DISTINCT backend_source_id FROM backend_source_bindings
      WHERE workspace_uuid=? AND (local_source_key=? OR canonical_url=?) LIMIT 2
    `,
      )
      .all(namespace, value, sourceLookupKey(value));
    return matches.length === 1
      ? { id: matches[0].backend_source_id }
      : { ambiguous: matches.length > 1 };
  }

  function referenceBinding(namespace, registry, dep, priority) {
    const match = dep.key
      ? { record: catalog.get(dep.key) }
      : catalog.reference(registry, dep.kind, dep.value);
    const { record, ambiguous } = match;
    const key = record?.key ?? dep.key ?? null;
    const id =
      !ambiguous && !record?.ambiguous && key && boundId(namespace, key);
    if (id) return { id };
    let code;
    let upstreamId;
    if (ambiguous || record?.ambiguous) code = "REFERENCE_AMBIGUOUS";
    else if (!record) code = "LOCAL_RECORD_MISSING";
    else {
      upstreamId = ensureIdentity(namespace, registry, record, priority);
      code = upstreamId
        ? "WAITING_UPSTREAM_JOB"
        : "ENTITY_DEFINITION_UNRESOLVED";
    }
    return {
      code,
      key,
      upstreamId,
      localExists: Boolean(record || ambiguous),
      label: record?.label ?? dep.value,
      identity: record?.identity,
    };
  }

  const cycle = db.prepare(`
    WITH RECURSIVE upstream(id) AS (
      SELECT upstream_id FROM backend_sync_dependencies
      WHERE workspace_uuid=? AND operation_id=? AND upstream_id IS NOT NULL
      UNION
      SELECT e.upstream_id FROM backend_sync_dependencies e JOIN upstream u ON u.id=e.operation_id
      WHERE e.workspace_uuid=? AND e.upstream_id IS NOT NULL
    )
    SELECT 1 FROM upstream WHERE id=? LIMIT 1
  `);
  const important = [
    "REFERENCE_AMBIGUOUS",
    "LOCAL_RECORD_MISSING",
    "ENTITY_DEFINITION_UNRESOLVED",
    "SOURCE_AMBIGUOUS",
  ];
  function dependencies(item, intent, registry, record) {
    const namespace = item.workspace_uuid;
    const isIdentity = item.work_kind === "identity";
    const { identity } = intent;
    const parentKey =
      identity.target && identityKey({ localObjectId: identity.localObjectId });
    const localFields = isIdentity
      ? (localFieldKeys(registry, identity) ?? []).map((localKey) => ({
          localKey,
          value: record.values[localKey],
        }))
      : intent.fields;
    const refs = fieldDependencies(registry, identity, localFields).filter(
      ({ type }) => !isIdentity || type !== "source",
    );
    if (!isIdentity)
      refs.unshift({
        type: "reference",
        key: item.identity_key,
        lookup: lookupFor("identity", item.identity_key),
        value: identity.localObjectId,
        structural: true,
      });
    if (parentKey)
      refs.unshift({
        type: "reference",
        key: parentKey,
        lookup: lookupFor("parent", parentKey),
        value: identity.localObjectId,
        structural: true,
      });

    const resolved = {};
    const missing = [];
    const described = new Set();
    clearEdges.run(namespace, item.operation_id);
    for (const dep of refs) {
      let found;
      if (dep.type === "source") {
        const source = sourceBinding(namespace, registry, dep.value);
        found = source.id
          ? source
          : {
              code: source.ambiguous ? "SOURCE_AMBIGUOUS" : "SOURCE_UNRESOLVED",
              label: dep.value,
            };
      } else found = referenceBinding(namespace, registry, dep, item.priority);
      if (found.id) {
        resolved[dep.lookup] = found.id;
        continue;
      }
      addEdge.run(
        namespace,
        item.operation_id,
        dep.lookup,
        found.key ?? null,
        found.upstreamId ?? null,
      );
      if (dep.type === "source") {
        const canonical = sourceLookupKey(dep.value);
        if (canonical !== dep.value)
          addEdge.run(
            namespace,
            item.operation_id,
            lookupFor("source", canonical),
            null,
            null,
          );
      }
      const description = found.key ?? dep.lookup;
      if (!described.has(description)) {
        described.add(description);
        missing.push({
          ...found,
          kind: dep.kind,
          structural: Boolean(dep.structural),
        });
      }
    }
    if (!missing.length) return { resolved, waiting: null, canPreview: true };
    const issue =
      missing.find((entry) => important.includes(entry.code)) ?? missing[0];
    const cyclic =
      missing.some(({ upstreamId }) => upstreamId) &&
      cycle.get(namespace, item.operation_id, namespace, item.operation_id);
    return {
      resolved,
      waiting: {
        code: cyclic ? "DEPENDENCY_CYCLE" : issue.code,
        message: issue.label,
        dependencies: missing,
      },
      canPreview: !missing.some(({ structural }) => structural),
    };
  }

  const readyCondition = `
    o.workspace_uuid=? AND o.identity_key IS NOT NULL AND o.sync_status IN (${ready})
    AND (o.predecessor_id IS NULL OR EXISTS (
      SELECT 1 FROM backend_sync_operations p WHERE p.workspace_uuid=o.workspace_uuid
    AND p.operation_id=o.predecessor_id AND p.sync_status IN ('SYNCED','SUPERSEDED')
    ))
  `;
  const activeLease = db.prepare(`
    SELECT MIN(lease_until) AS deadline FROM backend_sync_operations
    WHERE workspace_uuid=? AND lease_until>0 AND lease_until>?
  `);
  const networkCooldown = db.prepare(`
    SELECT MAX(MIN(due_at, unixepoch(updated_at, 'subsec') * 1000 + 10000)) AS deadline
    FROM backend_sync_operations
    WHERE workspace_uuid=? AND identity_key IS NOT NULL AND sync_status='RETRY_PENDING' AND due_at>?
  `);
  const next = db.prepare(`
    SELECT * FROM backend_sync_operations o WHERE ${readyCondition}
    AND o.due_at<=? AND o.lease_until<=?
    ORDER BY o.priority, o.local_revision, o.rowid LIMIT 1
  `);
  const nextDue = db.prepare(`
    SELECT MIN(MAX(o.due_at,o.lease_until)) AS deadline
    FROM backend_sync_operations o WHERE ${readyCondition}
  `);
  const setLease = db.prepare(`
    UPDATE backend_sync_operations SET lease_id=?, lease_until=?
    WHERE workspace_uuid=? AND operation_id=?
  `);
  const putOutcome = db.prepare(`
    UPDATE backend_sync_operations SET sync_status=?, result_json=?, updated_at=?,
      due_at=?, attempt_count=?, lease_id=NULL, lease_until=0
    WHERE workspace_uuid=? AND operation_id=?
  `);

  function writeOutcome(item, status, result = {}) {
    const attempts = item.sync_status === status ? item.attempt_count + 1 : 1;
    const retry = status === "RETRY_PENDING";
    const delay = Math.min(
      300_000,
      1500 * 2 ** Math.min(attempts, 8) * (0.85 + Math.random() * 0.3),
    );
    putOutcome.run(
      status,
      JSON.stringify(result),
      new Date().toISOString(),
      retry ? Math.round(Date.now() + delay) : 0,
      attempts,
      item.workspace_uuid,
      item.operation_id,
    );
    if (status !== "WAITING_DEPENDENCY" && !result.dependencies)
      clearEdges.run(item.workspace_uuid, item.operation_id);
  }

  const claim = db.transaction(({ origin, manual }) => {
    const row = workspace();
    if (!enabled(row, origin, manual)) return { job: null, retryAt: null };
    const namespace = row.workspace_uuid;
    const now = Date.now();
    const active = activeLease.get(namespace, now).deadline;
    if (active) return { job: null, retryAt: active };
    // A large initial scan should share a cooldown after a connection failure.
    const cooledUntil = networkCooldown.get(namespace, now).deadline;
    if (cooledUntil > now)
      return { job: null, retryAt: Math.ceil(cooledUntil) };
    const registry = decode(row.registry_json);
    for (let checked = 0; checked < 32; checked++) {
      const item = next.get(namespace, now, now);
      if (!item)
        return {
          job: null,
          retryAt: nextDue.get(namespace).deadline,
          progressed: checked > 0,
        };
      const intent = decode(item.payload_json);
      const record = catalog.get(item.identity_key);
      const isIdentity = item.work_kind === "identity";
      if (isIdentity && boundId(namespace, item.identity_key)) {
        writeOutcome(item, "SYNCED");
        continue;
      }
      if (!intent.request) {
        if (
          (!isIdentity || intent.resolution) &&
          intent.schemaRevisionId !== registry.revisionId
        ) {
          writeOutcome(item, "CONFLICT", { code: "SCHEMA_REVISION_CHANGED" });
          continue;
        }
        if (
          !record ||
          record.ambiguous ||
          record.identity.localType !== intent.identity.localType
        ) {
          writeOutcome(item, "BLOCKED", {
            code: !record
              ? "LOCAL_RECORD_MISSING"
              : record.ambiguous
                ? "REFERENCE_AMBIGUOUS"
                : "IDENTITY_TYPE_CONFLICT",
          });
          continue;
        }
        if (!entityFor(registry, intent.identity)) {
          writeOutcome(item, "CONFLICT", {
            code: "ENTITY_DEFINITION_UNRESOLVED",
          });
          continue;
        }
      }
      const plan = intent.request
        ? { resolved: {}, waiting: null, canPreview: true }
        : dependencies(item, intent, registry, record);
      if (plan.waiting && (!isIdentity || !plan.canPreview)) {
        writeOutcome(item, "WAITING_DEPENDENCY", plan.waiting);
        continue;
      }
      const leaseId = randomUUID();
      setLease.run(leaseId, now + leaseMs, namespace, item.operation_id);
      const prior =
        item.predecessor_id &&
        readOperation.get(namespace, item.predecessor_id);
      return {
        retryAt: null,
        job: {
          workspaceUuid: namespace,
          leaseId,
          kind: item.work_kind,
          intent,
          resolved: plan.resolved,
          missing: plan.waiting,
          registry: {
            ...registry,
            entities: [entityFor(registry, intent.identity)].filter(Boolean),
            sources: [],
          },
          confirmed: decode(prior?.result_json)?.confirmed ?? {},
        },
      };
    }
    return { job: null, retryAt: now, progressed: true };
  });

  function leased(scope) {
    const { workspaceUuid, origin, operationId, leaseId } = scope;
    requireWorkspace(workspaceUuid, origin);
    const item = readOperation.get(workspaceUuid, operationId);
    if (
      !item ||
      !item.identity_key ||
      !leaseId ||
      item.lease_id !== leaseId ||
      item.lease_until <= Date.now()
    )
      throw invalid(
        409,
        "The synchronization lease changed. The operation can be retried.",
      );
    return item;
  }

  const storeIntent = db.prepare(`
    UPDATE backend_sync_operations SET payload_json=? WHERE workspace_uuid=? AND operation_id=?
  `);
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
    storeIntent.run(
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
    const namespace = scope.workspaceUuid;
    const row = workspace();
    const intent = decode(item.payload_json);
    if (item.work_kind === "identity") {
      if (result.object && status === "SYNCED") {
        if (
          !result.object.businessObjectId ||
          identityKey(result.object.identity) !== item.identity_key
        )
          throw invalid(409, "The backend returned a different identity.");
        writeBinding(namespace, result.object);
      } else if (boundId(namespace, item.identity_key)) {
        status = "SYNCED";
        result = {};
      } else if (status === "WAITING_DEPENDENCY") {
        // A dependency might have been bound while the remote preview was in flight.
        const record = catalog.get(item.identity_key);
        const current =
          record &&
          dependencies(item, intent, decode(row.registry_json), record);
        status = current?.waiting ? "WAITING_DEPENDENCY" : "QUEUED";
        result = current?.waiting ?? {};
      }
    } else if (status === "SYNCED") {
      const object = result.object;
      if (object?.schemaRevisionId === row.schema_revision_id) {
        const cached = readBinding(namespace, item.identity_key);
        if (cached) {
          // Advance only the fields this Commit approved. Unrelated server edits retain their CAS checks.
          const fields = { ...cached.objectFields };
          for (const { persistentKey } of intent.fields)
            if (persistentKey && object.objectFields[persistentKey])
              fields[persistentKey] = object.objectFields[persistentKey];
          writeBinding(namespace, { ...object, objectFields: fields });
        } else writeBinding(namespace, object);
      }
      if (intent.reviewedHistory) catalog.markValueReviewed(item.identity_key);
    }
    writeOutcome(item, status, result);
  });

  const release = db.transaction((scope) => {
    leased(scope);
    setLease.run(null, 0, scope.workspaceUuid, scope.operationId);
  });

  const retry = db.transaction(({ origin }) => {
    const { workspace_uuid: namespace } = requireWorkspace(
      workspace().workspace_uuid,
      origin,
    );
    db.prepare(
      `
      UPDATE backend_sync_operations SET sync_status='QUEUED', due_at=0, attempt_count=0
      WHERE workspace_uuid=? AND identity_key IS NOT NULL AND lease_until<=?
        AND sync_status IN ('BLOCKED','RETRY_PENDING','WAITING_DEPENDENCY')
    `,
    ).run(namespace, Date.now());
  });

  function describeDependency(namespace, dependency, remaining, seen) {
    const { upstreamId } = dependency;
    const item = upstreamId && readOperation.get(namespace, upstreamId);
    if (!item) return dependency;
    const detail = decode(item.result_json);
    const repeated = seen.has(upstreamId);
    const result = {
      ...dependency,
      upstreamStatus: item.sync_status,
      upstreamCode: detail?.code,
    };
    if (remaining > 0 && !repeated && detail?.dependencies?.length) {
      result.chain = detail.dependencies
        .slice(0, 2)
        .map((child) =>
          describeDependency(
            namespace,
            child,
            remaining - 1,
            new Set([...seen, upstreamId]),
          ),
        );
    }
    return result;
  }

  function issueRow(namespace, item) {
    const intent = decode(item.payload_json);
    const result = decode(item.result_json);
    return {
      id: item.operation_id,
      key: item.identity_key,
      identity: intent.identity,
      label: intent.label,
      status: item.sync_status,
      code: result?.code,
      message: result?.message,
      dependencies: result?.dependencies
        ?.slice(0, 12)
        .map((dep) =>
          describeDependency(namespace, dep, 5, new Set([item.operation_id])),
        ),
    };
  }

  function summary() {
    const row = workspace();
    const namespace = row.workspace_uuid;
    const counts = db
      .prepare(
        `
      SELECT COALESCE(SUM(pending),0) AS pending,
        COALESCE(SUM(NOT pending AND NOT conflict),0) AS synced
      FROM (
        SELECT MAX(sync_status NOT IN ('SYNCED','CONFLICT')) AS pending,
          MAX(sync_status='CONFLICT') AS conflict
        FROM backend_sync_operations WHERE workspace_uuid=? AND identity_key IS NOT NULL
        AND work_kind='commit' AND sync_status<>'SUPERSEDED' GROUP BY identity_key
      )
    `,
      )
      .get(namespace);
    const conflicts = db
      .prepare(
        `
      SELECT COUNT(DISTINCT identity_key) AS total FROM backend_sync_operations
      WHERE workspace_uuid=? AND identity_key IS NOT NULL AND sync_status='CONFLICT'
    `,
      )
      .get(namespace).total;
    const lastSuccess = db
      .prepare(
        `
      SELECT MAX(updated_at) AS time FROM backend_sync_operations WHERE workspace_uuid=?
      AND identity_key IS NOT NULL AND sync_status='SYNCED'
    `,
      )
      .get(namespace).time;
    const issues = db
      .prepare(
        `
      SELECT o.* FROM backend_sync_operations o WHERE workspace_uuid=? AND identity_key IS NOT NULL
      AND sync_status IN (${problems})
      ORDER BY updated_at DESC, rowid DESC LIMIT 12
    `,
      )
      .all(namespace)
      .map((item) => issueRow(namespace, item));
    const reconciliation = db
      .prepare(
        `
      SELECT COUNT(*) AS found, COUNT(*) FILTER(WHERE r.scanned<>0) AS scanned,
        COUNT(*) FILTER(WHERE r.scanned=2) AS alreadyBound,
        COUNT(*) FILTER(WHERE o.sync_status IN ('QUEUED','RETRY_PENDING','WAITING_DEPENDENCY')) AS queued,
        COUNT(*) FILTER(WHERE ${identityReview}) AS identityReview,
        COUNT(*) FILTER(WHERE ${valueReview}) AS valueReview,
        COUNT(*) FILTER(WHERE b.business_object_id IS NOT NULL) AS bound,
        COUNT(*) FILTER(WHERE r.scanned>0 AND NOT r.needs_value_review AND b.business_object_id IS NOT NULL) AS completed
      ${reviewTables}
    `,
      )
      .get(namespace, namespace);
    return {
      mode: row.continuous_mode == null ? null : row.continuous_mode === 1,
      linked: Boolean(row.registry_json),
      ...counts,
      conflicts,
      lastSuccess,
      running: Boolean(activeLease.get(namespace, Date.now()).deadline),
      problems: issues,
      reconciliation,
    };
  }

  const reviewTables = `
    FROM backend_sync_records r
    LEFT JOIN backend_object_bindings b ON b.workspace_uuid=? AND b.identity_key=r.identity_key
    LEFT JOIN backend_sync_operations o ON o.workspace_uuid=? AND o.identity_key=r.identity_key
      AND o.work_kind='identity'
  `;
  const identityReview = `
    b.business_object_id IS NULL AND (
    (o.sync_status='WAITING_DEPENDENCY' AND json_extract(o.result_json,'$.code')='DEPENDENCY_CYCLE')
    OR (o.sync_status IN ('BLOCKED','CONFLICT') AND json_extract(o.result_json,'$.code') IN (
      'IDENTITY_REVIEW_REQUIRED','EXPLICIT_LEGACY_MATCH_REQUIRED','CREATE_PERMISSION_REQUIRED',
      'BIND_PERMISSION_REQUIRED','SCHEMA_REVISION_CHANGED','OBJECT_BINDING_CHANGED'
    )))
  `;
  const valueReview = `
    r.scanned>0 AND NOT r.ambiguous AND b.business_object_id IS NOT NULL AND (
      r.needs_value_review=1 OR EXISTS (
        SELECT 1 FROM backend_sync_operations c WHERE c.workspace_uuid=b.workspace_uuid
          AND c.identity_key=r.identity_key AND c.work_kind='commit' AND c.sync_status='CONFLICT'
      )
    )
  `;
  const unfinishedCommits = db.prepare(`
    SELECT * FROM backend_sync_operations WHERE workspace_uuid=? AND identity_key=?
      AND work_kind='commit' AND sync_status NOT IN ('SYNCED','SUPERSEDED')
    ORDER BY local_revision, rowid
  `);

  function canReviewCommits(rows) {
    if (!rows.length) return true;
    const [first, ...following] = rows;
    return (
      first.sync_status === "CONFLICT" &&
      reviewableConflicts.has(decode(first.result_json)?.code) &&
      !rows.some(({ lease_until }) => lease_until > Date.now()) &&
      following.every(
        (item) =>
          item.sync_status === "QUEUED" && !decode(item.payload_json).request,
      )
    );
  }

  function review({ origin, kind, after = "" }) {
    const row = requireWorkspace(workspace().workspace_uuid, origin);
    if (!["identity", "value"].includes(kind) || typeof after !== "string")
      throw invalid(422, "Choose an identity or value review.");
    const namespace = row.workspace_uuid;
    const entries = db
      .prepare(
        `
      SELECT r.identity_key, o.result_json ${reviewTables}
      WHERE r.identity_key>? AND (${kind === "identity" ? identityReview : valueReview})
      ORDER BY r.identity_key LIMIT ?
    `,
      )
      .all(namespace, namespace, after, reviewLimit + 1);
    return {
      permissions: decode(row.registry_json).permissions,
      items: entries.slice(0, reviewLimit).map((entry) => {
        const { key, identity, label } = catalog.get(entry.identity_key);
        const commits =
          kind === "value" ? unfinishedCommits.all(namespace, key) : [];
        return {
          key,
          identity,
          label,
          code: decode(entry.result_json)?.code,
          pending: !canReviewCommits(commits),
          conflictReview: commits.length > 0 && canReviewCommits(commits),
        };
      }),
      next:
        entries.length > reviewLimit
          ? entries[reviewLimit - 1].identity_key
          : null,
    };
  }

  function verifyBatch(entries) {
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.length > reviewLimit
    )
      throw invalid(422, `Choose up to ${reviewLimit} records to review.`);
  }

  const approveIdentities = db.transaction(({ origin, entries }) => {
    verifyBatch(entries);
    const row = requireWorkspace(workspace().workspace_uuid, origin);
    const registry = decode(row.registry_json);
    for (const { key, existingBusinessObjectId } of entries) {
      const item = identityWork.get(row.workspace_uuid, key);
      const record = catalog.get(key);
      const cycleReview =
        item?.sync_status === "WAITING_DEPENDENCY" &&
        decode(item.result_json)?.code === "DEPENDENCY_CYCLE";
      if (
        !item ||
        (!["BLOCKED", "CONFLICT"].includes(item.sync_status) && !cycleReview) ||
        !record ||
        record.ambiguous
      )
        throw invalid(409, "Refresh the identity review and try again.");
      const bind = existingBusinessObjectId !== undefined;
      if (
        (bind &&
          (!registry.permissions.bindExisting ||
            !/^[1-9]\d{0,18}$/.test(existingBusinessObjectId))) ||
        (!bind && !registry.permissions.create)
      )
        throw invalid(
          422,
          "Choose an allowed identity action and valid server ID.",
        );
      const intent = decode(item.payload_json);
      storeIntent.run(
        JSON.stringify({
          ...intent,
          schemaRevisionId: registry.revisionId,
          resolution: bind
            ? { action: "bind", existingBusinessObjectId }
            : { action: "create" },
        }),
        row.workspace_uuid,
        item.operation_id,
      );
      writeOutcome(item, "QUEUED");
    }
  });

  const approveValues = db.transaction(
    ({
      origin,
      workspaceUuid,
      expectedRevision,
      schemaRevisionId,
      keys,
      preview,
      compared = {},
    }) => {
      verifyBatch(keys);
      const row = requireWorkspace(workspaceUuid, origin);
      if (
        workspaceRevision.get()?.revision !== expectedRevision ||
        row.schema_revision_id !== schemaRevisionId
      )
        throw invalid(
          409,
          "The local workspace or backend schema changed. Compare the values again.",
        );
      const entry = decode(row.registry_json);
      if (!entry.permissions.commit)
        throw invalid(403, "This workspace cannot accept approved values.");
      const changes = new Map(
        (preview?.request?.changes ?? []).map((change) => [
          identityKey(change.identity),
          change,
        ]),
      );
      const skipped = new Set(
        (preview?.skipped ?? []).map((item) => identityKey(item.identity)),
      );
      for (const key of new Set(keys)) {
        const binding = readBinding(workspaceUuid, key);
        const record = catalog.get(key);
        const commits = unfinishedCommits.all(workspaceUuid, key);
        if (
          !record ||
          record.ambiguous ||
          !binding ||
          binding.schemaRevisionId !== schemaRevisionId ||
          !canReviewCommits(commits)
        )
          throw invalid(
            409,
            "A selected record has pending work or a changed binding. Compare the values again.",
          );
        const change = changes.get(key);
        const operationId = change ? randomUUID() : null;
        const fieldsReviewed = new Set(compared[key] ?? []);
        for (const item of commits) {
          if (
            decode(item.payload_json).fields.some(
              ({ persistentKey }) => !fieldsReviewed.has(persistentKey),
            )
          )
            throw invalid(
              409,
              "Some pending fields could not be compared. Resolve the skipped field mappings first.",
            );
          writeOutcome(item, "SUPERSEDED", {
            code: "REPLACED_BY_REVIEW",
            operationId,
          });
        }
        if (!change) {
          if (!skipped.has(key)) catalog.markValueReviewed(key);
          continue;
        }
        if (change.businessObjectId !== binding.businessObjectId)
          throw invalid(409, "A selected record has a changed binding.");
        const anchors = {};
        for (const field of change.fields) {
          const slot = binding.objectFields[field.persistentKey];
          if (
            !slot ||
            slot.businessObjectFieldId !== field.businessObjectFieldId ||
            slot.fieldVersionId !== field.fieldVersionId ||
            slot.valueId !== field.expectedValueId ||
            (field.expectedCollectionRevision !== undefined &&
              (slot.collectionRevision ?? 0) !==
                field.expectedCollectionRevision)
          )
            throw invalid(
              409,
              "A backend field changed during review. Compare the values again.",
            );
          anchors[field.persistentKey] = slot;
        }
        addOperation(workspaceUuid, key, {
          identity: record.identity,
          label: record.label,
          canCreate: false,
          operationId,
          localRevision: expectedRevision,
          schemaRevisionId,
          boundObjectId: binding.businessObjectId,
          reviewedHistory: !skipped.has(key),
          fields: change.fields.map(({ persistentKey }) => ({ persistentKey })),
          heads: anchors,
          anchors,
          request: {
            workspaceUuid,
            operationId,
            schemaRevisionId,
            changes: [change],
          },
        });
      }
    },
  );

  return {
    enqueue,
    claim,
    configure,
    scan,
    prepare,
    finish,
    release,
    retry,
    summary,
    review,
    approveIdentities,
    approveValues,
    indexCommitted,
    migrate,
    bindingChanged,
    registryChanged,
    sourcesChanged,
  };
}
