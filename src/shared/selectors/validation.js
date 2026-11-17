const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
function text(value, name) {
  requireValue(
    typeof value === "string" && value.length > 0,
    `${name} must be a nonempty string.`,
  );
}
function uuid(value) {
  requireValue(
    typeof value === "string" && UUID_PATTERN.test(value),
    "Invalid selector UUID.",
  );
}
function keys(value, allowed) {
  requireValue(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Unexpected field in selector definition.",
  );
}
function quote(value) {
  requireValue(record(value), "Invalid text quote.");
  keys(value, ["exact", "prefix", "suffix"]);
  text(value.exact, "quote.exact");
  for (const key of ["prefix", "suffix"])
    requireValue(
      value[key] === undefined || typeof value[key] === "string",
      `Invalid quote.${key}.`,
    );
}
function path(value) {
  requireValue(
    record(value) &&
      value.root === "document" &&
      Array.isArray(value.segments) &&
      value.segments.length > 0,
    "Invalid DOM path payload.",
  );
  for (const segment of value.segments) {
    text(segment?.tagName, "tagName");
    requireValue(
      Number.isInteger(segment.siblingIndex) && segment.siblingIndex >= 0,
      "Invalid sibling index.",
    );
  }
}
function position(value) {
  requireValue(
    record(value) &&
      Number.isSafeInteger(value.start) &&
      value.start >= 0 &&
      Number.isSafeInteger(value.end) &&
      value.end > value.start,
    "Invalid text position.",
  );
  const coordinates = value.coordinates;
  requireValue(
    record(coordinates) &&
      ["raw_html", "rendered_dom_text"].includes(coordinates.representation) &&
      ["unicode_codepoint", "utf16_code_unit", "utf8_byte"].includes(
        coordinates.offsetUnit,
      ),
    "Text positions require representation and coordinate units.",
  );
  text(coordinates.representationVersion, "representationVersion");
  requireValue(
    coordinates.contentHash?.algorithm === "sha256" &&
      /^[a-f0-9]{64}$/i.test(coordinates.contentHash.value),
    "Text positions require a SHA-256 representation hash.",
  );
}

export function validateLocator(locator) {
  requireValue(record(locator), "Invalid locator.");
  uuid(locator.uuid);
  requireValue(
    Number.isSafeInteger(locator.order) && locator.order >= 0,
    "Invalid locator order.",
  );
  const payloadField = {
    css_path: "selector",
    xpath: "expression",
    element_id: "elementId",
    text_quote: "quote",
    dom_path: "payload",
    dom_range: "payload",
    exact_pos: "payload",
    text_position: "payload",
    text_fragment: "payload",
  }[locator.kind];
  keys(locator, ["uuid", "order", "kind", payloadField]);
  switch (locator.kind) {
    case "css_path":
      text(locator.selector, "selector");
      break;
    case "xpath":
      text(locator.expression, "expression");
      break;
    case "element_id":
      text(locator.elementId, "elementId");
      break;
    case "text_quote":
      quote(locator.quote);
      break;
    case "dom_path":
      path(locator.payload);
      break;
    case "dom_range":
      requireValue(
        record(locator.payload) &&
          locator.payload.offsetUnit === "utf16_code_unit",
        "Invalid DOM range units.",
      );
      for (const boundary of [locator.payload.start, locator.payload.end]) {
        requireValue(
          record(boundary) &&
            Number.isSafeInteger(boundary.offset) &&
            boundary.offset >= 0 &&
            Number.isSafeInteger(boundary.textNodeIndex) &&
            boundary.textNodeIndex >= 0,
          "Invalid DOM range boundary.",
        );
        path(boundary.path);
      }
      break;
    case "exact_pos":
      position(locator.payload);
      text(locator.payload.exact, "exact");
      break;
    case "text_position":
      position(locator.payload);
      break;
    case "text_fragment":
      requireValue(record(locator.payload), "Invalid text fragment payload.");
      text(locator.payload.textStart, "textStart");
      for (const key of ["textEnd", "prefix", "suffix"])
        requireValue(
          locator.payload[key] === undefined ||
            typeof locator.payload[key] === "string",
          `Invalid text fragment ${key}.`,
        );
      break;
    default:
      throw new Error(`Unknown locator kind: ${locator.kind}.`);
  }
}

