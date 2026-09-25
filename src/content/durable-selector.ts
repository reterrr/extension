export interface DurableSelectorSet {
  primary: string;
  fallbacks: string[];
}

const STRONG_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "data-automation-id",
  "itemprop",
  "name",
  "aria-label",
] as const;

const SEMANTIC_ATTRIBUTES = ["title", "role", "alt", "for"] as const;

const TEXT_BLOCK_TAGS = new Set([
  "P",
  "LI",
  "TD",
  "TH",
  "DT",
  "DD",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "A",
  "LABEL",
  "FIGCAPTION",
  "BLOCKQUOTE",
]);

function stableValue(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 120) return false;
  if (/^[0-9]+$/.test(text)) return false;
  if (/^[a-f0-9]{12,}$/i.test(text)) return false;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(text)) return false;
  if (/(?:^|[-_])(ember|react|vue|ng|jsx|css)[-_]?\d{3,}$/i.test(text)) {
    return false;
  }
  return true;
}

function stableClassName(value: string): boolean {
  if (!stableValue(value) || value.length > 70) return false;
  if (/^(active|current|selected|focus|hover|open|closed|clearfix)$/i.test(value)) {
    return false;
  }
  if (/(?:^|[-_])(?:css|jsx|emotion|sc)[-_][a-z0-9]{5,}$/i.test(value)) {
    return false;
  }
  if (/[a-f0-9]{10,}/i.test(value)) return false;
  return true;
}

function attributeSelector(element: Element, attribute: string): string | null {
  const value = element.getAttribute(attribute)?.trim();
  if (!value || !stableValue(value)) return null;
  return `${element.localName}[${attribute}=${CSS.escape(value)}]`;
}

function semanticUrlSelector(element: Element): string | null {
  const attribute = element.localName === "a" ? "href" : element.localName === "img" ? "src" : null;
  if (!attribute) return null;
  const value = element.getAttribute(attribute)?.trim();
  if (!value || value.length > 180 || /(?:^|[?&])(utm_|fbclid|gclid)/i.test(value)) return null;
  return `${element.localName}[${attribute}=${CSS.escape(value)}]`;
}

function stableClasses(element: Element): string[] {
  return Array.from(element.classList).filter(stableClassName).slice(0, 5);
}

function matchesOnly(selector: string, element: Element): boolean {
  try {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 && nodes[0] === element;
  } catch {
    return false;
  }
}

function addUnique(
  target: string[],
  seen: Set<string>,
  selector: string | null | undefined,
  element: Element,
): void {
  if (!selector || seen.has(selector) || !matchesOnly(selector, element)) return;
  seen.add(selector);
  target.push(selector);
}

function directCandidates(element: Element): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (element.id && stableValue(element.id)) {
    addUnique(candidates, seen, `#${CSS.escape(element.id)}`, element);
  }

  for (const attribute of STRONG_ATTRIBUTES) {
    addUnique(candidates, seen, attributeSelector(element, attribute), element);
  }

  addUnique(candidates, seen, semanticUrlSelector(element), element);

  for (const attribute of SEMANTIC_ATTRIBUTES) {
    addUnique(candidates, seen, attributeSelector(element, attribute), element);
  }

  const classes = stableClasses(element);
  for (const className of classes) {
    addUnique(
      candidates,
      seen,
      `${element.localName}.${CSS.escape(className)}`,
      element,
    );
  }

  for (let left = 0; left < classes.length; left += 1) {
    for (let right = left + 1; right < classes.length; right += 1) {
      addUnique(
        candidates,
        seen,
        `${element.localName}.${CSS.escape(classes[left])}.${CSS.escape(classes[right])}`,
        element,
      );
    }
  }

  addUnique(candidates, seen, element.localName, element);

  // Dynamic-looking ids are deliberately a late fallback rather than the
  // primary selector. They are often unique but frequently change per render.
  if (element.id && !stableValue(element.id)) {
    addUnique(candidates, seen, `#${CSS.escape(element.id)}`, element);
  }

  return candidates;
}

