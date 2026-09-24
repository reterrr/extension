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
      compactRecord({
        name: source.name,
        file_type: source.fileType,
        url: source.url,
        source_page_url: source.sourcePageUrl,
        document_kind: source.document_kind,
        purpose: source.purpose,
        has_fields: source.has_fields,
        intended_use: source.intended_use,
        client_requirement: source.client_requirement,
        signature_requirement: source.signature_requirement,
        delivery_method: source.delivery_method,
        added_at: source.addedAt,
      }),
    );
}

function exportOperatorContacts(state, objectId) {
  return (state.operatorContacts ?? [])
    .filter((row) => String(row.objectId) === String(objectId))
    .sort(
      (a, b) =>
        String(a.kind).localeCompare(String(b.kind)) ||
        Number(a.variant_no ?? 0) - Number(b.variant_no ?? 0),
    )
    .map((row) =>
      compactRecord({
        kind: row.kind,
        variant_no: row.variant_no,
        value: row.value,
      }),
    );
}

function exportFunding(state, objectId) {
  return (state.financingRules ?? [])
    .filter((row) => String(row.objectId) === String(objectId))
    .map((row) => compactRecord(row, ["id", "objectId"]));
}

function urlsFromValue(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/[;\n\r\t ]+/u)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\/\S+$/iu.test(part));
}

function exportLinks(object, files, schema) {
  const byUrl = new Map();

  const add = (url, from) => {
    if (typeof url !== "string" || !/^https?:\/\//iu.test(url.trim())) return;
    const normalized = url.trim();
    const existing = byUrl.get(normalized) ?? {
      url: normalized,
      from: [],
    };
    if (from && !existing.from.includes(from)) existing.from.push(from);
    byUrl.set(normalized, existing);
  };

  add(object.sourceUrl, "source_url");

  for (const [key, value] of Object.entries(object.values ?? {})) {
    const definition = schema?.[object.type]?.fields?.[key];
    const likelyUrlField =
      definition?.type === "url" ||
      /(url|website|link|site)/iu.test(String(key));
    if (!likelyUrlField) continue;
    for (const url of urlsFromValue(value)) add(url, "values." + key);
  }

  for (const file of files) {
    add(file.url, file.name ? "file:" + file.name : "file");
    add(
      file.source_page_url,
      file.name ? "file_source:" + file.name : "file_source",
    );
  }

  return [...byUrl.values()];
}

function exportObject(
  state,
  object,
  objectsById,
  schema,
  geographyCatalog,
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

  const files = exportFiles(state, object.id);
  const result = {
    id: String(object.id),
    type: object.type,
    name: displayObjectName(object),
    source_url: object.sourceUrl ?? undefined,
    values: exportValues(object, objectsById, schema),
  };

  if (geographies.length) result.geography = geographies;

  const contacts = exportOperatorContacts(state, object.id);
  if (contacts.length) result.contacts = contacts;

  const financing = exportFunding(state, object.id);
  if (financing.length) result.financing = financing;

  if (files.length) result.files = files;

  const links = exportLinks(object, files, schema);
  if (links.length) result.links = links;

  return result;
}

function relatedRecruitments(state, projectId) {
  return (state.objects ?? []).filter(
    (object) =>
      (object.type === "recruitment" || object.type === "nabor") &&
      String(object.values?.project_id ?? "") === String(projectId),
  );
}

function exportProjectRecruitments(
  state,
  project,
  objectsById,
  schema,
  geographyCatalog,
) {
  return relatedRecruitments(state, project.id).map((recruitment) =>
    exportObject(
      state,
      recruitment,
      objectsById,
      schema,
      geographyCatalog,
    ),
  );
}

/**
 * Compact export intended for LLM/AI analysis.
 *
 * Deliberately excludes extraction rules, evidence, import snapshots and
 * commit/session internals. It keeps all stored business values and resolves
 * reference fields to {id, name, type} using the whole workspace.
 *
 * Projects additionally include every related recruitment with its complete
 * business payload (values, geography, financing, classified files and links),
 * even when those recruitment objects are not direct members of the View.
 */
export function createAiViewExport({
  state,
  view,
  schema,
  geographyCatalog = [],
  exportedAt = new Date().toISOString(),
}) {
  if (!view?.objectIds?.length) {
    throw new Error("Aktywny View jest wymagany do eksportu.");
  }

  const objectsById = new Map(
    (state.objects ?? []).map((object) => [String(object.id), object]),
  );

  let relatedRecruitmentCount = 0;
  const objects = view.objectIds
    .map((id) => objectsById.get(String(id)))
    .filter(Boolean)
    .map((object) => {
      const exported = exportObject(
        state,
        object,
        objectsById,
        schema,
        geographyCatalog,
      );

      if (object.type === "project") {
        const recruitments = exportProjectRecruitments(
          state,
          object,
          objectsById,
          schema,
          geographyCatalog,
        );
        if (recruitments.length) {
          exported.recruitments = recruitments;
          relatedRecruitmentCount += recruitments.length;
        }
      }

      return exported;
    });

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
      related_recruitment_count:
        relatedRecruitmentCount || undefined,
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
