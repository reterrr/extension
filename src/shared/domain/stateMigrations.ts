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



const PLANNED_RECRUITMENT_RANGE_FIELDS = [
  ["planned_start_date", "planned_start_low_date", "planned_start_ceil_date"],
  ["planned_start_time", "planned_start_low_time", "planned_start_ceil_time"],
  ["planned_end_date", "planned_end_low_date", "planned_end_ceil_date"],
  ["planned_end_time", "planned_end_low_time", "planned_end_ceil_time"],
  ["planowanyStartRok", "planned_start_low_year", "planned_start_ceil_year"],
  ["planowanyStartMiesiac", "planned_start_low_month", "planned_start_ceil_month"],
  ["planowanyStartTydzien", "planned_start_low_week", "planned_start_ceil_week"],
  ["planowanyStartKwartal", "planned_start_low_quarter", "planned_start_ceil_quarter"],
  ["planowanyKoniecRok", "planned_end_low_year", "planned_end_ceil_year"],
  ["planowanyKoniecMiesiac", "planned_end_low_month", "planned_end_ceil_month"],
  ["planowanyKoniecTydzien", "planned_end_low_week", "planned_end_ceil_week"],
  ["planowanyKoniecKwartal", "planned_end_low_quarter", "planned_end_ceil_quarter"],
] as const;

