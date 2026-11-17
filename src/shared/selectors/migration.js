import { newSelectorUuid } from "./uuid.js";

/** Shared by the extension and its existing local Node/SQLite service. */
export function migrateRuleSelector(
  rule,
  uuid = newSelectorUuid,
  now = new Date().toISOString(),
) {
  if (
    rule.selectorTree ||
    !["text", "attribute", "selection"].includes(rule.extraction?.type) ||
    typeof rule.selector !== "string"
  )
    return false;
  const captured = rule.extraction.selectorVersion;
  const selectorUuid = captured?.selectorUuid ?? uuid();
  const createdAt = rule.createdAt || now;
  const extraction =
    rule.extraction.type === "attribute"
      ? { type: "attribute", name: rule.extraction.attribute }
      : rule.extraction.type === "selection"
        ? { type: "selection", quote: { ...rule.extraction.quote } }
        : { type: "text" };
  const selectors = [
    ...new Set(
      [
        rule.selector,
        ...(rule.selectorFallbacks ?? rule.extraction.selectorFallbacks ?? []),
      ].filter(Boolean),
    ),
  ];
  const locators = selectors.map((selector, order) => ({
    uuid: uuid(),
    kind: "css_path",
    order,
    selector,
  }));
  if (!captured && extraction.type === "selection")
    locators.push({
      uuid: uuid(),
      kind: "text_quote",
      order: locators.length,
      quote: { ...extraction.quote },
    });
  const version = captured
    ? structuredClone(captured)
    : {
        uuid: uuid(),
        selectorUuid,
        versionNo: 1,
        status: "active",
        createdFromSnapshotUuid: null,
        artifactType: null,
        createdAt,
        recipes: [
          {
            uuid: uuid(),
            order: 0,
            parts: [
              {
                uuid: uuid(),
                order: 0,
                extraction,
                locators,
              },
            ],
          },
        ],
      };
  version.status = "active";
  rule.selectorTree = {
    selector: {
      uuid: selectorUuid,
      target: {
        objectId: String(rule.objectId),
        field: rule.field,
        ...(rule.target ? { target: { ...rule.target } } : {}),
      },
      pageUrl: rule.pageUrl,
      activeVersionUuid: version.uuid,
      createdAt,
      ...(!captured
        ? {
            migration: {
              legacyRuleId: String(rule.id),
              provenance: "unverified",
            },
          }
        : {}),
    },
    versions: [version],
  };
  // Capture transport metadata is not a second, mutable copy of the definition.
  if (captured) {
    rule.extraction = { ...rule.extraction };
    delete rule.extraction.selectorVersion;
  }
  return true;
}

export function migrateLegacySelectors(
  state,
  uuid = newSelectorUuid,
  now = new Date().toISOString(),
) {
  let changed = false;
  for (const rule of state.rules)
    changed = migrateRuleSelector(rule, uuid, now) || changed;
  return changed;
}