function nonUniqueFragments(element: Element): string[] {
  const fragments: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      fragments.push(value);
    }
  };

  for (const attribute of STRONG_ATTRIBUTES) add(attributeSelector(element, attribute));
  add(semanticUrlSelector(element));
  for (const attribute of SEMANTIC_ATTRIBUTES) add(attributeSelector(element, attribute));

  for (const className of stableClasses(element)) {
    add(`${element.localName}.${CSS.escape(className)}`);
  }

  add(element.localName);
  return fragments;
}

function positionalSegment(element: Element): string {
  let segment = element.localName;
  const classes = stableClasses(element);
  if (classes.length) segment += `.${CSS.escape(classes[0])}`;

  const parent = element.parentElement;
  if (!parent) return segment;

  const sameTag = Array.from(parent.children).filter(
    (candidate) => candidate.localName === element.localName,
  );
  const sameShape = classes.length
    ? sameTag.filter((candidate) => candidate.classList.contains(classes[0]))
    : sameTag;

  // A stable class is useful, but repeated cards/list rows often reuse the
  // exact same class. Keep the class and add a late structural discriminator.
  // nth-of-type must be calculated among every sibling with the same tag.
  if (sameShape.length > 1) {
    const index = sameTag.indexOf(element);
    if (index >= 0) segment += `:nth-of-type(${index + 1})`;
  }
  return segment;
}

function uniqueAncestorSelectors(element: Element): string[] {
  return directCandidates(element).slice(0, 3);
}

function anchoredCandidates(element: Element): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let ancestor = element.parentElement;
  let depth = 0;

  while (ancestor && ancestor !== document.documentElement && depth < 6) {
    const anchors = uniqueAncestorSelectors(ancestor);
    if (anchors.length) {
      for (const anchor of anchors) {
        for (const fragment of nonUniqueFragments(element).slice(0, 4)) {
          addUnique(result, seen, `${anchor} ${fragment}`, element);
        }

        const segments: string[] = [];
        let cursor: Element | null = element;
        while (cursor && cursor !== ancestor && segments.length < 4) {
          segments.unshift(positionalSegment(cursor));
          cursor = cursor.parentElement;
        }
        if (cursor === ancestor && segments.length) {
          addUnique(result, seen, `${anchor} > ${segments.join(" > ")}`, element);
        }
      }
    }

    ancestor = ancestor.parentElement;
    depth += 1;
  }

  return result;
}

function structuralCandidate(element: Element): string | null {
  const path: string[] = [];

  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.id && stableValue(node.id)) {
      path.unshift(`#${CSS.escape(node.id)}`);
      const anchored = path.join(" > ");
      if (matchesOnly(anchored, element)) return anchored;
      path.shift();
    }

    path.unshift(positionalSegment(node));
    const result = path.join(" > ");
    if (matchesOnly(result, element)) return result;
  }

  return null;
}

export function buildDurableSelectors(element: Element): DurableSelectorSet {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (selector: string | null | undefined) => {
    if (!selector || seen.has(selector)) return;
    seen.add(selector);
    candidates.push(selector);
  };

  for (const selector of directCandidates(element)) add(selector);
  for (const selector of anchoredCandidates(element)) add(selector);
  add(structuralCandidate(element));

  if (!candidates.length) {
    throw new Error("Cannot create a unique selector for this element.");
  }

  return {
    primary: candidates[0],
    fallbacks: candidates.slice(1, 7),
  };
}

export function selectionContainer(range: Range): Element | null {
  const node = range.commonAncestorContainer;
  let element = node instanceof Element ? node : node.parentElement;
  if (!element) return null;

  const exactLength = range.toString().replace(/\s+/g, " ").trim().length;
  const maxLength = Math.max(1200, exactLength * 8);
  let fallback = element;

  for (let depth = 0; element && depth < 5; depth += 1) {
    const textLength = (element.textContent ?? "").replace(/\s+/g, " ").trim().length;
    if (textLength > 0 && textLength <= maxLength) fallback = element;
    if (TEXT_BLOCK_TAGS.has(element.tagName) && textLength <= maxLength) return element;
    element = element.parentElement;
  }

  return fallback;
}

export function selectorCandidates(
  primary: string,
  fallbacks: readonly string[] | undefined,
): string[] {
  return Array.from(new Set([primary, ...(fallbacks ?? [])].filter(Boolean)));
}
