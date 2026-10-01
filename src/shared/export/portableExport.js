const FILE_METADATA_FIELDS = [
  "display_name",
  "purpose",
  "has_fields",
  "intended_use",
  "client_requirement",
  "signature_requirement",
  "document_kind",
  "delivery_method",
];
const hasValue = (value) =>
  value !== undefined && value !== null && value !== "";
const compact = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => hasValue(v)));
const typeOf = (object) =>
  object.type === "nabor" ? "recruitment" : object.type;
const rowIdentity = (row) => String(row.id ?? row.document_type_key);

/** Prefer existing portable keys; fall back to database IDs on key collisions. */
function keysFor(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = String(entry.importKey || rowIdentity(entry));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = new Map(),
    used = new Set();
  for (const entry of entries) {
    const preferred = String(entry.importKey || rowIdentity(entry));
    let key = counts.get(preferred) === 1 ? preferred : rowIdentity(entry);
    const base = key;
    for (let suffix = 2; used.has(key); suffix++) key = `${base}:${suffix}`;
    used.add(key);
    keys.set(rowIdentity(entry), key);
  }
  return keys;
}

/**
 * The same portable v1 document is used by View export, workspace export and import.
 * @param {{state: import("../types/legacy-storage").LegacyStorageState, view?: {objectIds: string[]}, schema?: Record<string, any>, geographyCatalog?: unknown[], exportedAt?: string}} options
 */
