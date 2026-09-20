const test = require("node:test");
const assert = require("node:assert/strict");
const { coreContext, clone, candidate } = require("./helpers.cjs");
function setup() {
  const context = coreContext(),
    C = context.BurbotCore;
  let state = C.empty(),
    id = 0;
  const mutate = (message) =>
    (state = C.mutate(
      state,
      { expectedRevision: state.revision, ...message },
      () => String(++id),
      "2026-09-15T12:00:00Z",
    ));
  const create = (
    objectType = "project",
    name = "Generator Kompetencji 3.0",
  ) => {
    mutate({
      op: "CREATE_FROM_SELECTION",
      objectType,
      initialValue: name,
      sourceUrl: "https://example.org/project",
      candidate: candidate(name),
    });
    return state.objects.at(-1);
  };
  return {
    context,
    C,
    mutate,
    create,
    get state() {
      return state;
    },
  };
}
for (const [type, primary] of [
  ["project", "name"],
  ["operator", "name"],
  ["recruitment", "external_number"],
]) {
  test(`context creation seeds ${type}.${primary} and its extraction rule atomically`, () => {
    const s = setup(),
      object = s.create(type);
    assert.equal(object.values[primary], "Generator Kompetencji 3.0");
    assert.equal(s.state.rules[0].field, primary);
    assert.equal(s.state.rules[0].objectId, object.id);
    assert.equal(s.state.rules[0].pageUrl, object.sourceUrl);
  });
}
test("existing records, extra data, IDs and old extraction keys survive new creation", () => {
  const { C } = setup();
  const old = {
    version: 1,
    revision: 8,
    custom: { keep: true },
    objects: [
      {
        id: "old-nabor",
        type: "nabor",
        label: "Old call",
        values: { title: "Old call", deadline: "2026-10-21", amount: 5000 },
      },
      {
        id: "old-operator",
        type: "operator",
        label: "Old operator",
        values: {
          name: "Old operator",
          email: "office@example.org",
          website: "https://example.org",
        },
      },
    ],
    rules: [
      {
        id: "old-rule",
        objectId: "old-nabor",
        field: "deadline",
        selector: "#date",
        extraction: { type: "text" },
        pageUrl: "https://example.org",
        sampleValue: "21.10.2026",
      },
    ],
  };
  const before = JSON.stringify(old);
  const result = C.mutate(
    old,
    {
      op: "CREATE_FROM_SELECTION",
      objectType: "project",
      initialValue: "New",
      sourceUrl: "https://example.org",
      expectedRevision: 8,
    },
    () => "new-id",
    "now",
  );
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(clone(result.objects.slice(0, 2)), old.objects);
  assert.deepEqual(clone(result.rules), old.rules);
  assert.deepEqual(clone(result.custom), old.custom);
  assert.equal(result.version, 1);
});
test("creation rejects empty text, manual CREATE, unsafe URLs and mismatching selection evidence", () => {
  const s = setup();
  for (const extra of [
    { initialValue: " " },
    { sourceUrl: "javascript:alert(1)" },
    { candidate: candidate("Different") },
    { op: "CREATE" },
  ]) {
    assert.throws(() =>
      s.mutate({
        op: "CREATE_FROM_SELECTION",
        objectType: "project",
        initialValue: "Name",
        sourceUrl: "https://example.org/project",
        ...extra,
      }),
    );
  }
  assert.equal(s.state.objects.length, 0);
});
test("selection-only fallback retains source and does not invent a replayable rule", () => {
  const s = setup();
  s.mutate({
    op: "CREATE_FROM_SELECTION",
    objectType: "operator",
    initialValue: "WUP",
    sourceUrl: "https://example.org",
  });
  assert.equal(s.state.objects[0].sourceUrl, "https://example.org/");
  assert.equal(s.state.rules.length, 0);
  assert.ok(s.state.objects[0].creationNote);
});
test("formats business values, validates enums, dates, NIP, percentages and references", () => {
  const s = setup(),
    project = s.create();
  const F = s.context.BurbotFunding.fields,
    P = s.context.BurbotSchema.project.fields;
  assert.equal(s.C.coerceField("80%", F.refund_percent, s.state), 80);
  assert.equal(
    s.C.coerceField("100 000 PLN", F.max_amount_pln, s.state),
    100000,
  );
  assert.throws(() => s.C.coerceField("100 USD", F.max_amount_pln, s.state));
  assert.throws(() => s.C.coerceField("80 PLN", F.refund_percent, s.state));
  assert.match(
    s.C.formatValue(100000, F.max_amount_pln, s.state),
    /100\s000 PLN/,
  );
  assert.equal(s.C.coerceField("Active", P.status, s.state), "ACTIVE");
  assert.equal(
    s.C.coerceField("21.10.2026", P.start_date, s.state),
    "2026-10-21",
  );
  assert.throws(() => s.C.coerceField("31.02.2026", P.start_date, s.state));
  assert.throws(() => s.C.coerceField("101%", F.refund_percent, s.state));
  assert.throws(() => s.C.coerceField("Unknown", P.type, s.state));
  assert.equal(
    s.C.coerceField("012-345-67-89", { type: "nip" }, s.state),
    "0123456789",
  );
  assert.equal(s.C.coerceField("false", { type: "boolean" }, s.state), false);
  const recruitment = s.context.BurbotSchema.recruitment.fields;
  assert.equal(recruitment.operator_id.references, "operator");
  assert.equal(recruitment.planned_start_date.type, "date");
  assert.equal(recruitment.documents_url.type, "url");
  assert.equal(recruitment.funding_rules.multiline, true);
  assert.equal(
    s.C.coerceField("true", recruitment.continuous, s.state),
    true,
  );
  assert.equal(recruitment.last_checked_at.system, true);
  assert.equal(recruitment.last_checked_at.readonly, true);
  assert.match(
    s.C.formatValue(
      "2026-09-18T08:30:00.000Z",
      recruitment.last_checked_at,
      s.state,
    ),
    /2026/,
  );
  assert.equal(s.context.BurbotFunding.sizes.B2C, "B2C / osoba dorosła");
  assert.equal(
    s.C.coerceField("95%", F.refund_percent_base, s.state),
    95,
  );
  assert.equal(
    s.C.coerceField("5%", F.own_contribution_percent_standard, s.state),
    5,
  );
  assert.equal(
    s.C.coerceField(
      project.values.name,
      { type: "reference", references: "project" },
      s.state,
    ),
    project.id,
  );
  assert.throws(() => s.C.coerceField("__proto__", P.status, s.state));
});
test("changed selections are re-extracted between anchors; missing and ambiguous context fail", () => {
  const { C } = setup();
  assert.equal(
    C.selectedText("Applications close on 15.11.2026. Apply now.", {
      prefix: "Applications close on ",
      suffix: ". Apply now.",
    }),
    "15.11.2026",
  );
  assert.throws(() =>
    C.selectedText("No date here", { prefix: "Date: ", suffix: "" }),
  );
  assert.throws(() =>
    C.selectedText("Date: one. Date: two.", { prefix: "Date: ", suffix: "." }),
  );
});
test("manual correction retains evidence and applies only to the exact observed sample", () => {
  const s = setup(),
    object = s.create();
  s.mutate({
    op: "ASSIGN",
    objectId: object.id,
    field: "number",
    candidate: candidate("Code: ABC"),
    value: "ABC",
  });
  const rule = s.state.rules.find((r) => r.field === "number");
  assert.equal(rule.sampleValue, "Code: ABC");
  assert.equal(s.C.ruleValue(s.state, object, rule, "Code: ABC"), "ABC");
  assert.equal(s.C.ruleValue(s.state, object, rule, "Code: XYZ"), "Code: XYZ");
  s.mutate({
    op: "EDIT",
    objectId: object.id,
    field: "number",
    value: "ABC-1",
  });
  assert.equal(s.state.rules.find((r) => r.id === rule.id).selector, "#name");
});
test("funding variants remain independent and have separately targeted extraction rules", () => {
  const s = setup(),
    object = s.create();
  for (const size of ["MICRO", "MICRO", "SMALL"])
    s.mutate({ op: "ADD_FUNDING", objectId: object.id, companySize: size });
  assert.deepEqual(
    s.state.financingRules.map((r) => r.variant_no).join(","),
    "1,2,1",
  );
  const [a, b] = s.state.financingRules;
  for (const [row, raw] of [
    [a, "80%"],
    [b, "70%"],
  ])
    s.mutate({
      op: "ASSIGN",
      objectId: object.id,
      field: "refund_percent",
      target: { kind: "funding", id: row.id },
      candidate: candidate(raw),
    });
  assert.equal(
    s.state.rules.filter((r) => r.field === "refund_percent").length,
    2,
  );
  s.mutate({ op: "REMOVE_FUNDING", objectId: object.id, variantId: a.id });
  assert.equal(
    s.state.rules.filter((r) => r.field === "refund_percent").length,
    1,
  );
  assert.equal(
    s.state.financingRules.find((r) => r.id === b.id).refund_percent,
    70,
  );
});
test("document requirements and auto-fill belong to each object, not the catalog", () => {
  const s = setup(),
    a = s.create("project", "A"),
    b = s.create("project", "B");
  const target = { kind: "document", id: "msp_application_form" };
  s.mutate({
    op: "EDIT",
    objectId: a.id,
    target,
    field: "requirement",
    value: "REQUIRED",
  });
  s.mutate({
    op: "EDIT",
    objectId: a.id,
    target,
    field: "auto_fill",
    value: true,
  });
  s.mutate({
    op: "EDIT",
    objectId: b.id,
    target,
    field: "requirement",
    value: "OPTIONAL",
  });
  assert.equal(
    s.state.documentRequirements.find((r) => r.objectId === a.id).auto_fill,
    true,
  );
  assert.equal(
    s.state.documentRequirements.find((r) => r.objectId === b.id).requirement,
    "OPTIONAL",
  );
  assert.equal(s.context.BurbotDocuments.catalog[0].requirement, undefined);
});
test("stale writes and failed re-extraction batches leave the original snapshot untouched", () => {
  const s = setup(),
    object = s.create(),
    before = JSON.stringify(s.state);
  assert.throws(() =>
    s.mutate({
      op: "EDIT",
      objectId: object.id,
      field: "name",
      value: "bad",
      expectedRevision: 0,
    }),
  );
  assert.throws(() =>
    s.mutate({
      op: "APPLY",
      objectId: object.id,
      results: [
        { ruleId: s.state.rules[0].id, raw: "Updated" },
        { ruleId: "missing", raw: "bad" },
      ],
    }),
  );
  assert.equal(JSON.stringify(s.state), before);
});
test("deleting an object removes only its own configuration and rules", () => {
  const s = setup(),
    a = s.create("project", "A"),
    b = s.create("project", "B");
  s.mutate({ op: "ADD_FUNDING", objectId: a.id, companySize: "MICRO" });
  s.mutate({
    op: "EDIT",
    objectId: a.id,
    target: { kind: "document", id: "krs_ceidg" },
    field: "requirement",
    value: "OPTIONAL",
  });
  s.mutate({ op: "DELETE", objectId: a.id });
  assert.equal(s.state.objects.length, 1);
  assert.equal(s.state.objects[0].id, b.id);
  assert.equal(s.state.financingRules.length, 0);
  assert.equal(s.state.documentRequirements.length, 0);
  assert.equal(s.state.rules.length, 1);
  assert.equal(s.state.rules[0].objectId, b.id);
});
