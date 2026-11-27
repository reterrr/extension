import type {
  LegacyStorageState,
  LegacyStoredRule,
} from "../types/legacy-storage";
import type {
  CommitPreview,
  FieldChange,
  FieldDefinition,
  Identity,
  ResolvedBusinessField,
  SyncState,
  ValueDefinition,
} from "./types";

import {
  entityFor,
  fieldFor,
  identityKey,
  localRecords,
  same,
  type LocalRecord,
} from "./records";

export { entityFor, identityKey, localRecords, type LocalRecord } from "./records";

export function resolveBusinessObject(sync: SyncState, identity: Identity) {
  const key = identityKey(identity);
  const found = sync.bindings.find(
    (item) => identityKey(item.identity) === key,
  );
  const entity = sync.registry && entityFor(sync.registry, identity);
  return found?.status === "SYNCED" &&
    found.businessObjectId &&
    found.businessModelId === sync.registry?.businessModelId &&
    found.businessEntityId === entity?.businessEntityId
    ? found
    : null;
}

export function resolveBusinessField(
  sync: SyncState,
  identity: Identity,
  localKey: string,
):
  | { status: "UNRESOLVED"; reason: string }
  | { status: "SYNCED"; field: ResolvedBusinessField } {
  if (!sync.registry)
    return { status: "UNRESOLVED", reason: "SCHEMA_UNAVAILABLE" };
  const object = resolveBusinessObject(sync, identity);
  if (!object?.businessObjectId)
    return { status: "UNRESOLVED", reason: "OBJECT_UNRESOLVED" };
  const definition = fieldFor(sync.registry, identity, localKey);
  if (!definition) return { status: "UNRESOLVED", reason: "FIELD_UNSUPPORTED" };
  const slot = object.objectFields[definition.persistentKey];
  if (!slot || slot.businessEntityFieldId !== definition.businessEntityFieldId)
    return { status: "UNRESOLVED", reason: "SLOT_UNRESOLVED" };
  return {
    status: "SYNCED",
    field: {
      businessModelId: object.businessModelId,
      businessEntityId: object.businessEntityId,
      businessEntityFieldId: definition.businessEntityFieldId,
      businessObjectId: object.businessObjectId,
      businessObjectFieldId: slot.businessObjectFieldId,
      fieldVersionId: definition.fieldVersionId,
      persistentKey: definition.persistentKey,
    },
  };
}

export function selectorIdentity(
  rule: LegacyStoredRule,
  records: LocalRecord[],
): Identity | null {
  const tree = rule.selectorTree;
  if (!tree) return null;
  const { objectId, target } = tree.selector.target;
  return (
    records.find(
      ({ identity }) =>
        identity.localObjectId === objectId &&
        (target && target.kind !== "object"
          ? identity.target?.kind === target.kind &&
            identity.target.id === target.id
          : !identity.target),
    )?.identity ?? null
  );
}

export function resolveSelectorTarget(
  sync: SyncState,
  rule: LegacyStoredRule,
  records: LocalRecord[],
) {
  const identity = selectorIdentity(rule, records);
  if (!identity)
    return {
      status: "OBJECT_UNRESOLVED",
      reason: "The selector target has no local identity.",
    } as const;
  const { target, ...parent } = identity;
  if (target && !resolveBusinessObject(sync, parent))
    return {
      status: "OBJECT_UNRESOLVED",
      reason: "Bind the parent business object first.",
    } as const;
  if (!resolveBusinessObject(sync, identity))
    return {
      status: "OBJECT_UNRESOLVED",
      reason: target
        ? "Bind the nested business object first."
        : "Bind the business object first.",
    } as const;
  const slot = resolveBusinessField(
    sync,
    identity,
    rule.selectorTree!.selector.target.field,
  );
  return slot.status === "UNRESOLVED"
    ? ({ status: "FIELD_UNRESOLVED", reason: slot.reason } as const)
    : ({ status: "READY", identity, field: slot.field } as const);
}

export function wireValue(
  value: unknown,
  type: ValueDefinition,
  field: FieldDefinition,
  reference: (kind: string, value: string) => string | undefined,
  source?: (value: string) => string | undefined,
): unknown {
  if (value == null || value === "") return null;
  if (type.type === "list") {
    if (!Array.isArray(value) || !type.item)
      throw new Error("COLLECTION_REQUIRED");
    return value.map((item) =>
      wireValue(item, type.item!, field, reference, source),
    );
  }
  if (type.type === "reference") {
    if (typeof value !== "string") throw new Error("LOCAL_REFERENCE_REQUIRED");
    const id = field.references && reference(field.references, value);
    if (!id) throw new Error("REFERENCE_UNRESOLVED");
    return id;
  }
  if (type.type === "source" && source) {
    const id = typeof value === "string" && source(value);
    if (!id) throw new Error("SOURCE_UNRESOLVED");
    return id;
  }
  if (type.type === "enum") {
    const proposed =
      field.aliases && Object.hasOwn(field.aliases, String(value))
        ? field.aliases[String(value)]
        : value;
    if (!type.enum_values?.includes(proposed as string | number))
      throw new Error("ENUM_VALUE_UNSUPPORTED");
    return proposed;
  }
  if (
    type.type === "decimal" &&
    (typeof value === "string" || typeof value === "number")
  )
    return String(value);
  if (
    field.localKey === "url" &&
    typeof value === "string" &&
    /^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(value)
  )
    throw new Error("LOCAL_FILE_REQUIRES_SERVER_SOURCE");
  return value;
}