/** Runtime validation is shared by imports, SQLite writes and the draft editor. */
export function validateSelectorTree(tree) {
  requireValue(
    record(tree) && record(tree.selector) && Array.isArray(tree.versions),
    "Invalid selector tree.",
  );
  const selector = tree.selector;
  keys(tree, ["selector", "versions"]);
  keys(selector, [
    "uuid",
    "target",
    "sourceUuid",
    "pageUrl",
    "activeVersionUuid",
    "createdAt",
    "migration",
  ]);
  uuid(selector.uuid);
  requireValue(record(selector.target), "Invalid selector target.");
  keys(selector.target, ["objectId", "field", "target"]);
  text(selector.target.objectId, "objectId");
  text(selector.target.field, "field");
  if (selector.target.target !== undefined) {
    keys(selector.target.target, ["kind", "id"]);
    text(selector.target.target?.kind, "target.kind");
    text(selector.target.target?.id, "target.id");
  }
  if (selector.sourceUuid !== undefined) uuid(selector.sourceUuid);
  if (selector.pageUrl !== undefined) text(selector.pageUrl, "pageUrl");
  if (selector.migration !== undefined) {
    requireValue(
      record(selector.migration) &&
        selector.migration.provenance === "unverified",
      "Invalid migration provenance.",
    );
    keys(selector.migration, ["legacyRuleId", "provenance"]);
    text(selector.migration.legacyRuleId, "legacyRuleId");
  }
  text(selector.createdAt, "createdAt");
  requireValue(
    !Number.isNaN(Date.parse(selector.createdAt)),
    "Invalid creation date.",
  );
  const ids = new Set([selector.uuid]);
  const addId = (id) => {
    uuid(id);
    requireValue(!ids.has(id), "Duplicate UUID in selector tree.");
    ids.add(id);
  };
  const ordered = (items, name) => {
    requireValue(
      Array.isArray(items) && items.length > 0,
      `${name} cannot be empty.`,
    );
    const orders = new Set();
    for (const item of items) {
      addId(item?.uuid);
      requireValue(
        Number.isSafeInteger(item.order) &&
          item.order >= 0 &&
          !orders.has(item.order),
        `Invalid or duplicate ${name} order.`,
      );
      orders.add(item.order);
    }
  };
  const numbers = new Set();
  requireValue(tree.versions.length > 0, "Selector must have a version.");
  for (const version of tree.versions) {
    addId(version?.uuid);
    keys(version, [
      "uuid",
      "selectorUuid",
      "versionNo",
      "status",
      "createdFromSnapshotUuid",
      "artifactType",
      "recipes",
      "createdAt",
      "reviewedAt",
      "reviewedBy",
    ]);
    requireValue(
      version.selectorUuid === selector.uuid,
      "Version belongs to another selector.",
    );
    requireValue(
      Number.isSafeInteger(version.versionNo) &&
        version.versionNo > 0 &&
        !numbers.has(version.versionNo),
      "Invalid or duplicate version number.",
    );
    numbers.add(version.versionNo);
    requireValue(
      ["draft", "active", "superseded", "rejected"].includes(version.status),
      "Invalid version status.",
    );
    requireValue(
      typeof version.createdAt === "string" &&
        !Number.isNaN(Date.parse(version.createdAt)),
      "Invalid version creation date.",
    );
    if (version.reviewedAt !== undefined)
      requireValue(
        typeof version.reviewedAt === "string" &&
          !Number.isNaN(Date.parse(version.reviewedAt)),
        "Invalid review date.",
      );
    if (version.reviewedBy !== undefined)
      text(version.reviewedBy, "reviewedBy");
    if (version.createdFromSnapshotUuid != null)
      uuid(version.createdFromSnapshotUuid);
    requireValue(
      version.artifactType == null ||
        ["raw_html", "rendered_dom"].includes(version.artifactType),
      "Invalid artifact type.",
    );
    ordered(version.recipes, "recipe");
    for (const recipe of version.recipes) {
      keys(recipe, ["uuid", "order", "parts"]);
      ordered(recipe.parts, "part");
      for (const part of recipe.parts) {
        keys(part, ["uuid", "order", "extraction", "locators", "joinWith"]);
        requireValue(
          record(part.extraction),
          "Missing extraction specification.",
        );
        keys(
          part.extraction,
          part.extraction.type === "attribute"
            ? ["type", "name"]
            : part.extraction.type === "selection"
              ? ["type", "quote"]
              : ["type"],
        );
        if (part.extraction.type === "attribute")
          text(part.extraction.name, "attribute name");
        else if (part.extraction.type === "selection")
          quote(part.extraction.quote);
        else
          requireValue(
            part.extraction.type === "text",
            "Unsupported extraction specification.",
          );
        requireValue(
          part.joinWith === undefined || typeof part.joinWith === "string",
          "Invalid part separator.",
        );
        ordered(part.locators, "locator");
        part.locators.forEach(validateLocator);
      }
    }
  }
  const active = tree.versions.filter((version) => version.status === "active");
  requireValue(
    active.length <= 1,
    "Selector can have at most one active version.",
  );
  requireValue(
    (selector.activeVersionUuid ?? null) === (active[0]?.uuid ?? null),
    "Active version reference does not match its status.",
  );
  return tree;
}

