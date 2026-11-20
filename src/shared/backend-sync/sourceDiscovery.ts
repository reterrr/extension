import { monitoredURL } from "../monitoring/contracts";
import type { LegacyStorageState } from "../types/legacy-storage";
import type { Discovery, LocalSourceCandidate } from "./bulkTypes";

export function canonicalSourceUrl(input: string): string {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (!authority || /[@%]/.test(authority) || /%(?![a-f0-9]{2})/i.test(input))
    throw new Error("Invalid source URL.");
  const url = monitoredURL(input, { allowHttp: true });
  url.hash = "";
  const canonical = url.href;
  if (new TextEncoder().encode(canonical).length > 2048)
    throw new Error("Source URL is too long.");
  return canonical;
}

type SourceKind = LocalSourceCandidate["type"];
const sourceType = (kind: string): SourceKind =>
  kind === "HTML" || kind === "PDF" || kind === "XLSX" ? kind : "UNSUPPORTED";
const keyOf = (...elements: (string | null)[]) => JSON.stringify(elements);
const selectorPrefix = "selector:";
const importedKey = (id: string) => keyOf("import", id);
const uuidKey = (id: string) => keyOf("source-uuid", id);
const sort = (values: Set<string>) => [...values].sort();

function addIndex(index: Map<string, Set<string>>, alias: string, key: string) {
  if (!index.has(alias)) index.set(alias, new Set());
  index.get(alias)!.add(key);
}

