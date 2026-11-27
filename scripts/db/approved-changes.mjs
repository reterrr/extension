import {
  entityFor,
  fieldFor,
  identityKey,
  localRecords,
  same,
} from "../../src/shared/backend-sync/records.js";

const roots = new Set(["operator", "project", "recruitment", "nabor"]);

function referenceKey(kind, id) {
  return JSON.stringify([kind, id]);
}

function referenceValues(type, value) {
  if (value == null || value === "") return [];
  if (type?.type === "list" && Array.isArray(value))
    return value.flatMap((item) => referenceValues(type.item, item));
  return type?.type === "reference" || type?.type === "source"
    ? [{ type: type.type, value }]
    : [];
}

export function approvedChanges(before, after, registry, reviewed) {
  const old = new Map(
    localRecords(before ?? { objects: [] }).map((record) => [
      identityKey(record.identity),
      record,
    ]),
  );
  const records = localRecords(after);
  const byKey = new Map(
    records.map((record) => [identityKey(record.identity), record]),
  );
  const imports = new Map();
  for (const source of after.importSources ?? []) {
    const key = source.importKey;
    if (key)
      imports.set(
        key,
        imports.has(key) ? null : JSON.stringify(["import", source.id]),
      );
  }
  const references = new Map();
  for (const record of records) {
    const { identity } = record;
    const key = referenceKey(
      identity.target?.kind ??
        registry.aliases[identity.localType]?.entity ??
        identity.localType,
      identity.target?.id ?? identity.localObjectId,
    );
    references.set(key, references.has(key) ? null : record);
  }
  const imported = new Set(
    after.objects
      .filter((object) => object.importKey)
      .map((object) => object.id),
  );

  function fieldValue(values, identity, key) {
    if (
      key === "source" &&
      identity.target?.kind === "file_source" &&
      values.source == null &&
      typeof values.sourceImportKey === "string"
    )
      return imports.get(values.sourceImportKey) ?? values.sourceImportKey;
    return values[key] ?? null;
  }

  const changes = [];
  for (const { identity, label, values } of records) {
    if (!roots.has(identity.localType)) continue;
    if (reviewed && !reviewed.has(identity.localObjectId)) continue;
    const key = identityKey(identity);
    const previous = old.get(key);
    const existing = previous?.values ?? {};
    const entity = entityFor(registry, identity);
    const alias = !identity.target && registry.aliases[identity.localType];
    const localKeys = alias
      ? Object.keys(alias.fields)
      : entity
        ? [
            ...entity.fields.map((field) => field.localKey),
            ...(entity.unavailableLocalKeys ?? []),
          ]
        : [...new Set([...Object.keys(existing), ...Object.keys(values)])];
    const fields = [];
    const dependencies = new Map();
    for (const localKey of new Set(localKeys)) {
      const value = fieldValue(values, identity, localKey);
      if (same(value, fieldValue(existing, identity, localKey))) continue;
      const field = fieldFor(registry, identity, localKey);
      if (field?.readonly || field?.definition.system) continue;
      fields.push({
        localKey,
        persistentKey: field?.persistentKey ?? null,
        value,
      });
      for (const ref of referenceValues(field?.definition, value)) {
        if (typeof ref.value !== "string") continue;
        if (ref.type === "source") {
          const lookup = referenceKey("source", ref.value);
          dependencies.set(lookup, {
            type: "source",
            lookup,
            value: ref.value,
          });
          continue;
        }
        const lookup = referenceKey(field.references, ref.value);
        const record = references.get(lookup);
        dependencies.set(lookup, {
          type: "reference",
          lookup,
          key: record ? identityKey(record.identity) : null,
          label: record?.label ?? null,
          ambiguous: references.has(lookup) && !record,
        });
      }
    }
    const canCreate =
      !previous &&
      (identity.target ||
        (identity.localType !== "nabor" &&
          !imported.has(identity.localObjectId)));
    if (!fields.length && !canCreate) continue;
    const parent =
      identity.target && identityKey({ localObjectId: identity.localObjectId });
    if (parent) {
      const lookup = referenceKey("parent", parent);
      dependencies.set(lookup, {
        type: "reference",
        lookup,
        key: parent,
        label: byKey.get(parent)?.label ?? null,
      });
    }
    changes.push({
      key,
      identity,
      label: parent
        ? `${byKey.get(parent)?.label ?? identity.localObjectId} · ${label}`
        : label,
      canCreate: Boolean(canCreate),
      fields,
      dependencies: [...dependencies.values()],
    });
  }
  return changes;
}
