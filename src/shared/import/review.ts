import { importDocumentIntoState } from "./format";
import type {
  ImportReviewEditorOption,
  ImportReviewEditorType,
  ImportReviewEvidenceView,
  ImportReviewFieldView,
  ImportReviewFileView,
  ImportReviewFinancingFieldView,
  ImportReviewFinancingView,
  ImportReviewSession,
  ImportReviewView,
} from "../types/importReview";
import type {
  ImportedEvidence,
  ImportedSource,
  LegacyStoredFileSource,
  LegacyStoredObject,
  LegacyStorageState,
} from "../types/legacy-storage";

export interface ImportApprovalReferencePatch {
  field: string;
  targetObjectId: string;
}

export interface ImportApprovalExistingReferenceLink {
  importKey: string;
  targetObjectId: string;
}

export interface ImportApprovalPlan {
  document: unknown;
  selectedImportKey: string;
  existingTargetObjectId?: string;
  selectedDataFields: string[];
  financingFieldsByImportKey: Record<string, string[]>;
  referencePatches: ImportApprovalReferencePatch[];
  existingReferenceLinks: ImportApprovalExistingReferenceLink[];
  temporaryDependencyImportKeys: string[];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function importedFieldSets(
  input: unknown,
  previewState: LegacyStorageState,
): {
  objectFields: Record<string, string[]>;
  financingFields: Record<string, Record<string, string[]>>;
} {
  const root = recordValue(input);
  const rawObjects = Array.isArray(root?.objects) ? root.objects : [];
  const byImportKey = new Map(
    previewState.objects
      .filter((object) => object.importKey)
      .map((object) => [String(object.importKey), object]),
  );

  const objectFields: Record<string, string[]> = {};
  const financingFields: Record<string, Record<string, string[]>> = {};

  for (const raw of rawObjects) {
    const object = recordValue(raw);
    if (!object || typeof object.key !== "string") continue;
    const preview = byImportKey.get(object.key);
    if (!preview) continue;

    const data = recordValue(object.data);
    objectFields[preview.id] = data ? Object.keys(data) : [];

    const financing = Array.isArray(object.financing) ? object.financing : [];
    const fieldsByKey: Record<string, string[]> = {};
    for (const rawVariant of financing) {
      const variant = recordValue(rawVariant);
      if (!variant || typeof variant.key !== "string") continue;
      const variantData = recordValue(variant.data);
      fieldsByKey[variant.key] = variantData ? Object.keys(variantData) : [];
    }
    financingFields[preview.id] = fieldsByKey;
  }

  return { objectFields, financingFields };
}

function includeImportedObjectField(
  session: ImportReviewSession,
  objectId: string,
  field: string,
): void {
  const fields = (session.importedFieldsByObjectId ||= {})[objectId] ?? [];
  if (!fields.includes(field)) fields.push(field);
  session.importedFieldsByObjectId[objectId] = fields;
}

function includeImportedFinancingField(
  session: ImportReviewSession,
  objectId: string,
  financingImportKey: string,
  field: string,
): void {
  const byObject = (session.importedFinancingFieldsByObjectId ||= {});
  const byVariant = (byObject[objectId] ||= {});
  const fields = byVariant[financingImportKey] ?? [];
  if (!fields.includes(field)) fields.push(field);
  byVariant[financingImportKey] = fields;
}

function quoteContext(text: string, evidence: ImportedEvidence) {
  const codepoints = Array.from(text);
  return {
    exact: BurbotCore.clean(evidence.rawValue),
    prefix: BurbotCore.clean(
      codepoints.slice(Math.max(0, evidence.charStart - 80), evidence.charStart).join(""),
    ),
    suffix: BurbotCore.clean(
      codepoints.slice(evidence.charEnd, Math.min(codepoints.length, evidence.charEnd + 80)).join(""),
    ),
  };
}

export function createImportReviewSession(
  input: unknown,
  fileName: string,
  uuid: () => string,
  now: string,
): ImportReviewSession {
  const previewState = importDocumentIntoState(
    BurbotCore.empty(),
    input,
    0,
    uuid,
    now,
  );
  previewState.revision = 0;

  const fieldSets = importedFieldSets(input, previewState);
  const objectOrder = previewState.objects.map((object) => object.id);
  return {
    id: uuid(),
    fileName,
    createdAt: now,
    updatedAt: now,
    previewState,
    objectOrder,
    statusByObjectId: Object.fromEntries(
      objectOrder.map((objectId) => [objectId, "PENDING"]),
    ),
    approvedObjectIdByImportKey: {},
    importedFieldsByObjectId: fieldSets.objectFields,
    importedFinancingFieldsByObjectId: fieldSets.financingFields,
    selectedObjectId: objectOrder[0] ?? null,
  };
}

function selectedObject(session: ImportReviewSession): LegacyStoredObject | undefined {
  if (!session.selectedObjectId) return undefined;
  return session.previewState.objects.find(
    (object) => object.id === session.selectedObjectId,
  );
}

function editorOptions(
  session: ImportReviewSession,
  definition: Record<string, unknown> | undefined,
): ImportReviewEditorOption[] | undefined {
  if (!definition) return undefined;
  if (definition.type === "reference") {
    return session.previewState.objects
      .filter((object) => object.type === definition.references)
      .map((object) => ({ value: object.id, label: BurbotCore.displayName(object) }));
  }
  if (definition.type === "enum" && definition.options) {
    return Object.entries(definition.options as Record<string, string>).map(
      ([value, label]) => ({ value, label: String(label) }),
    );
  }
  if (definition.type === "boolean") {
    return [
      { value: "true", label: "Tak" },
      { value: "false", label: "Nie" },
    ];
  }
  return undefined;
}

function editorType(definition: Record<string, unknown> | undefined): ImportReviewEditorType {
  if (!definition) return "text";
  if (["reference", "enum", "boolean"].includes(String(definition.type))) {
    return "select";
  }
  if (definition.type === "date") return "date";
  if (
    ["integer", "number", "money", "percentage"].includes(
      String(definition.type),
    )
  ) {
    return "number";
  }
  return "text";
}

function editorValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function fieldViews(
  session: ImportReviewSession,
  object: LegacyStoredObject | undefined,
): ImportReviewFieldView[] {
  if (!object) return [];
  const fields = BurbotSchema[object.type]?.fields ?? {};
  return Object.entries(fields)
    .filter(
      ([field, definition]) =>
        !definition.legacy ||
        BurbotCore.hasValue(object.values[field]) ||
        session.previewState.rules.some((rule) =>
          BurbotCore.matches(rule, object.id, field),
        ),
    )
    .map(([field, rawDefinition]) => {
      const definition = rawDefinition as Record<string, unknown>;
      const value = object.values[field];
      const hasValue = BurbotCore.hasValue(value);
      const options = editorOptions(session, definition);
      return {
        field,
        label: String(definition.label ?? field),
        value: hasValue
          ? BurbotCore.formatValue(value, definition, session.previewState)
          : "Nie ustawiono",
        editorType: editorType(definition),
        editorValue: editorValue(value),
        ...(options ? { options } : {}),
        evidenceCount: object.evidence?.[field]?.length ?? 0,
      };
    });
}

function evidenceViews(
  session: ImportReviewSession,
  object: LegacyStoredObject | undefined,
): ImportReviewEvidenceView[] {
  if (!object?.evidence) return [];
  const fields = BurbotSchema[object.type]?.fields ?? {};
  const sources = new Map(
    (session.previewState.importSources ?? []).map((source) => [source.id, source]),
  );
  const result: ImportReviewEvidenceView[] = [];

  for (const [field, entries] of Object.entries(object.evidence)) {
    entries.forEach((evidence, index) => {
      const source = sources.get(evidence.sourceId);
      if (!source) return;
      const quote = quoteContext(source.snapshot.text, evidence);
      if (!quote.exact) return;
      result.push({
        id: `${object.id}:${field}:${index}`,
        field,
        fieldLabel: fields[field]?.label ?? field,
        rawValue: evidence.rawValue,
        ...(source.url ? { sourceUrl: source.url } : {}),
        sourceType: source.type,
        ...quote,
      });
    });
  }
  return result;
}

function fileViews(
  session: ImportReviewSession,
  object: LegacyStoredObject | undefined,
): ImportReviewFileView[] {
  if (!object) return [];
  return (session.previewState.fileSources ?? [])
    .filter((source) => source.objectId === object.id)
    .map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      sourcePageUrl: source.sourcePageUrl,
    }));
}

