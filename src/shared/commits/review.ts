import type {
  CommitReviewItem,
  CommitValueChange,
  DraftCommit,
  ReviewTarget,
  StoredReviewChange,
} from "../types/commit";
import type {
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";

type Row = Record<string, unknown>;
const COLLECTIONS: Record<string, { label: string; kind: string }> = {
  fileSources: { label: "Pliki", kind: "file_source" },
  financingRules: { label: "Warianty dofinansowania", kind: "funding" },
  geographies: { label: "Geografia", kind: "geography" },
  operatorAssignments: { label: "Operatorzy", kind: "operator_assignment" },
  operatorContacts: { label: "Kontakty", kind: "operator_contact" },
  documentRequirements: { label: "Dokumenty", kind: "document" },
};
const ATTACHMENTS = ["rules", "fieldEvidence", "importTargetEvidence"];
const ALL_ROWS = [...Object.keys(COLLECTIONS), ...ATTACHMENTS];
const OMIT_DETAILS = new Set([
  "id",
  "objectId",
  "importKey",
  "addedAt",
  "createdAt",
  "updatedAt",
  "last_checked_at",
  "metadataInferenceVersion",
  "copiedAt",
  "copiedFromProjectId",
  "copiedFromFileSourceId",
  "copiedFromGeographyId",
]);
const copy = <T>(value: T): T => structuredClone(value);
export function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value ?? null);
}
function rows(state: LegacyStorageState, key: string, objectId: string): Row[] {
  return (((state as unknown as Row)[key] ?? []) as Row[]).filter(
    (row) => row.objectId === objectId,
  );
}
function rowKey(row: Row): string {
  return String(
    row.document_type_key ??
      row.id ??
      row.ruleId ??
      row.evidenceId ??
      row.row_key ??
      stable(row),
  );
}
function label(object: LegacyStoredObject): string {
  return String(
    object.values?.name ??
      object.values?.external_number ??
      object.label ??
      object.id,
  );
}
function objectFor(state: LegacyStorageState, id: string) {
  return state.objects.find((object) => object.id === id);
}
function attachmentMatches(row: Row, target: ReviewTarget): boolean {
  const nested = row.target as { kind?: string; id?: string } | undefined;
  if (target.kind === "field")
    return (!nested || nested.kind === "object") && row.field === target.key;
  if (target.kind === "row")
    return (
      nested?.kind === COLLECTIONS[target.collection!]?.kind &&
      String(nested?.id) === target.key
    );
  return false;
}
function snapshot(
  state: LegacyStorageState,
  objectId: string,
  target: ReviewTarget,
): Row | null {
  const object = objectFor(state, objectId);
  if (target.kind === "object")
    return object
      ? {
          object: copy(object),
          rows: Object.fromEntries(
            ALL_ROWS.map((key) => [key, copy(rows(state, key, objectId))]),
          ),
        }
      : null;
  if (target.kind === "property")
    return object && Object.hasOwn(object, target.key)
      ? { value: (object as unknown as Row)[target.key] }
      : null;
  const attachments = Object.fromEntries(
    ATTACHMENTS.map((key) => [
      key,
      rows(state, key, objectId).filter((row) =>
        attachmentMatches(row, target),
      ),
    ]),
  );
  if (target.kind === "field") {
    const value: Row = { attachments };
    if (object && Object.hasOwn(object.values, target.key))
      value.value = object.values[target.key];
    if (object?.evidence?.[target.key])
      value.evidence = object.evidence[target.key];
    if (object?.manualFields && Object.hasOwn(object.manualFields, target.key))
      value.manual = object.manualFields[target.key];
    return value;
  }
  return {
    row: rows(state, target.collection!, objectId).find(
      (row) => rowKey(row) === target.key,
    ),
    attachments,
  };
}
function rowLabel(key: string, row: Row, state: LegacyStorageState): string {
  if (key === "fileSources")
    return String(row.display_name || row.name || row.url || "Plik");
  if (key === "financingRules")
    return [
      row.variant_name || row.name || `Wariant ${row.variant_no ?? ""}`,
      row.company_size,
    ]
      .filter(Boolean)
      .join(" · ");
  if (key === "geographies")
    return [row.role, row.value || row.name || row.terytCode]
      .filter(Boolean)
      .join(" · ");
  if (key === "operatorAssignments")
    return objectFor(state, String(row.operatorId))
      ? label(objectFor(state, String(row.operatorId))!)
      : "Operator";
  if (key === "operatorContacts")
    return String(row.value || row.kind || "Kontakt");
  return String(row.name || row.document_type_key || row.field || "Dokument");
}
export function reviewChanges(draft: DraftCommit): StoredReviewChange[] {
  const result: StoredReviewChange[] = [];
  const ids = new Set(
    [...draft.baseState.objects, ...draft.workingState.objects].map(
      (object) => object.id,
    ),
  );
  for (const objectId of ids) {
    const before = objectFor(draft.baseState, objectId);
    const after = objectFor(draft.workingState, objectId);
    const object = after ?? before!;
    const append = (target: ReviewTarget, group: string, title: string) => {
      const old = snapshot(draft.baseState, objectId, target),
        next = snapshot(draft.workingState, objectId, target);
      if (stable(old) === stable(next)) return;
      result.push({
        id: JSON.stringify([
          objectId,
          target.kind,
          target.collection ?? "",
          target.key,
        ]),
        objectId,
        objectType: object.type,
        objectLabel: label(object),
        target,
        group,
        label: title,
        before: copy(old),
        after: copy(next),
      });
    };
    if (!after) {
      append({ kind: "object", key: "object" }, "Obiekt", "Usunięcie obiektu");
      continue;
    }
    const start = result.length;
    const fields = new Set([
      ...Object.keys(before?.values ?? {}),
      ...Object.keys(after.values),
      ...Object.keys(before?.evidence ?? {}),
      ...Object.keys(after.evidence ?? {}),
      ...Object.keys(before?.manualFields ?? {}),
      ...Object.keys(after.manualFields ?? {}),
    ]);
    for (const state of [draft.baseState, draft.workingState])
      for (const key of ATTACHMENTS)
        for (const row of rows(state, key, objectId)) {
          const target = row.target as { kind?: string } | undefined;
          if (!target || target.kind === "object")
            fields.add(String(row.field));
        }
    for (const field of fields)
      if (field !== "last_checked_at")
        append({ kind: "field", key: field }, "Pola", field);
    for (const key of ["sourceUrl", "importKey"])
      append({ kind: "property", key }, "Pola", key);
    for (const [key, definition] of Object.entries(COLLECTIONS)) {
      const oldRows = rows(draft.baseState, key, objectId),
        nextRows = rows(draft.workingState, key, objectId);
      const rowIds = new Set([...oldRows, ...nextRows].map(rowKey));
      for (const rowId of rowIds) {
        const row =
          nextRows.find((entry) => rowKey(entry) === rowId) ??
          oldRows.find((entry) => rowKey(entry) === rowId)!;
        append(
          { kind: "row", collection: key, key: rowId },
          definition.label,
          rowLabel(key, row, draft.workingState),
        );
      }
    }
    if (!before && result.length === start)
      append({ kind: "object", key: "object" }, "Obiekt", "Nowy obiekt");
  }
  return result;
}
export function fingerprint(change: StoredReviewChange): string {
  return stable([change.before, change.after]);
}
function selection(
  draft: DraftCommit,
  change: StoredReviewChange,
): "save" | "later" {
  const saved = draft.reviewDecisions?.[change.id];
  return saved?.fingerprint === fingerprint(change) ? saved.selection : "save";
}
function display(value: unknown, state: LegacyStorageState): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Tak" : "Nie";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const object =
    typeof value === "string" ? objectFor(state, value) : undefined;
  return object ? label(object) : String(value);
}
function detailValues(
  change: StoredReviewChange,
  side: "before" | "after",
): Row {
  const snap = change[side];
  if (change.target.kind === "row") return (snap?.row ?? {}) as Row;
  if (change.target.kind === "object")
    return (snap?.object as LegacyStoredObject)?.values ?? {};
  return { [change.target.key]: snap?.value };
}
function sourceDescription(
  snap: Row | null,
  state: LegacyStorageState,
): string {
  if (!snap) return "";
  const descriptions: string[] = [];
  if (snap.manual === true) descriptions.push("Wartość wpisana ręcznie");
  const attachments = (snap.attachments ?? {}) as Record<string, Row[]>;
  const entries = [
    ...((snap.evidence ?? []) as Row[]),
    ...Object.values(attachments).flat(),
  ];
  for (const entry of entries) {
    const source = state.importSources?.find(
      (row) => row.id === entry.sourceId,
    );
    descriptions.push(
      [
        entry.pageUrl ?? source?.url ?? source?.importKey,
        entry.rawValue ?? entry.sampleValue ?? entry.lastSampleValue,
        entry.selector ? `Miejsce na stronie: ${entry.selector}` : "",
        entry.extraction ? `Odczyt: ${stable(entry.extraction)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return [...new Set(descriptions.filter(Boolean))].join("\n\n");
}
function item(
  draft: DraftCommit,
  change: StoredReviewChange,
  discarded = false,
): CommitReviewItem {
  const before = detailValues(change, "before"),
    after = detailValues(change, "after");
  const details: CommitValueChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      ((change.target.kind === "row" || change.target.kind === "object") &&
        OMIT_DETAILS.has(key)) ||
      stable(before[key]) === stable(after[key])
    )
      continue;
    const oldText = display(before[key], draft.baseState),
      newText = display(after[key], draft.workingState);
    details.push({
      field: key,
      status: !oldText ? "ADDED" : !newText ? "REMOVED" : "MODIFIED",
      before: oldText,
      after: newText,
    });
  }
  if (!details.length) {
    const oldSources = sourceDescription(change.before, draft.baseState);
    const newSources = sourceDescription(change.after, draft.workingState);
    details.push({
      field: oldSources || newSources ? "evidence" : "metadata",
      status: "MODIFIED",
      before:
        oldSources ||
        (newSources ? "" : display(change.before, draft.baseState)),
      after:
        newSources ||
        (oldSources ? "" : display(change.after, draft.workingState)),
    });
  }
  const added =
    change.target.kind === "row"
      ? !change.before?.row
      : change.target.kind === "object"
        ? !change.before
        : !details.some((row) => row.before);
  const removed =
    change.target.kind === "row"
      ? !change.after?.row
      : change.target.kind === "object"
        ? !change.after
        : !details.some((row) => row.after);
  return {
    id: change.id,
    objectId: change.objectId,
    group: change.group,
    label: change.label,
    status: added ? "ADDED" : removed ? "REMOVED" : "MODIFIED",
    selection: discarded ? "discarded" : selection(draft, change),
    fingerprint: fingerprint(change),
    details,
  };
}
export function reviewItems(draft: DraftCommit): CommitReviewItem[] {
  const changes = reviewChanges(draft);
  const activeIds = new Set(changes.map((change) => change.id));
  return [
    ...changes.map((change) => item(draft, change)),
    ...Object.values(draft.discardedChanges ?? {})
      .filter((change) => !activeIds.has(change.id))
      .map((change) => item(draft, change, true)),
  ];
}

/** Commit exactly the selection the user reviewed, even with multiple panels. */
export function validateReviewSelection(
  draft: DraftCommit,
  expected: unknown,
): void {
  const selected = reviewItems(draft).filter(
    (item) => item.selection === "save",
  );
  if (
    !Array.isArray(expected) ||
    expected.length !== selected.length ||
    selected.some(
      (item) =>
        !expected.some(
          (entry) =>
            entry &&
            entry.id === item.id &&
            entry.fingerprint === item.fingerprint,
        ),
    )
  ) {
    throw new Error(
      "Zmiany zostały zaktualizowane w innym miejscu. Sprawdź odświeżone porównanie i zapisz ponownie.",
    );
  }
}
function setRows(
  state: LegacyStorageState,
  key: string,
  keep: (row: Row) => boolean,
  values: Row[],
): void {
  const record = state as unknown as Row;
  record[key] = [
    ...((record[key] ?? []) as Row[]).filter(keep),
    ...copy(values),
  ];
}
function ensureObject(
  state: LegacyStorageState,
  change: StoredReviewChange,
  source: LegacyStorageState,
): LegacyStoredObject {
  let object = objectFor(state, change.objectId);
  if (!object) {
    const original = objectFor(source, change.objectId);
    object = {
      id: change.objectId,
      type: change.objectType,
      values: {},
      ...(original?.createdAt ? { createdAt: original.createdAt } : {}),
    };
    state.objects.push(object);
  }
  return object;
}
function apply(
  state: LegacyStorageState,
  change: StoredReviewChange,
  side: "before" | "after",
  source: LegacyStorageState,
): void {
  const target = change.target,
    snap = change[side];
  if (target.kind === "object") {
    state.objects = state.objects.filter(
      (object) => object.id !== change.objectId,
    );
    if (snap?.object)
      state.objects.push(copy(snap.object as LegacyStoredObject));
    for (const key of ALL_ROWS)
      setRows(
        state,
        key,
        (row) => row.objectId !== change.objectId,
        ((snap?.rows as Row)?.[key] ?? []) as Row[],
      );
    return;
  }
  const object = ensureObject(state, change, source);
  if (target.kind === "field") {
    for (const [map, key] of [
      ["values", "value"],
      ["evidence", "evidence"],
      ["manualFields", "manual"],
    ] as const) {
      if (!(object as unknown as Row)[map] && !Object.hasOwn(snap ?? {}, key))
        continue;
      const record = ((object as unknown as Row)[map] ??= {}) as Row;
      if (snap && Object.hasOwn(snap, key))
        record[target.key] = copy(snap[key]);
      else delete record[target.key];
    }
  } else if (target.kind === "property") {
    if (snap && Object.hasOwn(snap, "value"))
      (object as unknown as Row)[target.key] = copy(snap.value);
    else delete (object as unknown as Row)[target.key];
  } else {
    setRows(
      state,
      target.collection!,
      (row) => row.objectId !== change.objectId || rowKey(row) !== target.key,
      snap?.row ? [snap.row as Row] : [],
    );
  }
  if (target.kind !== "property")
    for (const key of ATTACHMENTS)
      setRows(
        state,
        key,
        (row) =>
          row.objectId !== change.objectId || !attachmentMatches(row, target),
        ((snap?.attachments as Row)?.[key] ?? []) as Row[],
      );
  const primary = object.values.name ?? object.values.external_number;
  if (primary !== undefined) object.label = String(primary);
}
function retainUsedSources(
  candidate: LegacyStorageState,
  working: LegacyStorageState,
): void {
  const ids = new Set<string>(),
    keys = new Set<string>();
  const fileSources = new Set<string>();
  for (const object of candidate.objects)
    for (const values of Object.values(object.evidence ?? {}))
      for (const row of values) ids.add(row.sourceId);
  for (const row of candidate.importTargetEvidence ?? []) ids.add(row.sourceId);
  for (const row of candidate.fileSources ?? []) {
    if (row.sourceImportKey) {
      keys.add(row.sourceImportKey);
      fileSources.add(stable([row.sourceImportKey, row.url]));
    }
    if (row.sourcePageImportKey) {
      keys.add(row.sourcePageImportKey);
      fileSources.add(stable([row.sourcePageImportKey, row.sourcePageUrl]));
    }
  }
  const sources = new Map(
    (candidate.importSources ?? []).map((row) => [row.id, row]),
  );
  const committedSources = new Set(
    (candidate.importSources ?? []).map((row) =>
      stable([row.importKey, row.url]),
    ),
  );
  for (const row of working.importSources ?? [])
    if (
      ids.has(row.id) ||
      (!committedSources.has(stable([row.importKey, row.url])) &&
        (row.url
          ? fileSources.has(stable([row.importKey, row.url]))
          : keys.has(row.importKey)))
    )
      sources.set(row.id, copy(row));
  candidate.importSources = [...sources.values()];
}
export function applyReviewedChanges(draft: DraftCommit): LegacyStorageState {
  const candidate = copy(draft.baseState);
  for (const change of reviewChanges(draft))
    if (selection(draft, change) === "save")
      apply(candidate, change, "after", draft.workingState);
  retainUsedSources(candidate, draft.workingState);
  // A partial selection must not silently create an unnamed object.
  for (const object of candidate.objects)
    if (!objectFor(draft.baseState, object.id)) {
      const primary =
        object.type === "recruitment" || object.type === "nabor"
          ? "external_number"
          : "name";
      if (!object.values[primary])
        throw new Error(
          `Zaznacz nazwę nowego obiektu „${label(objectFor(draft.workingState, object.id)!)}” albo odłóż wszystkie jego zmiany.`,
        );
    }
  for (const row of candidate.geographies ?? [])
    if (
      row.operatorId &&
      !(candidate.operatorAssignments ?? []).some(
        (assignment) =>
          assignment.objectId === row.objectId &&
          assignment.operatorId === row.operatorId,
      )
    )
      throw new Error(
        "Geografia wymaga przypisania operatora. Zaznacz także zmianę operatora albo odłóż jego geografię.",
      );
  const owners = new Set(
    (candidate.operatorAssignments ?? []).map((row) => row.objectId),
  );
  for (const objectId of owners) {
    const assignments = candidate.operatorAssignments!.filter(
      (row) => row.objectId === objectId,
    );
    if (assignments.filter((row) => row.operatorType === "GLOWNY").length !== 1)
      throw new Error(
        "Obiekt musi mieć jednego operatora głównego. Zaznacz powiązane zmiany ról operatorów razem.",
      );
  }
  return candidate;
}
export function rebaseReviewedChanges(
  draft: DraftCommit,
  committed: LegacyStorageState,
): DraftCommit {
  const pending = reviewChanges(draft).filter(
    (change) => selection(draft, change) === "later",
  );
  const previous = draft.workingState;
  draft.workingState = copy(committed);
  for (const change of pending)
    apply(draft.workingState, change, "after", previous);
  // Deferred and undone edits can still refer to these snapshots.
  draft.workingState.importSources = [
    ...new Map(
      [
        ...(previous.importSources ?? []),
        ...(committed.importSources ?? []),
      ].map((row) => [row.id, row]),
    ).values(),
  ];
  draft.baseState = copy(committed);
  draft.baseRevision = committed.revision;
  draft.reviewDecisions = Object.fromEntries(
    reviewChanges(draft).map((change) => [
      change.id,
      { fingerprint: fingerprint(change), selection: "later" as const },
    ]),
  );
  return draft;
}
export function decideReviewChange(
  draft: DraftCommit,
  id: string,
  decision: string,
  expectedFingerprint?: string,
): DraftCommit {
  const changes = reviewChanges(draft);
  const change =
    changes.find((entry) => entry.id === id) ?? draft.discardedChanges?.[id];
  if (
    !change ||
    (expectedFingerprint && expectedFingerprint !== fingerprint(change))
  )
    throw new Error(
      "Ta zmiana została już zmodyfikowana. Odśwież porównanie i wybierz ją ponownie.",
    );
  draft.reviewDecisions ??= {};
  draft.discardedChanges ??= {};
  if (decision === "discard") {
    apply(draft.workingState, change, "before", draft.baseState);
    draft.discardedChanges[id] = copy(change);
    delete draft.reviewDecisions[id];
  } else if (decision === "restore") {
    if (!draft.discardedChanges[id] || changes.some((entry) => entry.id === id))
      throw new Error("Pole ma już nowszą zmianę. Sprawdź bieżące wartości.");
    apply(draft.workingState, change, "after", draft.workingState);
    delete draft.discardedChanges[id];
    const restored = reviewChanges(draft).find((entry) => entry.id === id);
    if (restored)
      draft.reviewDecisions[id] = {
        fingerprint: fingerprint(restored),
        selection: "later",
      };
  } else if (decision === "save" || decision === "later") {
    if (!changes.some((entry) => entry.id === id))
      throw new Error("Najpierw przywróć cofniętą propozycję.");
    draft.reviewDecisions[id] = {
      fingerprint: fingerprint(change),
      selection: decision,
    };
    delete draft.discardedChanges[id];
  } else throw new Error("Nieznana decyzja dotycząca zmiany.");
  return draft;
}

/** A newer edit replaces any prior rejection and must be reviewed afresh. */
export function refreshReviewDecisions(draft: DraftCommit): void {
  for (const change of reviewChanges(draft)) {
    if (draft.discardedChanges) delete draft.discardedChanges[change.id];
    const saved = draft.reviewDecisions?.[change.id];
    if (saved && saved.fingerprint !== fingerprint(change))
      delete draft.reviewDecisions![change.id];
  }
}
