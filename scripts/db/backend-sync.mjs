import { randomUUID } from "node:crypto";

export const identityKey = ({ localObjectId, target }) =>
  JSON.stringify([localObjectId, target?.kind ?? null, target?.id ?? null]);

export class LocalSyncError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function id(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new LocalSyncError(
      422,
      "Server identity must be a decimal BIGINT string.",
    );
  return value;
}

function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new LocalSyncError(422, "Invalid workspace or operation UUID.");
  return value;
}

export function createBackendSyncStore(db) {
  const now = () => new Date().toISOString();
  const initialize = db.prepare(
    "INSERT OR IGNORE INTO backend_workspace_identity(id, workspace_uuid, created_at) VALUES (1, ?, ?)",
  );
  if (!db.prepare("SELECT 1 FROM backend_workspace_identity WHERE id=1").get())
    initialize.run(randomUUID(), now());
  const workspace = () =>
    db.prepare("SELECT * FROM backend_workspace_identity WHERE id=1").get();
  const requireWorkspace = (workspaceUuid, origin) => {
    const row = workspace();
    if (
      row.workspace_uuid !== workspaceUuid ||
      !row.backend_origin ||
      (origin && row.backend_origin !== origin)
    )
      throw new LocalSyncError(
        409,
        "Backend workspace connection has changed.",
      );
    return row;
  };
  const json = (value) => JSON.stringify(value);
  const parse = (value) => (value == null ? null : JSON.parse(value));
  const registry = db.transaction(({ origin, registry: incoming }) => {
    const row = workspace();
    const namespace = uuid(incoming.workspaceUuid);
    const model = id(incoming.businessModelId);
    const revision = id(incoming.revisionId);
    if (
      row.backend_origin &&
      (row.backend_origin !== origin ||
        row.workspace_uuid !== namespace ||
        row.business_model_id !== model)
    )
      throw new LocalSyncError(
        409,
        "This SQLite workspace is already linked to another backend namespace.",
      );
    if (
      row.schema_revision_id &&
      BigInt(revision) < BigInt(row.schema_revision_id)
    )
      throw new LocalSyncError(
        409,
        "Received an older server schema revision.",
      );
    db.prepare(
      `UPDATE backend_workspace_identity SET workspace_uuid=?, backend_origin=?,
        business_model_id=?, schema_revision_id=?, registry_json=?, last_synced_at=? WHERE id=1`,
    ).run(namespace, origin, model, revision, json(incoming), now());
    db.prepare("DELETE FROM backend_field_bindings WHERE workspace_uuid=?").run(
      namespace,
    );
    const insert = db.prepare(
      "INSERT INTO backend_field_bindings VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const entity of incoming.entities)
      for (const field of entity.fields)
        insert.run(
          namespace,
          id(entity.businessEntityId),
          field.persistentKey,
          id(field.businessEntityFieldId),
          id(field.fieldVersionId),
          revision,
        );
  });

  function writeBinding(namespace, object) {
    const row = requireWorkspace(namespace);
    if (object.businessModelId !== row.business_model_id)
      throw new LocalSyncError(
        409,
        "Object belongs to another business model.",
      );
    if (object.schemaRevisionId !== row.schema_revision_id)
      throw new LocalSyncError(
        409,
        "Refresh the schema before caching this binding.",
      );
    const { identity, objectFields, ...summary } = object;
    const key = identityKey(identity);
    const previous = db
      .prepare(
        "SELECT business_object_id FROM backend_object_bindings WHERE workspace_uuid=? AND identity_key=?",
      )
      .get(namespace, key);
    if (
      previous?.business_object_id &&
      previous.business_object_id !== object.businessObjectId
    )
      throw new LocalSyncError(
        409,
        "An existing local identity cannot be rebound.",
      );
    const objectId =
      object.businessObjectId == null ? null : id(object.businessObjectId);
    db.prepare(
      `INSERT INTO backend_object_bindings VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_uuid, identity_key) DO UPDATE SET
       business_entity_id=excluded.business_entity_id, business_object_id=excluded.business_object_id,
       sync_status=excluded.sync_status, binding_json=excluded.binding_json,
       last_synced_at=excluded.last_synced_at`,
    ).run(
      namespace,
      key,
      identity.localObjectId,
      id(object.businessEntityId),
      objectId,
      object.status,
      json({ identity, ...summary }),
      now(),
    );
    const stale = db.prepare(
      "SELECT persistent_key, slot_json FROM backend_object_field_bindings WHERE workspace_uuid=? AND identity_key=?",
    );
    const oldSlots = new Map(
      stale
        .all(namespace, key)
        .map((slot) => [slot.persistent_key, parse(slot.slot_json)]),
    );
    db.prepare(
      "DELETE FROM backend_object_field_bindings WHERE workspace_uuid=? AND identity_key=?",
    ).run(namespace, key);
    const putSlot = db.prepare(
      "INSERT INTO backend_object_field_bindings VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const [persistentKey, field] of Object.entries(objectFields)) {
      const oldSlot = oldSlots.get(persistentKey);
      const olderValue =
        oldSlot?.valueId &&
        (!field.valueId ||
          BigInt(oldSlot.valueId) > BigInt(field.valueId) ||
          ((oldSlot.collectionRevision ?? 0) >
            (field.collectionRevision ?? 0) &&
            oldSlot.valueId === field.valueId));
      const value =
        olderValue && oldSlot.fieldVersionId === field.fieldVersionId
          ? oldSlot
          : field;
      putSlot.run(
        namespace,
        key,
        persistentKey,
        id(value.businessEntityFieldId),
        id(value.businessObjectFieldId),
        json(value),
      );
    }
  }

  const binding = db.transaction(({ workspaceUuid, object }) =>
    writeBinding(workspaceUuid, object),
  );
  const selector = db.transaction(({ workspaceUuid, selector: value }) => {
    requireWorkspace(workspaceUuid);
    db.prepare(
      `INSERT INTO backend_selector_bindings VALUES (?, ?, ?)
       ON CONFLICT(workspace_uuid, selector_uuid) DO UPDATE SET binding_json=excluded.binding_json`,
    ).run(workspaceUuid, uuid(value.selectorUuid), json(value));
  });

  function enqueue(op) {
    requireWorkspace(op.workspaceUuid);
    const time = now();
    db.prepare(
      "INSERT INTO backend_sync_operations VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
    ).run(
      op.workspaceUuid,
      uuid(op.operationId),
      op.localRevision ?? null,
      op.request ? "PENDING" : "LOCAL_ONLY",
      json(op),
      time,
      time,
    );
  }

  const finish = db.transaction(
    ({ workspaceUuid, operationId, status, result }) => {
      const row = requireWorkspace(workspaceUuid);
      if (!["SYNCED", "CONFLICT", "SYNC_ERROR"].includes(status))
        throw new LocalSyncError(422, "Invalid sync operation status.");
      const op = db
        .prepare(
          "SELECT * FROM backend_sync_operations WHERE workspace_uuid=? AND operation_id=?",
        )
        .get(workspaceUuid, uuid(operationId));
      if (!op) throw new LocalSyncError(404, "Unknown sync operation.");
      if (op.sync_status === "SYNCED") return;
      if (status === "SYNCED")
        for (const object of result.objects ?? [])
          if (object.schemaRevisionId === row.schema_revision_id)
            writeBinding(workspaceUuid, object);
      db.prepare(
        `UPDATE backend_sync_operations SET sync_status=?, result_json=?, updated_at=?
       WHERE workspace_uuid=? AND operation_id=?`,
      ).run(status, json(result), now(), workspaceUuid, operationId);
    },
  );

  function read() {
    const row = workspace();
    const namespace = row.workspace_uuid;
    const slots = new Map();
    for (const field of db
      .prepare(
        "SELECT * FROM backend_object_field_bindings WHERE workspace_uuid=?",
      )
      .all(namespace)) {
      if (!slots.has(field.identity_key)) slots.set(field.identity_key, []);
      slots
        .get(field.identity_key)
        .push([field.persistent_key, parse(field.slot_json)]);
    }
    return {
      workspaceUuid: namespace,
      backendOrigin: row.backend_origin,
      registry: parse(row.registry_json),
      bindings: db
        .prepare("SELECT * FROM backend_object_bindings WHERE workspace_uuid=?")
        .all(namespace)
        .map((item) => ({
          ...parse(item.binding_json),
          objectFields: Object.fromEntries(slots.get(item.identity_key) ?? []),
        })),
      selectors: db
        .prepare(
          "SELECT binding_json FROM backend_selector_bindings WHERE workspace_uuid=?",
        )
        .all(namespace)
        .map((item) => parse(item.binding_json)),
      operations: db
        .prepare(
          `SELECT * FROM backend_sync_operations WHERE workspace_uuid=?
        ORDER BY rowid DESC`,
        )
        .all(namespace)
        .map((item) => ({
          ...parse(item.payload_json),
          status: item.sync_status,
          result: parse(item.result_json),
        })),
    };
  }
  const reset = () => {
    for (const table of [
      "backend_sync_operations",
      "backend_selector_bindings",
      "backend_object_bindings",
      "backend_field_bindings",
      "backend_workspace_identity",
    ])
      db.exec("DELETE FROM " + table);
    initialize.run(randomUUID(), now());
  };
  return { read, registry, binding, selector, enqueue, finish, reset };
}