function financingFieldViews(
  session: ImportReviewSession,
  row: Record<string, unknown>,
): ImportReviewFinancingFieldView[] {
  return Object.entries(BurbotFunding.fields).map(([field, rawDefinition]) => {
    const definition = rawDefinition as Record<string, unknown>;
    const value = row[field];
    return {
      field,
      label: String(definition.label ?? field),
      value:
        value === undefined
          ? ""
          : BurbotCore.formatValue(value, definition, session.previewState),
      editorType: editorType(definition),
      editorValue: editorValue(value),
      ...(editorOptions(session, definition)
        ? { options: editorOptions(session, definition) }
        : {}),
    };
  });
}

function financingViews(
  session: ImportReviewSession,
  object: LegacyStoredObject | undefined,
): ImportReviewFinancingView[] {
  if (!object) return [];
  return (session.previewState.financingRules ?? [])
    .filter((row) => row.objectId === object.id)
    .map((row) => {
      const companySize = String(row.company_size ?? "");
      return {
        id: String(row.id),
        key: String(row.importKey ?? row.id),
        companySize,
        companySizeLabel:
          BurbotFunding.sizes[companySize] ?? companySize,
        variantNo: Number(row.variant_no ?? 1),
        fields: financingFieldViews(session, row),
      };
    });
}

