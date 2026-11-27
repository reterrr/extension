import {
  identityKey,
  localRecords,
  recordKind,
} from "../../src/shared/backend-sync/records.js";

function decodeRecord(row) {
  if (!row) return null;
  return {
    key: row.identity_key,
    identity: {
      localObjectId: row.local_object_id,
      localType: row.local_type,
      ...(row.target_kind && {
        target: { kind: row.target_kind, id: row.target_id },
      }),
    },
    label: row.label,
    values: JSON.parse(row.values_json),
    imported: Boolean(row.imported),
    ambiguous: Boolean(row.ambiguous),
  };
}

export function createReconciliationRecords(db) {
  const put = db.prepare(`
    INSERT INTO backend_sync_records
      (identity_key, local_object_id, local_type, target_kind, target_id, label,
       values_json, imported, ambiguous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(identity_key) DO UPDATE SET local_type=excluded.local_type,
      label=excluded.label, values_json=excluded.values_json, imported=excluded.imported,
      ambiguous=excluded.ambiguous
    WHERE local_type IS NOT excluded.local_type OR label IS NOT excluded.label
      OR values_json IS NOT excluded.values_json OR imported IS NOT excluded.imported
      OR ambiguous IS NOT excluded.ambiguous
  `);
  const keys = db.prepare(
    "SELECT identity_key, local_type, local_object_id, target_kind, target_id FROM backend_sync_records",
  );
  const remove = db.prepare(
    "DELETE FROM backend_sync_records WHERE identity_key=?",
  );
  const find = db.prepare(
    "SELECT * FROM backend_sync_records WHERE identity_key=?",
  );
  const nested = db.prepare(`
    SELECT * FROM backend_sync_records WHERE target_kind=? AND target_id=? LIMIT 2
  `);
  const pending = db.prepare(`
    SELECT * FROM backend_sync_records WHERE scanned=0 ORDER BY identity_key LIMIT ?
  `);
  const scanItem = db.prepare(`
    UPDATE backend_sync_records SET scanned=? WHERE identity_key=?
  `);
  const valueReviewed = db.prepare(`
    UPDATE backend_sync_records SET needs_value_review=0 WHERE identity_key=?
  `);

  function index(state, changed) {
    const entries = new Map();
    for (const record of localRecords(state)) {
      const key = identityKey(record.identity);
      if (entries.has(key)) entries.get(key).ambiguous = true;
      else entries.set(key, record);
    }
    for (const row of keys.all()) {
      if (entries.has(row.identity_key)) continue;
      remove.run(row.identity_key);
      changed(
        row.identity_key,
        row.local_type,
        row.target_kind,
        row.target_id ?? row.local_object_id,
      );
    }
    for (const [
      key,
      { identity, label, values, imported, ambiguous },
    ] of entries) {
      const { localObjectId, localType, target } = identity;
      const result = put.run(
        key,
        localObjectId,
        localType,
        target?.kind ?? null,
        target?.id ?? null,
        label,
        JSON.stringify(values),
        Number(imported),
        Number(Boolean(ambiguous)),
      );
      if (result.changes)
        changed(key, localType, target?.kind, target?.id ?? localObjectId);
    }
  }

  function reference(registry, kind, value) {
    const root = decodeRecord(find.get(identityKey({ localObjectId: value })));
    const matches = nested.all(kind, value).map(decodeRecord);
    if (root && recordKind(registry, root.identity) === kind)
      matches.push(root);
    const [record] = matches;
    if (matches.length > 1 || record?.ambiguous) return { ambiguous: true };
    return { record };
  }

  return {
    index,
    reference,
    get: (key) => decodeRecord(find.get(key)),
    pending: (limit) => pending.all(limit).map(decodeRecord),
    markScanned: (key, status) => scanItem.run(status, key),
    markValueReviewed: (key) => valueReviewed.run(key),
  };
}