function uniqueMigrationRuleId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}:${++suffix}`;
  used.add(candidate);
  return candidate;
}

/**
 * Converts the previous one-value planned recruitment model into bounded
 * floor/ceil ranges. A previously exact value becomes a collapsed range
 * (floor === ceil), so existing data keeps the same meaning.
 */
export function migratePlannedRecruitmentRanges(
  state: LegacyStorageState,
): boolean {
  let changed = false;

  for (const object of state.objects) {
    if (object.type !== "recruitment") continue;
    const values = object.values ?? {};

    for (const [legacy, low, ceil] of PLANNED_RECRUITMENT_RANGE_FIELDS) {
      const value = values[legacy];
      if (value === undefined || value === null || value === "") continue;
      if (!own(values, low)) {
        values[low] = value;
        changed = true;
      }
      if (!own(values, ceil)) {
        values[ceil] = value;
        changed = true;
      }
    }
  }

  const objectTypes = new Map(
    state.objects.map((object) => [object.id, object.type]),
  );
  const usedRuleIds = new Set(state.rules.map((rule) => rule.id));
  const addedRules: LegacyStoredRule[] = [];

  for (const rule of state.rules) {
    if (objectTypes.get(rule.objectId) !== "recruitment" || rule.target) continue;
    const mapping = PLANNED_RECRUITMENT_RANGE_FIELDS.find(
      ([legacy]) => legacy === rule.field,
    );
    if (!mapping) continue;

    const [, low, ceil] = mapping;
    for (const field of [low, ceil]) {
      const exists =
        state.rules.some(
          (candidate) =>
            candidate.objectId === rule.objectId &&
            !candidate.target &&
            candidate.field === field,
        ) ||
        addedRules.some(
          (candidate) =>
            candidate.objectId === rule.objectId &&
            !candidate.target &&
            candidate.field === field,
        );
      if (exists) continue;

      const copy = cloneRule(rule);
      copy.id = uniqueMigrationRuleId(
        `${rule.id}:planned-range:${field}`,
        usedRuleIds,
      );
      copy.field = field;
      addedRules.push(copy);
      changed = true;
    }
  }

  if (addedRules.length) state.rules.push(...addedRules);
  return changed;
}

function splitContactValues(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[;\n\r]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function migratedContactId(
  objectId: string,
  kind: "EMAIL" | "PHONE",
  index: number,
  usedIds: Set<string>,
): string {
  const base = `migration:${objectId}:${kind.toLowerCase()}:${index + 1}`;
  let candidate = base;
  let suffix = 1;
  while (usedIds.has(candidate)) candidate = `${base}:${++suffix}`;
  usedIds.add(candidate);
  return candidate;
}

/**
 * Normalizes the recruitment status vocabulary and moves legacy single
 * operator email/phone fields into first-class contact variants.
 */
export function migrateRecruitmentStatusesAndOperatorContacts(
  state: LegacyStorageState,
): boolean {
  let changed = false;

  for (const object of state.objects) {
    if (
      object.type === "recruitment" &&
      object.values?.status === "ZAKONCZONY"
    ) {
      object.values.status = "ZAMKNIETY";
      changed = true;
    }
  }

  const contacts = (state.operatorContacts ||= []);
  const signatures = new Set(
    contacts.map(
      (row) =>
        `${row.objectId}\u0000${row.kind}\u0000${String(row.value).trim().toLowerCase()}`,
    ),
  );
  const usedIds = new Set(contacts.map((row) => row.id));

  for (const object of state.objects) {
    if (object.type !== "operator") continue;

    const legacy = [
      ["EMAIL", object.values?.email],
      ["PHONE", object.values?.phone ?? object.values?.telefon],
    ] as const;

    for (const [kind, raw] of legacy) {
      const values = splitContactValues(raw);
      let nextVariant =
        Math.max(
          0,
          ...contacts
            .filter((row) => row.objectId === object.id && row.kind === kind)
            .map((row) => Number(row.variant_no) || 0),
        ) + 1;

      values.forEach((value, index) => {
        const signature =
          `${object.id}\u0000${kind}\u0000${value.toLowerCase()}`;
        if (signatures.has(signature)) return;
        contacts.push({
          id: migratedContactId(object.id, kind, index, usedIds),
          objectId: object.id,
          kind,
          variant_no: nextVariant++,
          value,
        });
        signatures.add(signature);
        changed = true;
      });
    }
  }

  return changed;
}


function migratedAssignmentId(
  objectId: string,
  operatorId: string,
  used: Set<string>,
): string {
  const base = `migration:${objectId}:operator:${operatorId}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}:${++suffix}`;
  used.add(candidate);
  return candidate;
}

/**
 * Migrates the legacy single `values.operator_id` reference into first-class
 * many-to-many operator assignments.
 *
 * Recruitment geography is operator-scoped. Legacy recruitment geography can
 * be assigned automatically only when that recruitment resolves to exactly one
 * operator; otherwise it remains unscoped and the UI asks the user to classify it.
 */
export function migrateMultiOperatorAssignments(
  state: LegacyStorageState,
): boolean {
  let changed = false;
  const assignments = (state.operatorAssignments ||= []);
  const usedIds = new Set(assignments.map((row) => row.id));

  for (const object of state.objects) {
    if (object.type !== "project" && object.type !== "recruitment") continue;
    const legacyOperatorId =
      typeof object.values?.operator_id === "string"
        ? object.values.operator_id
        : "";
    if (!legacyOperatorId) continue;

    const exists = assignments.some(
      (row) =>
        row.objectId === object.id &&
        row.operatorId === legacyOperatorId,
    );
    if (!exists) {
      assignments.push({
        id: migratedAssignmentId(object.id, legacyOperatorId, usedIds),
        objectId: object.id,
        operatorId: legacyOperatorId,
        operatorType: "GLOWNY",
      });
      changed = true;
    }

    delete object.values.operator_id;
    if (object.manualFields?.operator_id) {
      delete object.manualFields.operator_id;
      changed = true;
    }
    changed = true;
  }

  const assignmentOperatorsByObject = new Map<string, string[]>();
  for (const row of assignments) {
    const list = assignmentOperatorsByObject.get(row.objectId) ?? [];
    if (!list.includes(row.operatorId)) list.push(row.operatorId);
    assignmentOperatorsByObject.set(row.objectId, list);
  }

  const objectTypeById = new Map(
    state.objects.map((object) => [object.id, object.type]),
  );
  for (const row of state.geographies ?? []) {
    if (objectTypeById.get(row.objectId) !== "recruitment") continue;
    if (row.operatorId) continue;
    const operators = assignmentOperatorsByObject.get(row.objectId) ?? [];
    if (operators.length === 1) {
      row.operatorId = operators[0];
      changed = true;
    }
  }

  return changed;
}