export function importReviewView(
  session: ImportReviewSession | null,
): ImportReviewView {
  if (!session) {
    return {
      active: false,
      objects: [],
      fields: [],
      evidence: [],
      files: [],
      financing: [],
    };
  }

  const object = selectedObject(session);
  const objects = session.objectOrder
    .map((id) => session.previewState.objects.find((entry) => entry.id === id))
    .filter((entry): entry is LegacyStoredObject => Boolean(entry))
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      label: BurbotCore.displayName(entry),
      status: session.statusByObjectId[entry.id] ?? "PENDING",
      fieldCount: fieldViews(session, entry).length,
      evidenceCount: Object.values(entry.evidence ?? {}).reduce(
        (sum, entries) => sum + entries.length,
        0,
      ),
      fileCount: (session.previewState.fileSources ?? []).filter(
        (source) => source.objectId === entry.id,
      ).length,
      financingCount: (session.previewState.financingRules ?? []).filter(
        (row) => row.objectId === entry.id,
      ).length,
    }));

  const approvedCount = objects.filter((entry) => entry.status === "APPROVED").length;
  const rejectedCount = objects.filter((entry) => entry.status === "REJECTED").length;
  return {
    active: true,
    id: session.id,
    fileName: session.fileName,
    createdAt: session.createdAt,
    selectedObjectId: session.selectedObjectId,
    pendingCount: objects.length - approvedCount - rejectedCount,
    approvedCount,
    rejectedCount,
    objects,
    fields: fieldViews(session, object),
    evidence: evidenceViews(session, object),
    files: fileViews(session, object),
    financing: financingViews(session, object),
  };
}

function requirePendingObject(
  session: ImportReviewSession,
  objectId: string,
): LegacyStoredObject {
  const object = session.previewState.objects.find((entry) => entry.id === objectId);
  if (!object) throw new Error("Imported object not found.");
  if (session.statusByObjectId[objectId] === "APPROVED") {
    throw new Error("Zatwierdzonego obiektu nie można już edytować w Import Review.");
  }
  return object;
}

function touch(session: ImportReviewSession, object: LegacyStoredObject, now: string): void {
  object.updatedAt = now;
  session.updatedAt = now;
}

