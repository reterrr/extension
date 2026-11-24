import { hasSensitiveParameters } from "../shared/monitoring/contracts";

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const urlAttributes = new Set([
  "action",
  "background",
  "cite",
  "formaction",
  "href",
  "longdesc",
  "manifest",
  "poster",
  "src",
  "usemap",
  "xlink:href",
]);
const lazyClasses = new Set(["lazy-hidden", "lazy-loaded"]);
const spaces = /[\t\n\f\r ]+/;

export type SourceSet = [url: string, descriptor: string][];

function reference(value: string, base: string): URL | undefined {
  if (
    !value.trim() ||
    /[\x00-\x1f\x7f\\]/.test(value) ||
    /^(?:https?:)?\/\/[^/?#]*@/i.test(value.trim())
  )
    return;
  try {
    const url = new URL(value, base);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !hasSensitiveParameters(url)
    )
      return url;
  } catch {
    // Malformed URLs have no comparison value.
  }
}

function sourceDescriptor(value: string): string | undefined {
  if (!value) return "1x";
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?x$/.test(value)) {
    const density = Number(value.slice(0, -1));
    if (Number.isFinite(density) && density >= 0) return `${density}x`;
  }
  const sizes = value.split(spaces);
  const width = sizes.find((size) => /^0*[1-9]\d*w$/.test(size));
  const height = sizes.find((size) => /^0*[1-9]\d*h$/.test(size));
  if (width && sizes.length === (height ? 2 : 1))
    return height ? `${width} ${height}` : width;
}

export function readSourceSet(
  value: string,
  base: string,
): SourceSet | undefined {
  // A URL token can contain commas. A trailing comma or a comma after its
  // descriptors separates candidates. Reject unsafe candidates individually.
  const urls = /[^,\t\n\f\r ][^\t\n\f\r ]*/g;
  const descriptors = /(?:[^,(]|\([^)]*(?:\)|$))*/y;
  const result: SourceSet = [];
  for (let token = urls.exec(value); token; token = urls.exec(value)) {
    const rawUrl = token[0].replace(/,+$/, "");
    let descriptor = "1x";
    if (rawUrl === token[0]) {
      descriptors.lastIndex = urls.lastIndex;
      const rawDescriptor = descriptors.exec(value)?.[0] ?? "";
      urls.lastIndex += rawDescriptor.length + 1;
      descriptor = sourceDescriptor(rawDescriptor.trim()) ?? "";
    }
    const url = reference(rawUrl, base);
    if (url && descriptor) result.push([url.href, descriptor]);
  }
  return result.length ? result : undefined;
}

export function isResponsiveImage(node: Element): boolean {
  return (
    node.namespaceURI === htmlNamespace &&
    (node.localName === "img" ||
      (node.localName === "source" &&
        node.parentElement?.localName === "picture"))
  );
}

function setAttribute(
  attributes: Map<string, string>,
  name: string,
  value?: string,
) {
  if (value === undefined) attributes.delete(name);
  else attributes.set(name, value);
}

function normalizeImage(
  node: Element,
  attributes: Map<string, string>,
  base: string,
  nativeSet?: SourceSet,
) {
  const isImage = node.localName === "img";
  const classes = (attributes.get("class") ?? "").split(spaces).filter(Boolean);
  const lazy = isImage && classes.some((token) => lazyClasses.has(token));
  const pending = isImage && classes.includes("lazy-hidden");
  const deferredSet = readSourceSet(attributes.get("data-srcset") ?? "", base);
  const activeSet = nativeSet ?? (pending ? deferredSet : undefined);
  const activeSetValue = activeSet && JSON.stringify(activeSet);
  const deferredSetValue = deferredSet && JSON.stringify(deferredSet);
  setAttribute(attributes, "srcset", activeSetValue);
  setAttribute(
    attributes,
    "data-srcset",
    deferredSetValue === activeSetValue ? undefined : deferredSetValue,
  );
  if (!isImage) return;

  const deferred = reference(attributes.get("data-src") ?? "", base)?.href;
  const source = attributes.get("src");
  const placeholder =
    source && new URL(source).pathname.endsWith("/lazy_placeholder.gif");
  if (pending && (!source || placeholder) && (deferred || activeSet)) {
    const defaultCandidate = activeSet?.find(
      ([, descriptor]) => descriptor === "1x",
    );
    setAttribute(attributes, "src", deferred ?? defaultCandidate?.[0]);
  }
  setAttribute(
    attributes,
    "data-src",
    deferred === attributes.get("src") ? undefined : deferred,
  );
  if (lazy) {
    const remaining = classes.filter((token) => !lazyClasses.has(token));
    setAttribute(attributes, "class", remaining.join(" ") || undefined);
  }
}

function comparisonAttributes(
  node: Element,
  base: string,
  nativeSet?: SourceSet,
): [string, string][] {
  const attributes = new Map<string, string>();
  for (const { name, value } of Array.from(node.attributes)) {
    if (urlAttributes.has(name)) {
      const url = reference(value, base);
      if (url) attributes.set(name, url.href);
    } else if (name === "ping") {
      const urls = value
        .split(spaces)
        .flatMap((item) => reference(item, base)?.href ?? []);
      if (urls.length) attributes.set(name, urls.join(" "));
    } else {
      attributes.set(name, value);
    }
  }
  if (isResponsiveImage(node))
    normalizeImage(node, attributes, base, nativeSet);
  return Array.from(attributes).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function shapeRows(
  snapshot: Document,
  attributeNames: (node: Element) => string[],
) {
  const indexes = new Map<Element, number>();
  return Array.from(snapshot.querySelectorAll("*"), (node, index) => {
    indexes.set(node, index);
    return [
      node.parentElement ? indexes.get(node.parentElement) : null,
      node.namespaceURI,
      node.localName,
      attributeNames(node),
    ];
  });
}

export function shape(snapshot: Document): string {
  return JSON.stringify(
    shapeRows(snapshot, (node) =>
      Array.from(node.attributes, ({ name }) => name).sort(),
    ),
  );
}

export function comparisonRepresentation(
  snapshot: Document,
  nativeSourceSets: ReadonlyMap<Element, SourceSet>,
) {
  const base = snapshot.baseURI;
  const content: [attributes: [string, string][], text: string[]][] = [];
  const structure = shapeRows(snapshot, (node) => {
    const attributes = comparisonAttributes(
      node,
      base,
      nativeSourceSets.get(node),
    );
    const text = [""];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === child.ELEMENT_NODE) text.push("");
      else if (
        child.nodeType === child.TEXT_NODE ||
        child.nodeType === child.CDATA_SECTION_NODE
      )
        text[text.length - 1] += child.nodeValue ?? "";
    }
    content.push([attributes, text]);
    return attributes.map(([name]) => name);
  });
  return {
    content: JSON.stringify([structure, content]),
    structure: JSON.stringify(structure),
  };
}
