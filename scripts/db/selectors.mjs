import {
  validateSelectorTree,
  validateSelectorTransition,
  validateSelectorEvaluation,
} from "../../src/shared/selectors/validation.js";
import {
  migrateLegacySelectors,
  migrateRuleSelector,
} from "../../src/shared/selectors/migration.js";

/** Called inside the existing full-workspace SQLite transaction. */
export function writeSelectorTrees(db, state, previous) {
  const previousRules = new Map(
    (previous?.rules ?? []).map((rule) => [String(rule.id), rule]),
  );
  // A pending View created by an older extension can still contain bare rules.
  // Reuse the durable mapping rather than generating another logical selector.
  for (const rule of state.rules) {
    const oldRule = previousRules.get(String(rule.id));
    if (!rule.selectorTree && oldRule?.selectorTree) {
      const unchanged =
        rule.selector === oldRule.selector &&
        JSON.stringify(rule.extraction) ===
          JSON.stringify(oldRule.extraction) &&
        JSON.stringify(rule.selectorFallbacks ?? []) ===
          JSON.stringify(oldRule.selectorFallbacks ?? []);
      let proposed;
      if (!unchanged) {
        migrateRuleSelector(rule);
        proposed = rule.selectorTree?.versions[0];
        if (!proposed)
          throw new Error(
            "A web selector cannot be replaced by another rule type without removing its attachment.",
          );
        proposed.selectorUuid = oldRule.selectorTree.selector.uuid;
        proposed.versionNo =
          Math.max(
            ...oldRule.selectorTree.versions.map(
              (version) => version.versionNo,
            ),
          ) + 1;
        proposed.status = "draft";
      }
      rule.selectorTree = structuredClone(oldRule.selectorTree);
      if (proposed) rule.selectorTree.versions.push(proposed);
      if (rule.selectorEvaluations === undefined && oldRule.selectorEvaluations)
        rule.selectorEvaluations = structuredClone(oldRule.selectorEvaluations);
    }
  }
  migrateLegacySelectors(state);
  const oldTrees = new Map(
    (previous?.rules ?? [])
      .filter((rule) => rule.selectorTree)
      .map((rule) => [rule.selectorTree.selector.uuid, rule.selectorTree]),
  );
  const seen = new Set();
  for (const rule of state.rules) {
    if (!rule.selectorTree) continue;
    const tree = rule.selectorTree;
    const previousTree = previousRules.get(String(rule.id))?.selectorTree;
    if (previousTree && previousTree.selector.uuid !== tree.selector.uuid)
      throw new Error("A rule's logical selector identity cannot change.");
    validateSelectorTree(tree);
    validateSelectorTransition(oldTrees.get(tree.selector.uuid), tree);
    if (seen.has(tree.selector.uuid))
      throw new Error("Selector is attached to multiple rules.");
    seen.add(tree.selector.uuid);
    const target = tree.selector.target;
    if (
      target.objectId !== String(rule.objectId) ||
      target.field !== rule.field ||
      target.target?.kind !== rule.target?.kind ||
      target.target?.id !== rule.target?.id
    )
      throw new Error("Selector target does not match its rule attachment.");
    for (const evaluation of rule.selectorEvaluations ?? []) {
      const version = tree.versions.find(
        (item) => item.uuid === evaluation.result?.selectorVersionUuid,
      );
      if (!version)
        throw new Error("Stored evaluation belongs to another selector.");
      validateSelectorEvaluation(evaluation.result, version);
    }
  }
  // Clear only selector-owned rows. Business data and source/snapshot rows are untouched.
  db.exec(
    "UPDATE selectors SET active_version_uuid = NULL; DELETE FROM selectors;",
  );
  const insertSelector = db.prepare(
    "INSERT INTO selectors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertVersion = db.prepare(
    "INSERT INTO selector_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRecipe = db.prepare(
    "INSERT INTO selector_recipes VALUES (?, ?, ?)",
  );
  const insertPart = db.prepare(
    "INSERT INTO selector_parts VALUES (?, ?, ?, ?, ?)",
  );
  const insertLocator = db.prepare(
    "INSERT INTO selector_locators VALUES (?, ?, ?, ?, ?)",
  );
  const insertEvaluation = db.prepare(
    "INSERT INTO selector_evaluations VALUES (?, ?, ?, ?, ?)",
  );
  for (const rule of state.rules) {
    if (!rule.selectorTree) continue;
    const { selector, versions } = rule.selectorTree;
    insertSelector.run(
      selector.uuid,
      selector.target.objectId,
      selector.target.field,
      JSON.stringify(selector.target),
      selector.sourceUuid ?? null,
      selector.pageUrl ?? null,
      selector.activeVersionUuid ?? null,
      selector.createdAt,
      selector.migration ? JSON.stringify(selector.migration) : null,
      String(rule.id),
    );
    for (const version of versions) {
      insertVersion.run(
        version.uuid,
        selector.uuid,
        version.versionNo,
        version.status,
        version.createdFromSnapshotUuid ?? null,
        version.artifactType ?? null,
        version.createdAt,
        version.reviewedAt ?? null,
        version.reviewedBy ?? null,
      );
      for (const recipe of version.recipes) {
        insertRecipe.run(recipe.uuid, version.uuid, recipe.order);
        for (const part of recipe.parts) {
          insertPart.run(
            part.uuid,
            recipe.uuid,
            part.order,
            JSON.stringify(part.extraction),
            part.joinWith ?? null,
          );
          for (const locator of part.locators) {
            const { uuid, kind, order, ...payload } = locator;
            insertLocator.run(
              uuid,
              part.uuid,
              order,
              kind,
              JSON.stringify(payload),
            );
          }
        }
      }
    }
    for (const evaluation of rule.selectorEvaluations ?? [])
      insertEvaluation.run(
        evaluation.uuid,
        evaluation.result.selectorVersionUuid,
        evaluation.evaluatedAt,
        evaluation.pageUrl,
        JSON.stringify(evaluation.result),
      );
  }
}