export function editImportReviewObjectField(
  session: ImportReviewSession,
  objectId: string,
  field: string,
  input: string,
  now: string,
): void {
  const object = requirePendingObject(session, objectId);
  const schema = BurbotSchema[object.type];
  const definition = schema?.fields?.[field];
  if (!definition) throw new Error(`Unknown field ${object.type}.${field}.`);

  let value: unknown = input;
  if (definition.type === "reference") {
    const target = session.previewState.objects.find((entry) => entry.id === input);
    if (!target || target.type !== definition.references) {
      throw new Error(`Wybierz poprawny obiekt typu ${definition.references}.`);
    }
    value = target.id;
  }

  object.values[field] = BurbotCore.coerceField(
    value,
    definition,
    session.previewState,
  );
  if (field === schema.primary) object.label = String(object.values[field]);

  // Once the reviewer changes a value manually, imported evidence no longer
  // proves that value. Keeping it would make review visually misleading.
  if (object.evidence?.[field]) {
    delete object.evidence[field];
    if (!Object.keys(object.evidence).length) delete object.evidence;
  }
  (object.manualFields ||= {})[field] = true;
  includeImportedObjectField(session, object.id, field);
  touch(session, object, now);
}

export function editImportReviewFinancingField(
  session: ImportReviewSession,
  objectId: string,
  financingId: string,
  field: string,
  input: string,
  now: string,
): void {
  const object = requirePendingObject(session, objectId);
  const row = (session.previewState.financingRules ?? []).find(
    (entry) => entry.objectId === object.id && String(entry.id) === financingId,
  );
  if (!row) throw new Error("Wariant finansowania nie istnieje.");
  const definition = BurbotFunding.fields[field];
  if (!definition) throw new Error(`Unknown financing field ${field}.`);
  row[field] = BurbotCore.coerceField(input, definition, session.previewState);
  includeImportedFinancingField(
    session,
    object.id,
    String(row.importKey ?? row.id),
    field,
  );
  touch(session, object, now);
}

export function removeImportReviewFinancing(
  session: ImportReviewSession,
  objectId: string,
  financingId: string,
  now: string,
): void {
  const object = requirePendingObject(session, objectId);
  const before = session.previewState.financingRules?.length ?? 0;
  session.previewState.financingRules = (
    session.previewState.financingRules ?? []
  ).filter(
    (entry) =>
      !(entry.objectId === object.id && String(entry.id) === financingId),
  );
  if (session.previewState.financingRules.length === before) {
    throw new Error("Wariant finansowania nie istnieje.");
  }
  touch(session, object, now);
}

export function renameImportReviewFile(
  session: ImportReviewSession,
  objectId: string,
  fileId: string,
  name: string,
  now: string,
): void {
  const object = requirePendingObject(session, objectId);
  const file = (session.previewState.fileSources ?? []).find(
    (entry) => entry.objectId === object.id && entry.id === fileId,
  );
  if (!file) throw new Error("Plik nie istnieje.");
  const cleaned = name.trim();
  if (!cleaned) throw new Error("Nazwa pliku nie może być pusta.");
  file.name = cleaned;
  touch(session, object, now);
}

export function removeImportReviewFile(
  session: ImportReviewSession,
  objectId: string,
  fileId: string,
  now: string,
): void {
  const object = requirePendingObject(session, objectId);
  const before = session.previewState.fileSources?.length ?? 0;
  session.previewState.fileSources = (session.previewState.fileSources ?? []).filter(
    (entry) => !(entry.objectId === object.id && entry.id === fileId),
  );
  if (session.previewState.fileSources.length === before) {
    throw new Error("Plik nie istnieje.");
  }
  touch(session, object, now);
}

function referencedObjects(
  session: ImportReviewSession,
  object: LegacyStoredObject,
): Array<{ field: string; target: LegacyStoredObject }> {
  const fields = BurbotSchema[object.type]?.fields ?? {};
  const result: Array<{ field: string; target: LegacyStoredObject }> = [];
  for (const [field, definition] of Object.entries(fields)) {
    if (definition.type !== "reference") continue;
    const value = object.values[field];
    if (typeof value !== "string") continue;
    const target = session.previewState.objects.find((entry) => entry.id === value);
    if (target) result.push({ field, target });
  }
  return result;
}

