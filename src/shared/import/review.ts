import { importDocumentIntoState } from "./format";
import type {
  ImportReviewEvidenceView,
  ImportReviewFieldView,
  ImportReviewSession,
  ImportReviewView,
} from "../types/importReview";
import type {
  ImportedEvidence,
  ImportedSource,
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

function fieldViews(
  session: ImportReviewSession,
  object: LegacyStoredObject | undefined,
): ImportReviewFieldView[] {
  if (!object) return [];
  const fields = BurbotSchema[object.type]?.fields ?? {};
  return Object.entries(object.values).map(([field, value]) => ({
    field,
    label: fields[field]?.label ?? field,
    value: fields[field]
      ? BurbotCore.formatValue(value, fields[field], session.previewState)
      : String(value ?? ""),
    evidenceCount: object.evidence?.[field]?.length ?? 0,
  }));
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

export function importReviewView(
  session: ImportReviewSession | null,
): ImportReviewView {
  if (!session) {
    return { active: false, objects: [], fields: [], evidence: [] };
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
      fieldCount: Object.keys(entry.values ?? {}).length,
      evidenceCount: Object.values(entry.evidence ?? {}).reduce(
        (sum, entries) => sum + entries.length,
        0,
      ),
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
  };
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

  const sourceById = new Map(
    (session.previewState.importSources ?? []).map((source) => [source.id, source]),
  );
  const usedSourceIds = new Set(
    Object.values(object.evidence ?? {})
      .flat()
      .map((entry) => entry.sourceId),
  );
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
