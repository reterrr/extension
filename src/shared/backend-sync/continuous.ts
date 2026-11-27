import {
  continuousLocal,
  resolveRemoteObject,
  submitCommit,
  SyncError,
} from "./client";
import { entityFor, fieldFor, identityKey, same } from "./records";
import { wireValue } from "./resolve";
import type {
  CommitRequest,
  ContinuousJob,
  ContinuousStatus,
  FieldChange,
  OperationResult,
  ResolvedBusinessObject,
  Slot,
  SyncDependency,
  SyncSettings,
  ValueDefinition,
} from "./types";

class ReviewRequired extends Error {
  constructor(
    readonly status: "CONFLICT" | "BLOCKED",
    readonly code: string,
  ) {
    super(code);
  }
}

function sameHead(left: Slot | null, right: Slot | null) {
  return (
    left === right ||
    (left &&
      right &&
      left.businessObjectFieldId === right.businessObjectFieldId &&
      left.fieldVersionId === right.fieldVersionId &&
      left.valueId === right.valueId &&
      (left.collectionRevision ?? 0) === (right.collectionRevision ?? 0))
  );
}

function decimalKey(value: unknown) {
  if (typeof value !== "string") return value;
  const number = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!number) return value;
  const fraction = number[3] ?? "";
  const digits = (number[2] + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const exponent =
    Number(number[4] ?? 0) +
    digits.length -
    significant.length -
    fraction.length;
  return `${number[1] === "-" ? "-" : ""}${significant}e${exponent}`;
}

function sameValue(type: ValueDefinition, current: unknown, proposed: unknown) {
  return type.type === "decimal"
    ? decimalKey(current) === decimalKey(proposed)
    : same(current, proposed);
}

type Prepared = {
  request: CommitRequest | null;
  object: ResolvedBusinessObject;
  anchors: Record<string, Slot | null>;
};

function checkIdentity(job: ContinuousJob, current: ResolvedBusinessObject) {
  const { intent, registry } = job;
  if (current.schemaRevisionId !== registry.revisionId)
    throw new ReviewRequired("CONFLICT", "SCHEMA_REVISION_CHANGED");
  const key = identityKey(intent.identity);
  const expected =
    intent.boundObjectId ?? job.resolved[JSON.stringify(["identity", key])];
  if (
    current.businessModelId !== registry.businessModelId ||
    current.businessEntityId !==
      entityFor(registry, intent.identity)?.businessEntityId ||
    identityKey(current.identity) !== key ||
    (expected && current.businessObjectId !== expected)
  )
    throw new ReviewRequired("CONFLICT", "OBJECT_BINDING_CHANGED");
}

async function reconcileIdentity(
  settings: SyncSettings,
  job: ContinuousJob,
  signal: AbortSignal,
): Promise<Outcome> {
  const { intent, registry, workspaceUuid } = job;
  const preview = await resolveRemoteObject(
    settings,
    workspaceUuid,
    intent.identity,
    "preview",
    undefined,
    signal,
  );
  checkIdentity(job, preview);
  const resolution = intent.resolution;
  const existing =
    resolution?.action === "bind"
      ? resolution.existingBusinessObjectId
      : undefined;
  if (preview.businessObjectId && preview.status === "SYNCED") {
    if (existing && existing !== preview.businessObjectId)
      throw new ReviewRequired("CONFLICT", "OBJECT_BINDING_CHANGED");
    return { status: "SYNCED", result: { object: preview } };
  }
  if (preview.status !== "LOCAL_ONLY" || preview.businessObjectId)
    throw new ReviewRequired(
      "CONFLICT",
      preview.reason ?? "OBJECT_BINDING_CHANGED",
    );
  if (
    !resolution &&
    (!intent.canCreate ||
      preview.reason ||
      registry.revisionId !== intent.schemaRevisionId)
  )
    throw new ReviewRequired(
      "BLOCKED",
      preview.reason || "IDENTITY_REVIEW_REQUIRED",
    );
  const action = resolution?.action ?? "create";
  if (action === "create" && !registry.permissions.create)
    throw new ReviewRequired("BLOCKED", "CREATE_PERMISSION_REQUIRED");
  if (action === "bind" && !registry.permissions.bindExisting)
    throw new ReviewRequired("BLOCKED", "BIND_PERMISSION_REQUIRED");
  if (!resolution && job.missing)
    return { status: "WAITING_DEPENDENCY", result: job.missing };
  const object = await resolveRemoteObject(
    settings,
    workspaceUuid,
    intent.identity,
    action,
    existing,
    signal,
    registry.revisionId,
  );
  checkIdentity(job, object);
  if (
    !object.businessObjectId ||
    object.status !== "SYNCED" ||
    (existing && object.businessObjectId !== existing)
  )
    throw new ReviewRequired("BLOCKED", "IDENTITY_REVIEW_REQUIRED");
  return { status: "SYNCED", result: { object } };
}

