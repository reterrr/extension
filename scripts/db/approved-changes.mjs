import {
  entityFor,
  fieldFor,
  identityKey,
  localFieldKeys,
  localRecords,
  same,
} from "../../src/shared/backend-sync/records.js";

function referenceValues(type, value) {
  if (value == null || value === "") return [];
  if (type?.type === "list" && Array.isArray(value))
    return value.flatMap((item) => referenceValues(type.item, item));
  return type?.type === "reference" || type?.type === "source"
    ? [{ type: type.type, value }]
    : [];
}

export function fieldDependencies(registry, identity, fields) {
  const dependencies = new Map();
  for (const { localKey, value } of fields) {
    const field = fieldFor(registry, identity, localKey);
    if (!field || field.readonly || field.definition.system) continue;
    for (const ref of referenceValues(field.definition, value)) {
      if (typeof ref.value !== "string") continue;
      const kind = ref.type === "source" ? "source" : field.references;
      if (!kind) continue;
      const lookup = JSON.stringify([kind, ref.value]);
      dependencies.set(lookup, { ...ref, kind, lookup });
    }
  }
  return [...dependencies.values()];
}

export function approvedChanges(before, after, registry, reviewed) {
  const old = new Map(
    localRecords(before ?? { objects: [] }).map((record) => [
      identityKey(record.identity),
      record,
    ]),
  );
  const records = localRecords(after);
  const parents = new Map(
    records
      .filter(({ identity }) => !identity.target)
      .map(({ identity, label }) => [identity.localObjectId, label]),
  );
  const changes = [];
  for (const { identity, label, values, imported } of records) {
    if (reviewed && !reviewed.has(identity.localObjectId)) continue;
    const key = identityKey(identity);
    const previous = old.get(key);
    const existing = previous?.values ?? {};
    const localKeys = localFieldKeys(registry, identity) ?? [
      ...new Set([...Object.keys(existing), ...Object.keys(values)]),
    ];
    const fields = [];
    for (const localKey of new Set(localKeys)) {
      const value = values[localKey] ?? null;
      if (same(value, existing[localKey])) continue;
      const field = fieldFor(registry, identity, localKey);
      if (field?.readonly || field?.definition.system) continue;
      fields.push({
        localKey,
        persistentKey: field?.persistentKey ?? null,
        value,
      });
    }
    const canCreate =
      !previous &&
      !imported &&
      identity.localType !== "nabor" &&
      Boolean(entityFor(registry, identity));
    if (!fields.length && !canCreate) continue;
    changes.push({
      key,
      newRecord: !previous,
      identity,
      label: identity.target
        ? `${parents.get(identity.localObjectId)} · ${label}`
        : label,
      canCreate,
      fields,
    });
  }
  return changes;
}