export function createPortableExport({
  state,
  view,
  schema = globalThis.BurbotSchema ?? {},
}) {
  const objectsById = new Map(
    (state.objects ?? []).map((object) => [String(object.id), object]),
  );
  const requested = view?.objectIds ?? [...objectsById.keys()];
  const selected = new Set(
    requested.map(String).filter((id) => objectsById.has(id)),
  );
  if (!selected.size) throw new Error("Brak obiektów do eksportu.");
  // Only explicitly selected projects expand to all their recruitments. A
  // recruitment's parent is a dependency, not a request for every sibling.
  for (const id of [...selected]) {
    if (typeOf(objectsById.get(id)) !== "project") continue;
    for (const object of objectsById.values())
      if (
        typeOf(object) === "recruitment" &&
        String(object.values?.project_id) === id
      )
        selected.add(String(object.id));
  }
  const assignmentsFor = (object) => {
    const rows = (state.operatorAssignments ?? []).filter(
      (row) => String(row.objectId) === String(object.id),
    );
    if (rows.length || !object.values?.operator_id) return rows;
    return [
      {
        id: `${object.id}:legacy-operator`,
        operatorId: object.values.operator_id,
        operatorType: "GLOWNY",
      },
    ];
  };
  const dependencies = (object) => {
    const ids = [];
    for (const [field, value] of Object.entries(object.values ?? {}))
      if (
        hasValue(value) &&
        (schema[typeOf(object)]?.fields?.[field]?.type === "reference" ||
          ["project_id", "operator_id"].includes(field))
      )
        ids.push(String(value));
    for (const row of assignmentsFor(object)) ids.push(String(row.operatorId));
    for (const row of state.geographies ?? [])
      if (String(row.objectId) === String(object.id) && row.operatorId)
        ids.push(String(row.operatorId));
    return ids;
  };
  const ordered = [],
    visiting = new Set(),
    visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    const object = objectsById.get(id);
    if (!object)
      throw new Error(
        `Brak powiązanego obiektu ${id}. Uzupełnij relację przed eksportem.`,
      );
    if (visiting.has(id))
      throw new Error(`Cykliczne powiązanie obiektu ${id}.`);
    visiting.add(id);
    for (const dependency of dependencies(object)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(object);
  };
  for (const id of selected) visit(id);
  const objectKeys = keysFor(ordered);
  const ref = (id) => {
    const key = objectKeys.get(String(id));
    if (!key) throw new Error(`Brak powiązanego obiektu ${id}.`);
    return { $ref: key };
  };

  const storedSources = state.importSources ?? [];
  // Approval stages each object separately, so the same immutable snapshot can
  // occur under several storage IDs. Export it once while keeping distinct edits.
  const canonicalSources = new Map(),
    canonicalId = new Map();
  for (const source of storedSources) {
    const signature = JSON.stringify([
      source.importKey,
      source.type,
      source.url,
      source.snapshot.text,
      source.snapshot.capturedAt,
      source.snapshot.contentHash,
      source.snapshot.parserVersion,
    ]);
    if (!canonicalSources.has(signature))
      canonicalSources.set(signature, source);
    canonicalId.set(
      String(source.id),
      String(canonicalSources.get(signature).id),
    );
  }
  const sourceKeys = keysFor([...canonicalSources.values()]);
  const usedKeys = new Set(sourceKeys.values());
  const sources = new Map();
  const sourceById = new Map(
    storedSources.map((source) => [String(source.id), source]),
  );
  const useSource = (id) => {
    const source = sourceById.get(String(id));
    if (!source) throw new Error(`Brak zapisanego źródła dowodu ${id}.`);
    const key = sourceKeys.get(canonicalId.get(String(id)));
    sources.set(
      key,
      compact({
        key,
        type: source.type,
        url: source.url,
        snapshot: {
          text: source.snapshot.text,
          ...compact({
            captured_at: source.snapshot.capturedAt,
            content_hash: source.snapshot.contentHash,
            parser_version: source.snapshot.parserVersion,
          }),
        },
      }),
    );
    return key;
  };
  const useUrl = (url, type, preferred) => {
    if (!url) throw new Error("Plik do eksportu nie ma adresu URL.");
    const matches = storedSources.filter(
      (source) => source.url === url && source.type === type,
    );
    const source =
      matches.findLast((entry) => entry.importKey === preferred) ??
      matches.at(-1);
    if (source) return useSource(source.id);
    for (const source of sources.values())
      if (source.url === url && source.type === type) return source.key;
    const base = preferred || `source:${type}:${url}`;
    let key = base;
    for (let suffix = 2; usedKeys.has(key); suffix++) key = `${base}:${suffix}`;
    usedKeys.add(key);
    // No text has been captured: preserve the attachment, never invent a snapshot.
    sources.set(key, { key, type, url, snapshot: { text: "" } });
    return key;
  };
  const evidenceMap = (entries, values) => {
    const evidence = {};
    for (const [field, proofs] of Object.entries(entries ?? {})) {
      if (!Object.hasOwn(values, field) || !proofs.length) continue;
      evidence[field] = proofs.map((proof) => ({
        source: useSource(proof.sourceId),
        char_start: proof.charStart,
        char_end: proof.charEnd,
        raw_value: proof.rawValue,
        ...(Object.hasOwn(proof, "normalizedValue")
          ? { normalized_value: proof.normalizedValue }
          : {}),
      }));
    }
    return Object.keys(evidence).length ? { evidence } : {};
  };
  const targetEvidence = (object, kind, id, values) => {
    const entries = {};
    for (const proof of state.importTargetEvidence ?? [])
      if (
        String(proof.objectId) === String(object.id) &&
        proof.target.kind === kind &&
        String(proof.target.id) === String(id)
      )
        (entries[proof.field] ??= []).push(proof);
    return evidenceMap(entries, values);
  };
  const scoped = (collection, object) =>
    (state[collection] ?? []).filter(
      (row) => String(row.objectId) === String(object.id),
    );
  const dataFor = (values, fields, context, omitted = []) => {
    const result = {};
    for (const [field, value] of Object.entries(values ?? {})) {
      if (
        !hasValue(value) ||
        omitted.includes(field) ||
        fields?.[field]?.system ||
        field === "last_checked_at"
      )
        continue;
      if (fields && !Object.hasOwn(fields, field))
        throw new Error(
          `Nieznane pole ${context}.${field}. Przypisz je do obsługiwanego pola przed eksportem.`,
        );
      result[field] =
        fields?.[field]?.type === "reference" ||
        ["project_id", "operator_id"].includes(field)
          ? ref(value)
          : value;
    }
    return result;
  };

  const objects = ordered.map((object) => {
    const type = typeOf(object);
    const operators = assignmentsFor(object);
    const data = dataFor(
      object.values,
      schema[type]?.fields,
      type,
      operators.length ? ["operator_id"] : [],
    );
    const result = {
      key: objectKeys.get(String(object.id)),
      type,
      ...compact({ source_url: object.sourceUrl }),
      data,
      ...evidenceMap(object.evidence, data),
    };
    if (operators.length) {
      const keys = keysFor(operators);
      result.operators = operators.map((row) => ({
        key: keys.get(String(row.id)),
        operator: ref(row.operatorId),
        operator_type: row.operatorType,
      }));
    }
    const files = scoped("fileSources", object);
    if (files.length)
      result.files = files.map((file) => {
        const metadata = compact(
          Object.fromEntries(
            FILE_METADATA_FIELDS.map((field) => [field, file[field]]),
          ),
        );
        return {
          source: useUrl(file.url, file.fileType, file.sourceImportKey),
          ...(file.sourcePageUrl
            ? {
                source_page: useUrl(
                  file.sourcePageUrl,
                  "HTML",
                  file.sourcePageImportKey,
                ),
              }
            : {}),
          ...(Object.keys(metadata).length ? { metadata } : {}),
          ...targetEvidence(object, "file_source", file.id, metadata),
        };
      });
    const geography = scoped("geographies", object);
    if (geography.length) {
      const keys = keysFor(geography);
      result.geography = geography.map((row) => ({
        key: keys.get(String(row.id)),
        type: row.type,
        role: row.role,
        value: row.value,
        ...(row.operatorId ? { operator: ref(row.operatorId) } : {}),
        ...targetEvidence(object, "geography", row.id, { value: row.value }),
      }));
    }
    const contacts = scoped("operatorContacts", object).sort(
      (a, b) =>
        String(a.kind).localeCompare(String(b.kind)) ||
        Number(a.variant_no) - Number(b.variant_no),
    );
    if (contacts.length) {
      const keys = keysFor(contacts);
      result.contacts = contacts.map((row) => ({
        key: keys.get(String(row.id)),
        kind: row.kind,
        value: row.value,
        ...targetEvidence(object, "operator_contact", row.id, {
          value: row.value,
        }),
      }));
    }
    for (const [collection, section, kind, fields] of [
      [
        "financingRules",
        "financing",
        "funding",
        globalThis.BurbotFunding?.fields,
      ],
      [
        "documentRequirements",
        "documents",
        "document",
        globalThis.BurbotDocuments?.fields,
      ],
    ]) {
      const rows = scoped(collection, object).sort(
        (a, b) => Number(a.variant_no ?? 0) - Number(b.variant_no ?? 0),
      );
      if (!rows.length) continue;
      const keys = keysFor(rows);
      result[section] = rows.map((row) => {
        const data = dataFor(row, fields, section, [
          "id",
          "objectId",
          "importKey",
          "company_size",
          "variant_no",
          "document_type_key",
          "copiedAt",
          "copiedFromProjectId",
          "copiedFromFundingRuleId",
        ]);
        return {
          key: keys.get(rowIdentity(row)),
          ...(section === "financing"
            ? { company_size: row.company_size }
            : { document_type_key: row.document_type_key }),
          data,
          ...targetEvidence(
            object,
            kind,
            section === "documents" ? row.document_type_key : row.id,
            data,
          ),
        };
      });
    }
    return result;
  });
  return {
    version: 1,
    offset_unit: "unicode_codepoint",
    sources: [...sources.values()],
    objects,
  };
}

export function portableExportFilename(exportedAt = new Date().toISOString()) {
  return `burbot-portable-${String(exportedAt).replace(/[:.]/g, "-")}.json`;
}