export function makeCommitPreview(
  sync: SyncState,
  before: LegacyStorageState | null,
  state: LegacyStorageState,
  selected?: ReadonlySet<string>,
): CommitPreview {
  if (!sync.registry?.permissions.commit)
    return { operation: null, differences: [] };
  const records = localRecords(state);
  const reference = (kind: string, value: string) => {
    const candidates = records.filter(({ identity }) =>
      (identity.target?.kind ?? identity.localType) === kind &&
      (identity.target?.id ?? identity.localObjectId) === value,
    );
    return candidates.length === 1
      ? resolveBusinessObject(sync, candidates[0].identity)?.businessObjectId ?? undefined
      : undefined;
  };
  const previous = new Map(
    (before ? localRecords(before) : []).map((r) => [
      identityKey(r.identity),
      r,
    ]),
  );
  const changes = [];
  const skipped: NonNullable<CommitPreview["operation"]>["skipped"] = [];
  const differences: CommitPreview["differences"] = [];
  for (const { identity, values } of records) {
    const key = identityKey(identity);
    if (selected && !selected.has(key)) continue;
    const entity = entityFor(sync.registry, identity);
    const fields: FieldChange[] = [];
    const old = previous.get(key)?.values ?? {};
    const bound = resolveBusinessObject(sync, identity);
    // Only declared local field keys participate, so provenance and UI metadata stay local.
    const alias = identity.target
      ? undefined
      : sync.registry.aliases[identity.localType];
    const localKeys = alias
      ? Object.keys(alias.fields)
      : entity
        ? [
            ...entity.fields.map((field) => field.localKey),
            ...(entity.unavailableLocalKeys ?? []),
          ]
        : [...new Set([...Object.keys(old), ...Object.keys(values)])];
    for (const localKey of localKeys) {
      const proposed = values[localKey] ?? null;
      if (
        before
          ? same(old[localKey], proposed)
          : !Object.hasOwn(values, localKey)
      )
        continue;
      const definition = fieldFor(sync.registry, identity, localKey);
      if (!definition) {
        skipped.push({
          identity,
          field: localKey,
          reason: entity ? "FIELD_UNSUPPORTED" : "ENTITY_UNRESOLVED",
        });
        continue;
      }
      if (definition.readonly) continue;
      const found = resolveBusinessField(sync, identity, localKey);
      if (
        found.status === "UNRESOLVED" ||
        bound?.schemaRevisionId !== sync.registry.revisionId
      ) {
        skipped.push({
          identity,
          field: localKey,
          reason:
            found.status === "UNRESOLVED"
              ? found.reason
              : "BINDING_REFRESH_REQUIRED",
        });
        continue;
      }
      const slot = bound.objectFields[found.field.persistentKey];
      try {
        const value = wireValue(
          proposed,
          definition.definition,
          definition,
          reference,
        );
        if (same(slot.value, value)) continue;
        fields.push({
          persistentKey: found.field.persistentKey,
          businessObjectFieldId: found.field.businessObjectFieldId,
          fieldVersionId: found.field.fieldVersionId,
          expectedValueId: slot.valueId,
          ...(definition.definition.type === "list" && {
            expectedCollectionRevision: slot.collectionRevision ?? 0,
          }),
          value,
        });
        differences.push({
          identity,
          field: localKey,
          server: slot.value,
          proposed: value,
        });
      } catch (error) {
        skipped.push({
          identity,
          field: localKey,
          reason: error instanceof Error ? error.message : "UNSUPPORTED_VALUE",
        });
      }
    }
    if (fields.length && bound?.businessObjectId)
      changes.push({
        identity,
        businessObjectId: bound.businessObjectId,
        fields,
      });
  }
  if (!changes.length && !skipped.length)
    return { operation: null, differences };
  const operationId = crypto.randomUUID();
  return {
    differences,
    operation: {
      workspaceUuid: sync.workspaceUuid,
      operationId,
      localRevision: state.revision,
      skipped,
      request: changes.length
        ? {
            workspaceUuid: sync.workspaceUuid,
            schemaRevisionId: sync.registry.revisionId,
            operationId,
            changes,
          }
        : null,
    },
  };
}
