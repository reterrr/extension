function compactRecord(record, omitted = []) {
  const skip = new Set(omitted);
  return Object.fromEntries(
    Object.entries(record ?? {}).filter(
      ([key, value]) =>
        !skip.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== "",
    ),
  );
}

function displayObjectName(object) {
  if (!object) return "";
  const values = object.values ?? {};
  return String(
    values.name ??
      values.external_number ??
      values.title ??
      object.label ??
      object.id ??
      "",
  );
}

function resolveFieldValue(key, value, object, objectsById, schema) {
  const definition = schema?.[object.type]?.fields?.[key];
  if (definition?.type !== "reference") return value;

  const target = objectsById.get(String(value));
  if (!target) {
    return {
      id: String(value),
      name: null,
      type: definition.references ?? null,
    };
  }

  return {
    id: String(target.id),
    name: displayObjectName(target),
    type: target.type,
  };
}

function exportValues(object, objectsById, schema) {
  const output = {};
  for (const [key, value] of Object.entries(object.values ?? {})) {
    if (value === undefined) continue;
    output[key] = resolveFieldValue(
      key,
      value,
      object,
      objectsById,
      schema,
    );
  }
  return output;
}

function geographyPresentation(entry, catalogByKey) {
  const catalog = catalogByKey.get(entry.type + "\u0000" + entry.value);
  return compactRecord({
    type: entry.type,
    role: entry.role,
    label: catalog?.label ?? null,
    context: catalog?.context ?? null,
    value: entry.value,
  });
}

function exportFiles(state, objectId) {
  return (state.fileSources ?? [])
    .filter((source) => String(source.objectId) === String(objectId))
    .map((source) =>
      compactRecord(
        {
          name: source.name,
          file_type: source.fileType,
          url: source.url,
          source_page_url: source.sourcePageUrl,
          added_at: source.addedAt,
        },
      ),
    );
}

function exportFunding(state, objectId) {
  return (state.financingRules ?? [])
    .filter((row) => String(row.objectId) === String(objectId))
    .map((row) =>
      compactRecord(row, ["id", "objectId"]),
    );
}

function exportDocuments(state, objectId, documentCatalog) {
  const names = new Map(
    (documentCatalog ?? []).map((entry) => [entry.key, entry]),
  );

  return (state.documentRequirements ?? [])
    .filter((row) => String(row.objectId) === String(objectId))
    .map((row) => {
      const catalog = names.get(row.document_type_key);
      return compactRecord({
        document_type_key: row.document_type_key,
        name: catalog?.name ?? null,
        internal: catalog?.internal ? true : undefined,
        ...compactRecord(row, ["id", "objectId", "document_type_key"]),
      });
    });
}

function exportObject(
  state,
  object,
  objectsById,
  schema,
  geographyCatalog,
  documentCatalog,
) {
  const catalogByKey = new Map(
    (geographyCatalog ?? []).map((entry) => [
      entry.type + "\u0000" + entry.value,
      entry,
    ]),
  );

  const geographies = (state.geographies ?? [])
    .filter((entry) => String(entry.objectId) === String(object.id))
    .map((entry) => geographyPresentation(entry, catalogByKey));

  const result = {
    id: String(object.id),
    type: object.type,
    name: displayObjectName(object),
    source_url: object.sourceUrl ?? undefined,
    values: exportValues(object, objectsById, schema),
  };

  if (geographies.length) result.geography = geographies;

  const financing = exportFunding(state, object.id);
  if (financing.length) result.financing = financing;

  const documents = exportDocuments(
    state,
    object.id,
    documentCatalog,
  );
  if (documents.length) result.documents = documents;

  const files = exportFiles(state, object.id);
  if (files.length) result.files = files;

  return result;
}

/**
 * Compact export intended for LLM/AI analysis.
 *
 * Deliberately excludes extraction rules, evidence, import snapshots and
 * commit/session internals. It keeps all stored business values and resolves
 * reference fields to {id, name, type} using the whole workspace.
 */
export function createAiViewExport({
  state,
  view,
  schema,
  geographyCatalog = [],
  documentCatalog = [],
  exportedAt = new Date().toISOString(),
}) {
  if (!view?.objectIds?.length) {
    throw new Error("Aktywny View jest wymagany do eksportu.");
  }

  const objectsById = new Map(
    (state.objects ?? []).map((object) => [String(object.id), object]),
  );
  const objects = view.objectIds
    .map((id) => objectsById.get(String(id)))
    .filter(Boolean)
    .map((object) =>
      exportObject(
        state,
        object,
        objectsById,
        schema,
        geographyCatalog,
        documentCatalog,
      ),
    );

  if (!objects.length) {
    throw new Error("View nie zawiera już żadnych istniejących obiektów.");
  }

  return {
    format: "burbot-ai-view",
    version: 1,
    exported_at: String(exportedAt),
    view: compactRecord({
      query: view.query || undefined,
      type: view.type !== "all" ? view.type : undefined,
      object_count: objects.length,
    }),
    objects,
  };
}

export function aiViewExportFilename(exportedAt = new Date().toISOString()) {
  const stamp = String(exportedAt)
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "Z");
  return "burbot-view-ai-" + stamp + ".json";
}
