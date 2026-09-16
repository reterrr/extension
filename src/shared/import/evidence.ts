import type { BurbotObject, BurbotState } from "../types/domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectTarget(value: unknown): boolean {
  return !isRecord(value) || value.kind === undefined || value.kind === "object";
}

function clearField(object: BurbotObject | undefined, field: unknown): void {
  if (!object?.evidence || typeof field !== "string") return;
  delete object.evidence[field];
  if (Object.keys(object.evidence).length === 0) delete object.evidence;
}

/**
 * Imported evidence proves the imported value. If that object field is later
 * edited or re-extracted, the old span must not remain attached to the new value.
 */
export function discardStaleImportedEvidence(
  next: BurbotState,
  previous: BurbotState,
  message: Record<string, unknown>,
): void {
  const objectId = typeof message.objectId === "string" ? message.objectId : undefined;
  const object = objectId ? next.objects.find((entry) => entry.id === objectId) : undefined;

  if ((message.op === "ASSIGN" || message.op === "EDIT") && isObjectTarget(message.target)) {
    clearField(object, message.field);
    return;
  }

  if (message.op !== "APPLY" || !object || !Array.isArray(message.results)) return;
  for (const rawResult of message.results) {
    if (!isRecord(rawResult) || typeof rawResult.ruleId !== "string") continue;
    const rule = previous.rules.find(
      (entry) => entry.id === rawResult.ruleId && entry.objectId === object.id,
    );
    if (rule && isObjectTarget(rule.target)) clearField(object, rule.field);
  }
}
