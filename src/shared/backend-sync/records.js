export const identityKey = ({ localObjectId, target }) =>
  JSON.stringify([localObjectId, target?.kind ?? null, target?.id ?? null]);

export function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function entityFor(registry, identity) {
  const kind =
    identity.target?.kind ??
    registry.aliases[identity.localType]?.entity ??
    identity.localType;
  return registry.entities.find((entity) => entity.localType === kind);
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

export function localRecords(state) {
  const records = [];
  const roots = new Map(state.objects.map((obj) => [obj.id, obj]));
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
    });
  for (const [kind, collection] of Object.entries(nested)) {
    for (const row of state[collection] ?? []) {
      const parent = roots.get(String(row.objectId));
      if (!parent || typeof row.id !== "string" || !row.id) continue;
      const type = parent.type === "nabor" ? "recruitment" : parent.type;
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
        values: { ...row, [type + "_owner"]: parent.id },
      });
    }
  }
  return records;
}
