export const identityKey = ({ localObjectId, target }) =>
  JSON.stringify([localObjectId, target?.kind ?? null, target?.id ?? null]);

export function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function sourceLookupKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

export function recordKind(registry, identity) {
  return (
    identity.target?.kind ??
    registry.aliases[identity.localType]?.entity ??
    identity.localType
  );
}

export function entityFor(registry, identity) {
  return registry.entities.find(
    (entity) => entity.localType === recordKind(registry, identity),
  );
}

export function localFieldKeys(registry, identity) {
  const alias = !identity.target && registry.aliases[identity.localType];
  const entity = entityFor(registry, identity);
  if (alias) return Object.keys(alias.fields);
  return (
    entity && [
      ...entity.fields.map((field) => field.localKey),
      ...(entity.unavailableLocalKeys ?? []),
    ]
  );
}

export function fieldFor(registry, identity, localKey) {
  const alias =
    !identity.target && registry.aliases[identity.localType]?.fields[localKey];
  return entityFor(registry, identity)?.fields.find(
    (field) => field.localKey === (alias || localKey),
  );
}

const nested = {
  operator_assignment: "operatorAssignments",
  operator_contact: "operatorContacts",
  geography: "geographies",
  funding: "financingRules",
  service_category: "serviceCategories",
  file_source: "fileSources",
  document: "documentRequirements",
};

// The local Add Document action assigns this portable key at creation time.
export const localDocumentKey = (id) =>
  `DOC_${id.replaceAll("-", "").slice(0, 16)}`;

export function localRecords(state) {
  const records = [];
  const roots = new Map(state.objects.map((obj) => [obj.id, obj]));
  const sources = new Map();
  for (const source of state.importSources ?? []) {
    if (source.importKey)
      sources.set(
        source.importKey,
        sources.has(source.importKey)
          ? null
          : JSON.stringify(["import", source.id]),
      );
  }
  for (const obj of state.objects)
    records.push({
      identity: { localObjectId: obj.id, localType: obj.type },
      label:
        obj.label ??
        String(
          obj.values.name ??
            obj.values.external_number ??
            obj.values.title ??
            obj.id,
        ),
      values: obj.values,
      imported: Boolean(obj.importKey),
    });
  for (const [kind, collection] of Object.entries(nested)) {
    for (const row of state[collection] ?? []) {
      const parent = roots.get(String(row.objectId));
      if (!parent || typeof row.id !== "string" || !row.id) continue;
      const type = parent.type === "nabor" ? "recruitment" : parent.type;
      const values = { ...row, [type + "_owner"]: parent.id };
      const localDocument =
        kind === "document" && row.importKey === localDocumentKey(row.id);
      if (
        kind === "file_source" &&
        values.source == null &&
        typeof values.sourceImportKey === "string"
      )
        values.source =
          sources.get(values.sourceImportKey) ?? values.sourceImportKey;
      records.push({
        identity: {
          localObjectId: parent.id,
          localType: parent.type,
          target: { kind, id: row.id },
        },
        label: String(
          row.label ??
            row.display_name ??
            row.name ??
            row.value ??
            row.company_size ??
            row.id,
        ),
        values,
        imported: Boolean(
          (row.importKey && !localDocument) || row.sourceImportKey,
        ),
      });
    }
  }
  return records;
}