export function discoverSources(
  state: LegacyStorageState,
  corrections: Readonly<Record<string, string>> = {},
): Discovery {
  const candidates = new Map<string, LocalSourceCandidate>();
  const aliases = new Map<string, Set<string>>();
  const filePages = new Map<string, Set<string>>();
  const evidencePages = new Map<string, Set<string>>();
  const evidenceCounts = new Map<string, number>();
  const targetKey = (
    id: string,
    field: string,
    target?: { kind: string; id: string },
  ) =>
    keyOf(
      id,
      field,
      target && target.kind !== "object" ? target.kind : null,
      target && target.kind !== "object" ? target.id : null,
    );

  function register(
    kind: SourceKind,
    raw: string | undefined,
    marker: string,
    localKey?: string,
  ) {
    let url: string | null = null;
    try {
      if (raw) url = canonicalSourceUrl(raw);
    } catch {
      // Keep the reason and provenance without retaining an unsafe URL in the plan.
    }
    const issue =
      kind === "UNSUPPORTED" || !raw
        ? "UNSUPPORTED"
        : !url
          ? "SOURCE_URL_INVALID"
          : undefined;
    const key =
      url && !issue ? keyOf("url", kind, url) : keyOf("unresolved", marker);
    const existing = candidates.get(key);
    const row = existing ?? {
      key,
      type: kind,
      url,
      issue,
      localKeys: [],
      provenance: [],
      selectorUuids: [],
    };
    row.provenance.push(marker);
    if (localKey) {
      row.localKeys.push(localKey);
      addIndex(aliases, localKey, key);
    }
    candidates.set(key, row);
    return key;
  }

  const importsByKey = new Map<string, Set<string>>();
  const importsByUrl = new Map<string, Set<string>>();
  let pendingEvidence = 0;
  for (const source of state.importSources ?? []) {
    const key = register(
      sourceType(source.type),
      source.url,
      `import:${source.id}`,
      importedKey(source.id),
    );
    if (source.importKey) addIndex(importsByKey, source.importKey, key);
    const url = candidates.get(key)!.url;
    if (url) addIndex(importsByUrl, url, key);
  }
  for (const object of state.objects) {
    if (object.sourceUrl) {
      const marker = `object-source:${object.id}`;
      let imported: Set<string> | undefined;
      try {
        imported = importsByUrl.get(canonicalSourceUrl(object.sourceUrl));
      } catch {
        // Register the unresolved provenance below.
      }
      if (imported)
        for (const key of imported)
          candidates.get(key)!.provenance.push(marker);
      else register("HTML", object.sourceUrl, marker);
    }
    for (const [field, entries] of Object.entries(object.evidence ?? {})) {
      const target = targetKey(object.id, field);
      pendingEvidence += entries.length;
      evidenceCounts.set(
        target,
        (evidenceCounts.get(target) ?? 0) + entries.length,
      );
      for (const entry of entries)
        for (const key of aliases.get(importedKey(entry.sourceId)) ?? [])
          addIndex(evidencePages, target, key);
    }
  }
  for (const file of state.fileSources ?? []) {
    const fileKind = sourceType(file.fileType);
    const fileKey = keyOf("file", file.id);
    const named = file.sourceImportKey
      ? importsByKey.get(file.sourceImportKey)
      : undefined;
    if (file.url || !named?.size)
      register(fileKind, file.url, `file:${file.id}`, fileKey);
    else
      for (const key of named) {
        const source = candidates.get(key)!;
        if (source.type !== fileKind) continue;
        source.provenance.push(`file:${file.id}`);
        source.localKeys.push(fileKey);
        addIndex(aliases, fileKey, key);
      }
    const pageKey = keyOf(file.objectId, file.id);
    const marker = `file-source-page:${file.id}`;
    if (file.sourcePageUrl)
      addIndex(
        filePages,
        pageKey,
        register("HTML", file.sourcePageUrl, marker),
      );
    else if (file.sourcePageImportKey)
      for (const key of importsByKey.get(file.sourcePageImportKey) ?? []) {
        const source = candidates.get(key)!;
        if (source.type !== "HTML") continue;
        source.provenance.push(marker);
        addIndex(filePages, pageKey, key);
      }
  }
  const documentFiles = new Map(
    (state.documentRequirements ?? []).map((document) => [
      keyOf(document.objectId, document.id),
      [
        document.original_file_source_id,
        ...(document.source_file_source_ids ?? []),
      ],
    ]),
  );
  for (const item of state.fieldEvidence ?? []) {
    const target = targetKey(item.objectId, item.field, item.target);
    pendingEvidence++;
    evidenceCounts.set(target, (evidenceCounts.get(target) ?? 0) + 1);
    if (item.pageUrl)
      addIndex(
        evidencePages,
        target,
        register("HTML", item.pageUrl, `capture:${item.id}`),
      );
  }
  for (const item of state.importTargetEvidence ?? []) {
    const target = targetKey(item.objectId, item.field, item.target);
    pendingEvidence++;
    evidenceCounts.set(target, (evidenceCounts.get(target) ?? 0) + 1);
    for (const key of aliases.get(importedKey(item.sourceId)) ?? [])
      addIndex(evidencePages, target, key);
  }

  const occurrences = new Map<string, number>();
  const rules = state.rules.map((rule, index) => {
    const selector = rule.selectorTree?.selector;
    const baseKey = selector
      ? selectorPrefix + selector.uuid
      : `legacy:${rule.id ?? index}`;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    const key = occurrence ? `${baseKey}:${occurrence}` : baseKey;
    const pages = new Set<string>();
    const urls = [
      ["selector-page", selector?.pageUrl],
      ["rule-page", rule.pageUrl],
      ...(rule.selectorEvaluations ?? []).map((item) => [
        `evaluation:${item.uuid}`,
        item.pageUrl,
      ]),
    ];
    const evidenceTarget = selector?.target ?? rule;
    const target = targetKey(
      evidenceTarget.objectId,
      evidenceTarget.field,
      evidenceTarget.target,
    );
    for (const [kind, url] of urls) {
      if (!url) continue;
      pages.add(
        register(
          rule.extraction?.type === "pdfText" ? "PDF" : "HTML",
          url,
          `${key}:${kind}`,
          selector?.sourceUuid ? uuidKey(selector.sourceUuid) : undefined,
        ),
      );
    }
    if (selector?.sourceUuid) {
      for (const source of aliases.get(importedKey(selector.sourceUuid)) ?? [])
        pages.add(source);
      for (const source of importsByKey.get(selector.sourceUuid) ?? [])
        pages.add(source);
    }
    const evaluationCount = rule.selectorEvaluations?.length ?? 0;
    pendingEvidence += evaluationCount;
    return {
      key,
      rule,
      pages,
      target,
      pendingEvidence: evaluationCount + (evidenceCounts.get(target) ?? 0),
    };
  });

  const selectors = rules
    .map(({ key, rule, pages, target, pendingEvidence }) => {
      const selector = rule.selectorTree?.selector;
      if (selector?.sourceUuid)
        for (const source of aliases.get(uuidKey(selector.sourceUuid)) ?? [])
          pages.add(source);
      if (!pages.size) {
        // Historic evidence and referenced file pages are fallback provenance.
        for (const source of evidencePages.get(target) ?? []) pages.add(source);
        const subject = selector?.target ?? rule;
        const nested = subject.target;
        const fileIds =
          nested?.kind === "document"
            ? (documentFiles.get(keyOf(subject.objectId, nested.id)) ?? [])
            : nested?.kind === "file_source"
              ? [nested.id]
              : [];
        for (const id of fileIds)
          if (id)
            for (const source of filePages.get(keyOf(subject.objectId, id)) ??
              [])
              pages.add(source);
      }
      const correction = selector && corrections[selector.uuid];
      const sourceKeys = correction
        ? [register("HTML", correction, `${key}:explicit-url`)]
        : sort(pages);
      for (const source of sourceKeys)
        if (selector) candidates.get(source)!.selectorUuids.push(selector.uuid);
      return { key, rule, sourceKeys, pendingEvidence };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const sources = [...candidates.values()]
    .map((source) => ({
      ...source,
      localKeys: sort(
        new Set(source.localKeys.filter((key) => aliases.get(key)?.size === 1)),
      ),
      provenance: sort(new Set(source.provenance)),
      selectorUuids: sort(new Set(source.selectorUuids)),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { sources, selectors, pendingEvidence };
}
