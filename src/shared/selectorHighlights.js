function comparablePageUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.href;
  } catch {
    return String(value ?? "");
  }
}

export function sameSelectorPage(left, right) {
  return comparablePageUrl(left) === comparablePageUrl(right);
}

function webExtraction(extraction) {
  return (
    extraction &&
    ["text", "selection", "attribute"].includes(String(extraction.type))
  );
}

function ruleFallbacks(rule) {
  if (Array.isArray(rule.selectorFallbacks) && rule.selectorFallbacks.length) {
    return rule.selectorFallbacks.filter((entry) => typeof entry === "string");
  }
  if (webExtraction(rule.extraction)) {
    return Array.isArray(rule.extraction.selectorFallbacks)
      ? rule.extraction.selectorFallbacks.filter(
          (entry) => typeof entry === "string",
        )
      : [];
  }
  return [];
}

function quoteFrom(extraction) {
  return extraction?.type === "selection" ? extraction.quote : undefined;
}

function highlightKey(selector, quote) {
  return [
    selector,
    quote?.exact ?? "",
    quote?.prefix ?? "",
    quote?.suffix ?? "",
  ].join("\u0000");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function codepointSlice(text, start, end) {
  return Array.from(String(text ?? "")).slice(start, end).join("");
}

function importedEvidenceQuote(source, evidence) {
  const text = source?.snapshot?.text;
  if (typeof text !== "string") return null;

  const exact = cleanText(
    evidence?.rawValue ||
      codepointSlice(text, evidence?.charStart ?? 0, evidence?.charEnd ?? 0),
  );
  if (!exact) return null;

  const codepoints = Array.from(text);
  const start = Math.max(0, Number(evidence?.charStart) || 0);
  const end = Math.max(start, Number(evidence?.charEnd) || start);
  return {
    exact,
    prefix: cleanText(codepoints.slice(Math.max(0, start - 80), start).join("")),
    suffix: cleanText(codepoints.slice(end, Math.min(codepoints.length, end + 80)).join("")),
  };
}


/**
 * Return every saved selector/evidence item that belongs to the current page,
 * regardless of which business object is currently selected in the sidebar.
 *
 * Duplicate visual targets are collapsed because stacking identical overlays
 * carries no extra information and is needlessly expensive.
 */
export function buildStoredSelectorHighlights(state, pageUrl) {
  if (!state || !pageUrl) return [];

  const highlights = [];
  const seen = new Set();

  for (const rule of state.rules ?? []) {
    if (
      !sameSelectorPage(rule.pageUrl, pageUrl) ||
      typeof rule.selector !== "string" ||
      !rule.selector ||
      !webExtraction(rule.extraction)
    ) {
      continue;
    }

    const quote = quoteFrom(rule.extraction);
    const key = highlightKey(rule.selector, quote);
    if (seen.has(key)) continue;
    seen.add(key);

    const fallbacks = ruleFallbacks(rule);
    highlights.push({
      id: "rule:" + String(rule.id),
      selector: rule.selector,
      ...(fallbacks.length ? { selectorFallbacks: fallbacks } : {}),
      ...(quote ? { quote } : {}),
    });
  }

  for (const entry of state.fieldEvidence ?? []) {
    if (
      !sameSelectorPage(entry.pageUrl, pageUrl) ||
      typeof entry.selector !== "string" ||
      !entry.selector ||
      !webExtraction(entry.extraction)
    ) {
      continue;
    }

    const quote = quoteFrom(entry.extraction);
    const key = highlightKey(entry.selector, quote);
    if (seen.has(key)) continue;
    seen.add(key);

    const fallbacks = Array.isArray(entry.selectorFallbacks)
      ? entry.selectorFallbacks.filter((fallback) => typeof fallback === "string")
      : [];

    highlights.push({
      id: "evidence:" + String(entry.id),
      selector: entry.selector,
      ...(fallbacks.length ? { selectorFallbacks: fallbacks } : {}),
      ...(quote ? { quote } : {}),
    });
  }

  const sourcesById = new Map(
    (state.importSources ?? []).map((source) => [String(source.id), source]),
  );

  for (const object of state.objects ?? []) {
    for (const [field, entries] of Object.entries(object.evidence ?? {})) {
      entries.forEach((evidence, index) => {
        const source = sourcesById.get(String(evidence.sourceId));
        if (
          !source?.url ||
          source.type !== "HTML" ||
          !sameSelectorPage(source.url, pageUrl)
        ) {
          return;
        }

        const quote = importedEvidenceQuote(source, evidence);
        if (!quote) return;

        // Imported portable evidence has no DOM selector. Use the page body as
        // a quote-search container; the content runtime resolves the exact text
        // range using exact/prefix/suffix.
        const selector = "body";
        const key = highlightKey(selector, quote);
        if (seen.has(key)) return;
        seen.add(key);

        highlights.push({
          id:
            "import-evidence:" +
            String(object.id) +
            ":" +
            String(field) +
            ":" +
            String(index),
          selector,
          quote,
        });
      });
    }
  }

  return highlights;
}

export { comparablePageUrl };
