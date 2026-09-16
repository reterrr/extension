import { importDocumentIntoState } from "./format";
import type {
  ImportReviewEvidenceView,
  ImportReviewFieldView,
  ImportReviewSession,
  ImportReviewView,
} from "../types/importReview";
import type {
  ImportedEvidence,
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function importedDependencyIds(
  session: ImportReviewSession,
  object: LegacyStoredObject,
): string[] {
  const fields = BurbotSchema[object.type]?.fields ?? {};
  const importedIds = new Set(session.previewState.objects.map((entry) => entry.id));
  const result: string[] = [];
  for (const [field, definition] of Object.entries(fields)) {
    if (definition.type !== "reference") continue;
    const value = object.values[field];
    if (typeof value === "string" && importedIds.has(value)) result.push(value);
  }
  return result;
}

export function approveImportReviewObject(
  session: ImportReviewSession,
  original: LegacyStorageState,
  objectId: string,
  now: string,
): LegacyStorageState {
  if (session.statusByObjectId[objectId] === "APPROVED") {
    throw new Error("This imported object is already approved.");
  }
  const candidate = session.previewState.objects.find((object) => object.id === objectId);
  if (!candidate) throw new Error("Imported object not found.");

  if (
    candidate.importKey &&
    original.objects.some(
      (object) => object.importKey === candidate.importKey && object.type === candidate.type,
    )
  ) {
    throw new Error(`Object ${candidate.importKey} is already present in the commit.`);
  }

  const missingDependencies = importedDependencyIds(session, candidate).filter(
    (dependencyId) => !original.objects.some((object) => object.id === dependencyId),
  );
  if (missingDependencies.length) {
    const dependency = session.previewState.objects.find(
      (object) => object.id === missingDependencies[0],
    );
    throw new Error(
      `Approve referenced object “${dependency ? BurbotCore.displayName(dependency) : missingDependencies[0]}” first.`,
    );
  }

  const next = clone(original);
  const staged = clone(candidate);
  staged.updatedAt = now;
  next.objects.push(staged);

  const requiredSourceIds = new Set(
    Object.values(staged.evidence ?? {})
      .flat()
      .map((evidence) => evidence.sourceId),
  );
  const existingSourceIds = new Set(
    (next.importSources ?? []).map((source) => source.id),
  );
  for (const source of session.previewState.importSources ?? []) {
    if (requiredSourceIds.has(source.id) && !existingSourceIds.has(source.id)) {
      (next.importSources ||= []).push(clone(source));
      existingSourceIds.add(source.id);
    }
  }

  session.statusByObjectId[objectId] = "APPROVED";
  session.updatedAt = now;
  session.selectedObjectId =
    session.objectOrder.find(
      (id) => session.statusByObjectId[id] !== "APPROVED",
    ) ?? objectId;

  return next;
}
