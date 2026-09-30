import { createPortableExport } from "../export/portableExport.js";

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
};

/** Read old exports, but always write the portable v1 shape. */
export function normalizePortableInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  // Former full-workspace JSON backups: import business data, never executable rules.
  if (
    input.version === 1 &&
    typeof input.revision === "number" &&
    Array.isArray(input.rules) &&
    Array.isArray(input.objects)
  )
    return createPortableExport({ state: input });
  if (input.format !== "burbot-ai-view") return input;
  if (input.version !== 1 || !Array.isArray(input.objects))
    throw new Error("Nieobsługiwana wersja eksportu burbot-ai-view.");
  const rawById = new Map();
  const add = (raw) => {
    if (!raw || typeof raw !== "object" || !raw.id || !raw.values)
      throw new Error("Niekompletny obiekt w starszym eksporcie AI.");
    const { recruitments, links, geography_by_operator, ...business } = raw;
    const id = String(raw.id),
      existing = rawById.get(id);
    if (
      existing &&
      JSON.stringify(stable(existing)) !== JSON.stringify(stable(business))
    )
      throw new Error(
        `Sprzeczne kopie obiektu ${id} w eksporcie AI. Uzgodnij je przed importem.`,
      );
    rawById.set(id, business);
    for (const recruitment of recruitments ?? []) add(recruitment);
  };
  for (const raw of input.objects) add(raw);
  const state = {
    version: 1,
    revision: 0,
    objects: [],
    rules: [],
    operatorAssignments: [],
    geographies: [],
    operatorContacts: [],
    fileSources: [],
    financingRules: [],
    documentRequirements: [],
  };
  const byId = new Map();
  for (const [id, raw] of rawById) {
    const object = {
      id,
      importKey: raw.key || id,
      type: raw.type === "nabor" ? "recruitment" : raw.type,
      values: { ...raw.values },
      ...(raw.source_url ? { sourceUrl: raw.source_url } : {}),
    };
    state.objects.push(object);
    byId.set(id, object);
  }
  const reference = (value, type) => {
    const id = typeof value === "string" ? value : (value?.id ?? value?.key);
    if (!id)
      throw new Error("Starszy eksport zawiera relację bez identyfikatora.");
    if (!byId.has(String(id))) {
      if (
        typeof value?.name !== "string" ||
        !value.name ||
        !["operator", "project"].includes(type)
      )
        throw new Error(
          `Brak danych powiązanego obiektu ${id}. Wyeksportuj go razem z zestawem.`,
        );
      const object = {
        id: String(id),
        importKey: value.key || String(id),
        type,
        values: { name: value.name },
      };
      state.objects.push(object);
      byId.set(String(id), object);
    }
    return String(id);
  };
  for (const [id, raw] of rawById) {
    const object = byId.get(id);
    for (const [field, value] of Object.entries(object.values)) {
      const targetType =
        globalThis.BurbotSchema?.[object.type]?.fields?.[field]?.references ??
        (field === "project_id"
          ? "project"
          : field === "operator_id"
            ? "operator"
            : undefined);
      if (targetType && value)
        object.values[field] = reference(value, targetType);
    }
    for (const [index, row] of (raw.operators ?? []).entries())
      state.operatorAssignments.push({
        id: `${id}:operator:${index + 1}`,
        objectId: id,
        importKey: row.key,
        operatorId: reference(row.operator, "operator"),
        operatorType: row.role,
      });
    for (const [index, row] of (raw.geography ?? []).entries())
      state.geographies.push({
        id: `${id}:geography:${index + 1}`,
        objectId: id,
        importKey: row.key,
        type: row.type,
        role: row.role,
        value: row.value,
        ...(row.operator
          ? { operatorId: reference(row.operator, "operator") }
          : {}),
      });
    for (const [index, row] of (raw.contacts ?? []).entries())
      state.operatorContacts.push({
        id: `${id}:contact:${index + 1}`,
        objectId: id,
        importKey: row.key,
        kind: row.kind,
        value: row.value,
        variant_no: row.variant_no ?? index + 1,
      });
    for (const [index, row] of (raw.files ?? []).entries())
      state.fileSources.push({
        ...row,
        id: `${id}:file:${index + 1}`,
        objectId: id,
        fileType: row.file_type,
        sourcePageUrl: row.source_page_url,
      });
    for (const [index, row] of (raw.financing ?? []).entries())
      state.financingRules.push({
        ...row,
        id: `${id}:financing:${index + 1}`,
        objectId: id,
      });
  }
  return createPortableExport({ state });
}