export function validateSelectorEvaluation(result, version) {
  const statuses = [
    "success",
    "not_found",
    "ambiguous",
    "conflict",
    "error",
    "unsupported",
  ];
  const check = (value) => {
    requireValue(
      record(value) && statuses.includes(value.status),
      "Invalid evaluation status.",
    );
    requireValue(
      value.rawValue === undefined || typeof value.rawValue === "string",
      "Invalid evaluation value.",
    );
    requireValue(
      value.status !== "success" ||
        (typeof value.rawValue === "string" &&
          value.rawValue.length > 0 &&
          value.rawValue.length <= 100000),
      "Successful evaluation requires a bounded value.",
    );
    requireValue(
      value.diagnostic === undefined || typeof value.diagnostic === "string",
      "Invalid evaluation diagnostic.",
    );
  };
  const children = (results, definitions, key) => {
    requireValue(
      Array.isArray(results) &&
        results.length === definitions.length &&
        new Set(results.map((item) => item[key])).size === results.length,
      "Incomplete evaluation diagnostics.",
    );
    return results.map((item) => {
      const definition = definitions.find((entry) => entry.uuid === item[key]);
      requireValue(definition, "Evaluation references an unknown definition.");
      check(item);
      return [item, definition];
    });
  };
  check(result);
  requireValue(
    result.selectorVersionUuid === version.uuid,
    "Evaluation belongs to another version.",
  );
  for (const [recipeResult, recipe] of children(
    result.recipeResults,
    version.recipes,
    "recipeUuid",
  )) {
    for (const [partResult, part] of children(
      recipeResult.partResults,
      recipe.parts,
      "partUuid",
    )) {
      for (const [locatorResult] of children(
        partResult.locatorResults,
        part.locators,
        "locatorUuid",
      )) {
        requireValue(
          Number.isSafeInteger(locatorResult.matchCount) &&
            locatorResult.matchCount >= 0,
          "Invalid locator match count.",
        );
        requireValue(
          locatorResult.status !== "success" || locatorResult.matchCount === 1,
          "A successful locator requires a unique match.",
        );
      }
    }
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stable(value[key])]),
  );
}
const signature = (value) => JSON.stringify(stable(value));

/** Approved definitions and history cannot be overwritten by stale panels/imports. */
export function validateSelectorTransition(before, after) {
  validateSelectorTree(after);
  if (!before) return;
  requireValue(
    before.selector.uuid === after.selector.uuid,
    "Selector identity cannot change.",
  );
  requireValue(
    signature(before.selector.target) === signature(after.selector.target),
    "Selector target cannot change.",
  );
  for (const previous of before.versions) {
    const next = after.versions.find(
      (version) => version.uuid === previous.uuid,
    );
    if (previous.status === "draft") {
      requireValue(
        next &&
          (["draft", "active", "rejected"].includes(next.status) ||
            (next.status === "superseded" &&
              typeof next.reviewedAt === "string")),
        "Draft must be retained or explicitly rejected.",
      );
      requireValue(
        previous.versionNo === next.versionNo,
        "Version number cannot change.",
      );
      continue;
    }
    requireValue(next, "Approved version history cannot be removed.");
    const expectedStatus =
      previous.status === "active" && next.status === "superseded"
        ? "superseded"
        : previous.status;
    requireValue(
      next.status === expectedStatus &&
        signature({ ...previous, status: next.status }) === signature(next),
      "Approved selector versions are immutable; create a draft.",
    );
  }
  const maxNumber = Math.max(
    ...before.versions.map((version) => version.versionNo),
  );
  for (const next of after.versions) {
    if (!before.versions.some((version) => version.uuid === next.uuid)) {
      const reviewed =
        ["active", "superseded", "rejected"].includes(next.status) &&
        typeof next.reviewedAt === "string" &&
        !Number.isNaN(Date.parse(next.reviewedAt));
      requireValue(
        next.versionNo > maxNumber && (next.status === "draft" || reviewed),
        "New versions must start as a new draft or have explicit review metadata.",
      );
    }
  }
}