async function prepare(
  settings: SyncSettings,
  job: ContinuousJob,
  signal: AbortSignal,
): Promise<Prepared> {
  const { intent, registry, workspaceUuid } = job;
  if (registry.revisionId !== intent.schemaRevisionId)
    throw new ReviewRequired("CONFLICT", "SCHEMA_REVISION_CHANGED");
  if (!registry.permissions.commit)
    throw new ReviewRequired("BLOCKED", "COMMIT_PERMISSION_REQUIRED");
  const entity = entityFor(registry, intent.identity);
  if (!entity)
    throw new ReviewRequired("CONFLICT", "ENTITY_DEFINITION_UNRESOLVED");

  const planned = intent.fields.map(({ localKey, persistentKey, value }) => {
    const definition = fieldFor(registry, intent.identity, localKey);
    if (!definition || definition.persistentKey !== persistentKey)
      throw new ReviewRequired("CONFLICT", "FIELD_UNSUPPORTED");
    try {
      const lookup = (kind: string, id: string) =>
        job.resolved[JSON.stringify([kind, id])];
      const wire = wireValue(
        value,
        definition.definition,
        definition,
        lookup,
        (id) => lookup("source", id),
      );
      return { definition, wire };
    } catch (error) {
      throw new ReviewRequired(
        "BLOCKED",
        error instanceof Error ? error.message : "UNSUPPORTED_VALUE",
      );
    }
  });

  const current = await resolveRemoteObject(
    settings,
    workspaceUuid,
    intent.identity,
    "preview",
    undefined,
    signal,
  );
  checkIdentity(job, current);
  if (!current.businessObjectId || current.status !== "SYNCED")
    throw new ReviewRequired("BLOCKED", "IDENTITY_REVIEW_REQUIRED");

  const fields: FieldChange[] = [];
  const anchors: Prepared["anchors"] = {};
  for (const { definition, wire } of planned) {
    const key = definition.persistentKey;
    const slot = current.objectFields[key];
    if (!slot || slot.fieldVersionId !== definition.fieldVersionId)
      throw new ReviewRequired("CONFLICT", "FIELD_BINDING_CHANGED");
    const pin = intent.heads[key] ?? null;
    const prior = job.confirmed[key];
    const inherited =
      prior && (sameHead(pin, prior.from) || sameHead(pin, prior.to));
    const expected = inherited ? prior.to : pin;
    anchors[key] = inherited ? prior.from : pin;
    if (sameValue(definition.definition, slot.value, wire)) continue;
    const empty =
      slot.valueId === null &&
      (slot.collectionRevision ?? 0) === 0 &&
      (slot.value == null ||
        (Array.isArray(slot.value) && slot.value.length === 0));
    if (expected ? !sameHead(expected, slot) : !empty)
      throw new ReviewRequired("CONFLICT", "CANONICAL_VALUE_CHANGED");
    fields.push({
      persistentKey: key,
      businessObjectFieldId: slot.businessObjectFieldId,
      fieldVersionId: slot.fieldVersionId,
      expectedValueId: slot.valueId,
      ...(definition.definition.type === "list" && {
        expectedCollectionRevision: slot.collectionRevision ?? 0,
      }),
      value: wire,
    });
  }
  return {
    anchors,
    object: current,
    request: fields.length
      ? {
          workspaceUuid,
          operationId: intent.operationId,
          schemaRevisionId: intent.schemaRevisionId,
          changes: [
            {
              identity: intent.identity,
              businessObjectId: current.businessObjectId,
              fields,
            },
          ],
        }
      : null,
  };
}

type Outcome = {
  status: ContinuousStatus;
  result: OperationResult & {
    confirmed?: ContinuousJob["confirmed"];
    dependencies?: SyncDependency[];
  };
};