/** UUID-only DTO reconstructed from the normalized tables in deterministic order. */
export function readSelectorTree(db, selectorUuid) {
  const row = db
    .prepare("SELECT * FROM selectors WHERE uuid = ?")
    .get(selectorUuid);
  if (!row) return null;
  const selector = {
    uuid: row.uuid,
    target: JSON.parse(row.target_json),
    ...(row.source_uuid ? { sourceUuid: row.source_uuid } : {}),
    ...(row.page_url != null ? { pageUrl: row.page_url } : {}),
    activeVersionUuid: row.active_version_uuid,
    createdAt: row.created_at,
    ...(row.migration_json
      ? { migration: JSON.parse(row.migration_json) }
      : {}),
  };
  const versions = db
    .prepare(
      "SELECT * FROM selector_versions WHERE selector_uuid = ? ORDER BY version_no",
    )
    .all(selectorUuid)
    .map((version) => ({
      uuid: version.uuid,
      selectorUuid,
      versionNo: version.version_no,
      status: version.status,
      createdFromSnapshotUuid: version.created_from_snapshot_uuid,
      artifactType: version.artifact_type,
      createdAt: version.created_at,
      ...(version.reviewed_at ? { reviewedAt: version.reviewed_at } : {}),
      ...(version.reviewed_by ? { reviewedBy: version.reviewed_by } : {}),
      recipes: db
        .prepare(
          "SELECT * FROM selector_recipes WHERE version_uuid = ? ORDER BY position",
        )
        .all(version.uuid)
        .map((recipe) => ({
          uuid: recipe.uuid,
          order: recipe.position,
          parts: db
            .prepare(
              "SELECT * FROM selector_parts WHERE recipe_uuid = ? ORDER BY position",
            )
            .all(recipe.uuid)
            .map((part) => ({
              uuid: part.uuid,
              order: part.position,
              extraction: JSON.parse(part.extraction_json),
              ...(part.join_with != null ? { joinWith: part.join_with } : {}),
              locators: db
                .prepare(
                  "SELECT * FROM selector_locators WHERE part_uuid = ? ORDER BY position",
                )
                .all(part.uuid)
                .map((locator) => ({
                  uuid: locator.uuid,
                  kind: locator.kind,
                  order: locator.position,
                  ...JSON.parse(locator.payload_json),
                })),
            })),
        })),
    }));
  const tree = { selector, versions };
  validateSelectorTree(tree);
  return tree;
}