function portableEvidence(
  object: LegacyStoredObject,
  sourceById: Map<string, ImportedSource>,
) {
  if (!object.evidence) return undefined;
  const evidence: Record<string, Array<Record<string, unknown>>> = {};
  for (const [field, entries] of Object.entries(object.evidence)) {
    evidence[field] = entries.map((entry) => {
      const source = sourceById.get(entry.sourceId);
      if (!source) throw new Error(`Missing import source ${entry.sourceId}.`);
      return {
        source: source.importKey,
        char_start: entry.charStart,
        char_end: entry.charEnd,
        raw_value: entry.rawValue,
        ...(Object.prototype.hasOwnProperty.call(entry, "normalizedValue")
          ? { normalized_value: entry.normalizedValue }
          : {}),
      };
    });
  }
  return evidence;
}

function explicitObjectFields(
  session: ImportReviewSession,
  object: LegacyStoredObject,
): string[] {
  const tracked = session.importedFieldsByObjectId?.[object.id];
  const selected = new Set<string>();

  if (tracked !== undefined) {
    for (const field of tracked) selected.add(field);
  } else {
    // Compatibility with an Import Review session created before update
    // metadata existed. Infer conservatively so schema defaults never
    // overwrite a real value in an existing object.
    const schema = BurbotSchema[object.type];
    if (schema?.primary) selected.add(schema.primary);
    for (const field of Object.keys(object.evidence ?? {})) selected.add(field);

    for (const [field, value] of Object.entries(object.values)) {
      const definition = schema?.fields?.[field];
      if (!definition || !BurbotCore.hasValue(value)) continue;
      if (definition.type === "reference") {
        selected.add(field);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(definition, "default")) {
        selected.add(field);
        continue;
      }
      if (JSON.stringify(value) !== JSON.stringify(definition.default)) {
        selected.add(field);
      }
    }
  }

  for (const field of Object.keys(object.manualFields ?? {})) {
    selected.add(field);
  }
  return [...selected];
}

function explicitFinancingFields(
  session: ImportReviewSession,
  objectId: string,
  row: Record<string, unknown>,
  importKey: string,
): string[] {
  const tracked =
    session.importedFinancingFieldsByObjectId?.[objectId]?.[importKey];
  if (tracked !== undefined) return [...new Set(tracked)];

  // Older review sessions did not remember the raw JSON field set. Funding
  // fields have no schema defaults except own_contribution_form, which the
  // importer seeds as UNSPECIFIED. Exclude that synthetic default.
  return Object.keys(BurbotFunding.fields).filter((field) => {
    if (!Object.prototype.hasOwnProperty.call(row, field)) return false;
    if (
      field === "own_contribution_form" &&
      row[field] === "UNSPECIFIED"
    ) {
      return false;
    }
    return true;
  });
}

function portableData(
  session: ImportReviewSession,
  object: LegacyStoredObject,
): Record<string, unknown> {
  const fields = BurbotSchema[object.type]?.fields ?? {};
  const selectedFields = new Set(explicitObjectFields(session, object));

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(object.values)) {
    if (!selectedFields.has(field)) continue;
    const definition = fields[field];
    if (definition?.type === "reference" && typeof value === "string") {
      const target = session.previewState.objects.find((entry) => entry.id === value);
      if (!target?.importKey) {
        throw new Error(`Could not resolve imported reference ${field}.`);
      }
      data[field] = { $ref: target.importKey };
    } else {
      data[field] = value;
    }
  }
  return data;
}

function dependencyStub(target: LegacyStoredObject) {
  const schema = BurbotSchema[target.type];
  const primary = schema?.primary;
  if (!primary) throw new Error(`No primary field for ${target.type}.`);
  return {
    key: target.importKey,
    type: target.type,
    data: { [primary]: target.values[primary] },
  };
}

function importedSourceForFile(
  file: LegacyStoredFileSource,
  sources: ImportedSource[],
): ImportedSource {
  const source =
    sources.find((entry) => entry.importKey === file.sourceImportKey) ??
    sources.find((entry) => entry.type === "PDF" && entry.url === file.url);
  if (!source?.url) {
    throw new Error(`Could not resolve import source for file ${file.name}.`);
  }
  return source;
}

function normalizedIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("pl-PL");
}

function uniqueExistingMatch(
  objects: LegacyStoredObject[],
  predicate: (object: LegacyStoredObject) => boolean,
): LegacyStoredObject | undefined {
  const matches = objects.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

export function findExistingImportObjectMatch(
  imported: LegacyStoredObject,
  state: LegacyStorageState | undefined,
): LegacyStoredObject | undefined {
  if (!state) return undefined;
  const candidates = state.objects.filter((object) => object.type === imported.type);
  if (!candidates.length) return undefined;

  if (imported.importKey) {
    const byStableKey = uniqueExistingMatch(
      candidates,
      (object) =>
        object.importKey === imported.importKey ||
        String(object.id) === imported.importKey,
    );
    if (byStableKey) return byStableKey;
  }

  if (imported.type === "project") {
    const number = normalizedIdentity(imported.values.number);
    if (number) {
      const byNumber = uniqueExistingMatch(
        candidates,
        (object) => normalizedIdentity(object.values.number) === number,
      );
      if (byNumber) return byNumber;
    }
  }

  if (imported.type === "operator") {
    const nip = String(imported.values.nip ?? "").replace(/\D/g, "");
    if (nip) {
      const byNip = uniqueExistingMatch(
        candidates,
        (object) =>
          String(object.values.nip ?? "").replace(/\D/g, "") === nip,
      );
      if (byNip) return byNip;
    }
  }

  return undefined;
}

export function buildImportApprovalPlan(
  session: ImportReviewSession,
  objectId: string,
  existingState?: LegacyStorageState,
): ImportApprovalPlan {
  const object = session.previewState.objects.find((entry) => entry.id === objectId);
  if (!object?.importKey) throw new Error("Imported object not found.");
  if (session.statusByObjectId[objectId] === "APPROVED") {
    throw new Error("This imported object is already approved.");
  }

  const existingTarget = findExistingImportObjectMatch(object, existingState);
  const references = referencedObjects(session, object);
  const referencePatches: ImportApprovalReferencePatch[] = [];
  const existingReferenceLinks: ImportApprovalExistingReferenceLink[] = [];
  for (const { field, target } of references) {
    if (!target.importKey) throw new Error(`Could not resolve imported reference ${field}.`);

    let targetObjectId = session.approvedObjectIdByImportKey[target.importKey];
    if (!targetObjectId) {
      const existing = findExistingImportObjectMatch(target, existingState);
      if (existing) {
        targetObjectId = existing.id;
        existingReferenceLinks.push({
          importKey: target.importKey,
          targetObjectId: existing.id,
        });
      }
    }

    if (!targetObjectId) {
      throw new Error(
        `Approve referenced object “${BurbotCore.displayName(target)}” first, or make sure the existing object has the same import key / project number / NIP.`,
      );
    }
    referencePatches.push({ field, targetObjectId });
  }

  const importedSources = session.previewState.importSources ?? [];
  const sourceById = new Map(importedSources.map((source) => [source.id, source]));
  const usedSourceIds = new Set(
    Object.values(object.evidence ?? {})
      .flat()
      .map((entry) => entry.sourceId),
  );

  const selectedFiles = (session.previewState.fileSources ?? []).filter(
    (file) => file.objectId === object.id,
  );
  const portableFiles = selectedFiles.map((file) => {
    const source = importedSourceForFile(file, importedSources);
    usedSourceIds.add(source.id);
    const pageSource =
      importedSources.find(
        (entry) => entry.importKey === file.sourcePageImportKey,
      ) ?? importedSources.find((entry) => entry.url === file.sourcePageUrl);
    if (pageSource) usedSourceIds.add(pageSource.id);
    return {
      source: source.importKey,
      ...(pageSource ? { source_page: pageSource.importKey } : {}),
      name: file.name,
    };
  });

  const sources = [...usedSourceIds].map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Missing import source ${sourceId}.`);
    return {
      key: source.importKey,
      type: source.type,
      ...(source.url ? { url: source.url } : {}),
      snapshot: {
        text: source.snapshot.text,
        ...(source.snapshot.capturedAt ? { captured_at: source.snapshot.capturedAt } : {}),
        ...(source.snapshot.contentHash ? { content_hash: source.snapshot.contentHash } : {}),
        ...(source.snapshot.parserVersion ? { parser_version: source.snapshot.parserVersion } : {}),
      },
    };
  });

  const selectedFinancing = (session.previewState.financingRules ?? []).filter(
    (row) => row.objectId === object.id,
  );
  const financingFieldsByImportKey: Record<string, string[]> = {};
  const portableFinancing = selectedFinancing.map((row) => {
    const key = String(row.importKey ?? row.id);
    const selectedFields = explicitFinancingFields(
      session,
      object.id,
      row,
      key,
    );
    financingFieldsByImportKey[key] = selectedFields;

    const data: Record<string, unknown> = {};
    for (const field of selectedFields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) data[field] = row[field];
    }
    return {
      key,
      company_size: String(row.company_size),
      data,
    };
  });

  const dependencyMap = new Map<string, LegacyStoredObject>();
  for (const { target } of references) {
    if (target.importKey) dependencyMap.set(target.importKey, target);
  }

  return {
    selectedImportKey: object.importKey,
    ...(existingTarget ? { existingTargetObjectId: existingTarget.id } : {}),
    selectedDataFields: explicitObjectFields(session, object),
    financingFieldsByImportKey,
    referencePatches,
    existingReferenceLinks,
    temporaryDependencyImportKeys: [...dependencyMap.keys()],
    document: {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources,
      objects: [
        ...[...dependencyMap.values()].map(dependencyStub),
        {
          key: object.importKey,
          type: object.type,
          data: portableData(session, object),
          ...(object.evidence
            ? { evidence: portableEvidence(object, sourceById) }
            : {}),
          ...(portableFiles.length ? { files: portableFiles } : {}),
          ...(portableFinancing.length
            ? { financing: portableFinancing }
            : {}),
        },
      ],
    },
  };
}

export function markImportObjectLinked(
  session: ImportReviewSession,
  importKey: string,
  targetObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find(
    (entry) => entry.importKey === importKey,
  );
  if (!object) return;
  session.statusByObjectId[object.id] = "APPROVED";
  session.approvedObjectIdByImportKey[importKey] = targetObjectId;
  session.updatedAt = now;
}

export function markImportObjectApproved(
  session: ImportReviewSession,
  previewObjectId: string,
  stagedObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find((entry) => entry.id === previewObjectId);
  if (!object?.importKey) throw new Error("Imported object not found.");
  session.statusByObjectId[previewObjectId] = "APPROVED";
  session.approvedObjectIdByImportKey[object.importKey] = stagedObjectId;
  session.updatedAt = now;
  session.selectedObjectId =
    session.objectOrder.find(
      (id) => (session.statusByObjectId[id] ?? "PENDING") === "PENDING",
    ) ?? previewObjectId;
}


export function markImportObjectRejected(
  session: ImportReviewSession,
  previewObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find(
    (entry) => entry.id === previewObjectId,
  );
  if (!object) throw new Error("Imported object not found.");
  if (session.statusByObjectId[previewObjectId] === "APPROVED") {
    throw new Error("Obiekt jest już w View. Odrzuć jego zmiany z View, jeśli chcesz je wycofać.");
  }
  session.statusByObjectId[previewObjectId] = "REJECTED";
  session.updatedAt = now;
  session.selectedObjectId =
    session.objectOrder.find(
      (id) => session.statusByObjectId[id] === "PENDING",
    ) ?? previewObjectId;
}

export function restoreRejectedImportObject(
  session: ImportReviewSession,
  previewObjectId: string,
  now: string,
): void {
  if (session.statusByObjectId[previewObjectId] !== "REJECTED") return;
  session.statusByObjectId[previewObjectId] = "PENDING";
  session.updatedAt = now;
  session.selectedObjectId = previewObjectId;
}