function failed(error: unknown): Outcome {
  if (error instanceof ReviewRequired)
    return { status: error.status, result: { code: error.code } };
  if (error instanceof SyncError) {
    if (error.status >= 500 || [408, 425, 429].includes(error.status))
      return {
        status: "RETRY_PENDING",
        result: { code: error.detail.code ?? "BACKEND_UNAVAILABLE" },
      };
    return {
      status: error.status === 409 ? "CONFLICT" : "BLOCKED",
      result: { code: error.detail.code ?? `BACKEND_HTTP_${error.status}` },
    };
  }
  return {
    status:
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError")
        ? "RETRY_PENDING"
        : "BLOCKED",
    result: {
      code:
        error instanceof TypeError
          ? "BACKEND_UNAVAILABLE"
          : "BACKEND_RESPONSE_INVALID",
    },
  };
}

function synced(
  job: ContinuousJob,
  object: ResolvedBusinessObject,
  anchors: Prepared["anchors"],
): Outcome {
  const confirmed = { ...job.confirmed };
  for (const [key, from] of Object.entries(anchors))
    if (object.objectFields[key])
      confirmed[key] = { from, to: object.objectFields[key] };
  return { status: "SYNCED", result: { object, confirmed } };
}

async function processJob(
  settings: SyncSettings,
  job: ContinuousJob,
  signal: AbortSignal,
) {
  const { workspaceUuid, leaseId, intent } = job;
  const scope = {
    origin: settings.origin,
    workspaceUuid,
    leaseId,
    operationId: intent.operationId,
  };
  const finish = (outcome: Outcome) =>
    continuousLocal("finish", { ...scope, ...outcome });
  try {
    signal.throwIfAborted();
    if (job.kind === "identity") {
      let outcome: Outcome;
      try {
        outcome = await reconcileIdentity(settings, job, signal);
      } catch (error) {
        signal.throwIfAborted();
        outcome = failed(error);
        if (outcome.status === "BLOCKED" && job.missing?.dependencies)
          outcome.result.dependencies = job.missing.dependencies;
      }
      signal.throwIfAborted();
      return await finish(outcome);
    }
    let { request, anchors } = intent;
    if (!request) {
      let plan: Prepared;
      try {
        plan = await prepare(settings, job, signal);
      } catch (error) {
        signal.throwIfAborted();
        return await finish(failed(error));
      }
      signal.throwIfAborted();
      if (!plan.request)
        return await finish(synced(job, plan.object, plan.anchors));
      request = plan.request;
      anchors = plan.anchors;
      await continuousLocal("prepare", { ...scope, ...plan });
    }
    let outcome: Outcome;
    try {
      signal.throwIfAborted();
      const receipt = await submitCommit(settings, request, signal);
      const expected = request.changes[0].businessObjectId;
      const object = receipt.objects?.find(
        (entry) =>
          entry.businessObjectId === expected &&
          identityKey(entry.identity) === identityKey(intent.identity),
      );
      if (!object || receipt.operationId !== request.operationId)
        throw new ReviewRequired("BLOCKED", "BACKEND_RESPONSE_INVALID");
      outcome = synced(job, object, anchors ?? {});
    } catch (error) {
      signal.throwIfAborted();
      outcome = failed(error);
    }
    await finish(outcome);
  } catch (error) {
    // If the receipt was lost or SQLite stopped after dispatch, the prepared request stays in the outbox.
    await continuousLocal("release", scope).catch(() => undefined);
    if (!signal.aborted) throw error;
  }
}

export async function syncContinuousBatch(
  settings: SyncSettings,
  manual: boolean,
  signal: AbortSignal,
) {
  const limit = 20;
  signal.throwIfAborted();
  const discovery = await continuousLocal<{ more: boolean; scanned: number }>(
    "scan",
    { origin: settings.origin, manual },
  );
  let processed = 0;
  let changed = discovery.scanned > 0;
  while (processed < limit && !signal.aborted) {
    const { job, retryAt, progressed } = await continuousLocal<{
      job: ContinuousJob | null;
      retryAt: number | null;
      progressed?: boolean;
    }>("claim", { origin: settings.origin, manual });
    if (!job)
      return {
        more: retryAt == null ? discovery.more : retryAt <= Date.now(),
        retryAt,
        processed,
        changed: changed || Boolean(progressed),
      };
    await processJob(settings, job, signal);
    processed++;
    changed = true;
  }
  return { more: !signal.aborted, retryAt: null, processed, changed };
}
