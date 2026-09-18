import type { LegacyStorageState, LegacyStoredRule } from "../types/legacy-storage";

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneRule(rule: LegacyStoredRule): LegacyStoredRule {
  return JSON.parse(JSON.stringify(rule)) as LegacyStoredRule;
}

function uniqueRuleId(base: string, used: Set<string>): string {
  let suffix = 1;
  let candidate = `${base}:refund-max`;
  while (used.has(candidate)) candidate = `${base}:refund-max:${++suffix}`;
  used.add(candidate);
  return candidate;
}

/**
 * Migrates the old single funding refund percentage into an explicit range.
 *
 * Old `refund_percent = 60` becomes min=60, avg=60 and max=60. Extraction
 * rules are duplicated so a previously learned fixed percentage keeps all three
 * refund fields synchronized until the reviewer teaches separate rules.
 *
 * The function mutates `state` in place and returns whether anything changed.
 */
export function migrateFundingRefundRanges(state: LegacyStorageState): boolean {
  let changed = false;

  for (const row of state.financingRules ?? []) {
    if (!own(row, "refund_percent")) continue;
    const value = row.refund_percent;
    if (!own(row, "refund_percent_min")) row.refund_percent_min = value;
    if (!own(row, "refund_percent_avg")) row.refund_percent_avg = value;
    if (!own(row, "refund_percent_max")) row.refund_percent_max = value;
    delete row.refund_percent;
    changed = true;
  }

  const usedRuleIds = new Set(state.rules.map((rule) => rule.id));
  const addedRules: LegacyStoredRule[] = [];

  for (const rule of state.rules) {
    if (rule.target?.kind !== "funding" || rule.field !== "refund_percent") {
      continue;
    }

    const original = cloneRule(rule);
    rule.field = "refund_percent_min";

    const hasRule = (field: string) =>
      state.rules.some(
        (candidate) =>
          candidate !== rule &&
          candidate.objectId === rule.objectId &&
          candidate.target?.kind === "funding" &&
          candidate.target.id === rule.target?.id &&
          candidate.field === field,
      ) ||
      addedRules.some(
        (candidate) =>
          candidate.objectId === rule.objectId &&
          candidate.target?.kind === "funding" &&
          candidate.target.id === rule.target?.id &&
          candidate.field === field,
      );

    if (!hasRule("refund_percent_avg")) {
      const avgRule = cloneRule(original);
      avgRule.id = uniqueRuleId(`${rule.id}:avg`, usedRuleIds);
      avgRule.field = "refund_percent_avg";
      addedRules.push(avgRule);
    }

    if (!hasRule("refund_percent_max")) {
      const maxRule = cloneRule(original);
      maxRule.id = uniqueRuleId(rule.id, usedRuleIds);
      maxRule.field = "refund_percent_max";
      addedRules.push(maxRule);
    }
    changed = true;
  }

  if (addedRules.length) state.rules.push(...addedRules);
  return changed;
}
