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
} from "../types/legacy-storage";

export interface ImportApprovalReferencePatch {
  field: string;
  targetObjectId: string;
}

export interface ImportApprovalPlan {
  document: unknown;
  selectedImportKey: string;
  referencePatches: ImportApprovalReferencePatch[];
  temporaryDependencyImportKeys: string[];
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
  return {
    active: true,
    id: session.id,
    fileName: session.fileName,
    createdAt: session.createdAt,
    selectedObjectId: session.selectedObjectId,
    pendingCount: objects.length - approvedCount,
    approvedCount,
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

function portableData(
  session: ImportReviewSession,
  object: LegacyStoredObject,
): Record<string, unknown> {
  const fields = BurbotSchema[object.type]?.fields ?? {};
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(object.values)) {
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

export function buildImportApprovalPlan(
  session: ImportReviewSession,
  objectId: string,
): ImportApprovalPlan {
  const object = session.previewState.objects.find((entry) => entry.id === objectId);
  if (!object?.importKey) throw new Error("Imported object not found.");
  if (session.statusByObjectId[objectId] === "APPROVED") {
    throw new Error("This imported object is already approved.");
  }

  const references = referencedObjects(session, object);
  const referencePatches: ImportApprovalReferencePatch[] = [];
  for (const { field, target } of references) {
    if (!target.importKey) throw new Error(`Could not resolve imported reference ${field}.`);
    const targetObjectId = session.approvedObjectIdByImportKey[target.importKey];
    if (!targetObjectId) {
      throw new Error(`Approve referenced object “${BurbotCore.displayName(target)}” first.`);
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
  const portableFinancing = selectedFinancing.map((row) => {
    const data: Record<string, unknown> = {};
    for (const field of Object.keys(BurbotFunding.fields)) {
      if (Object.prototype.hasOwnProperty.call(row, field)) data[field] = row[field];
    }
    return {
      key: String(row.importKey ?? row.id),
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
    referencePatches,
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
      (id) => session.statusByObjectId[id] !== "APPROVED",
    ) ?? previewObjectId;
}
