import type { LegacyStorageState, LegacyStoredRule } from "../types/legacy-storage";

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function sameFundingTarget(a: LegacyStoredRule, b: LegacyStoredRule): boolean {
  return (
    a.objectId === b.objectId &&
    a.target?.kind === "funding" &&
    b.target?.kind === "funding" &&
    a.target.id === b.target.id
  );
}

function uniqueRuleId(state: LegacyStorageState, base: string): string {
  const ids = new Set(state.rules.map((rule) => rule.id));
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}:${suffix++}`;
  return id;
}

/**
 * Normalizes the short-lived refund model used before funding ranges lived on
 * each financing variant.
 *
 * - old variant `refund_percent = 60` becomes min=60 and max=60;
 * - old extraction rules are preserved for both range ends where possible;
 * - mistaken object-level Project/Recruitment refund fields are removed so the
 *   normal Workspace no longer renders a separate "Dofinansowanie" field group.
 *
 * This is intentionally revision-neutral: callers use it while hydrating a
 * stored state or draft, not as a user edit.
 */
export function normalizeFundingRanges(
  state: LegacyStorageState,
): LegacyStorageState {
  for (const row of state.financingRules ?? []) {
    const legacy = row.refund_percent;
    if (!hasValue(legacy)) continue;
    if (!hasValue(row.refund_percent_min)) row.refund_percent_min = legacy;
    if (!hasValue(row.refund_percent_max)) row.refund_percent_max = legacy;
    delete row.refund_percent;
  }

  const additions: LegacyStoredRule[] = [];
  const removals = new Set<string>();
  const legacyRules = state.rules.filter(
    (rule) => rule.target?.kind === "funding" && rule.field === "refund_percent",
  );

  for (const rule of legacyRules) {
    const original = JSON.parse(JSON.stringify(rule)) as LegacyStoredRule;
    const siblings = [...state.rules, ...additions].filter(
      (candidate) => candidate.id !== rule.id && sameFundingTarget(candidate, rule),
    );
    const hasMin = siblings.some((candidate) => candidate.field === "refund_percent_min");
    const hasMax = siblings.some((candidate) => candidate.field === "refund_percent_max");

    if (!hasMin) {
      rule.field = "refund_percent_min";
      if (!hasMax) {
        additions.push({
          ...original,
          id: uniqueRuleId(
            { ...state, rules: [...state.rules, ...additions] },
            `${String(original.id)}:refund-max`,
          ),
          field: "refund_percent_max",
        });
      }
    } else if (!hasMax) {
      rule.field = "refund_percent_max";
    } else {
      removals.add(rule.id);
    }
  }

  if (additions.length || removals.size) {
    state.rules = state.rules
      .filter((rule) => !removals.has(rule.id))
      .concat(additions);
  }

  const removedObjectFields = new Set(["refund_percent_min", "refund_percent_max"]);
  for (const object of state.objects) {
    if (object.type !== "project" && object.type !== "recruitment") continue;
    for (const field of removedObjectFields) {
      delete object.values[field];
      if (object.manualFields) delete object.manualFields[field];
      if (object.evidence) delete object.evidence[field];
    }
    if (object.manualFields && !Object.keys(object.manualFields).length) {
      delete object.manualFields;
    }
    if (object.evidence && !Object.keys(object.evidence).length) {
      delete object.evidence;
    }
  }

  state.rules = state.rules.filter(
    (rule) =>
      !(
        removedObjectFields.has(rule.field) &&
        (!rule.target || rule.target.kind === "object") &&
        state.objects.some(
          (object) =>
            object.id === rule.objectId &&
            (object.type === "project" || object.type === "recruitment"),
        )
      ),
  );

  return state;
}
