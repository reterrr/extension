import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as Tree,
} from "parse5";

const removedTags = new Set([
  "script",
  "base",
  "meta",
  "link",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "fencedframe",
  "noscript",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
]);
const removedAttributes = new Set([
  "href",
  "src",
  "srcset",
  "imagesrcset",
  "action",
  "formaction",
  "target",
  "formtarget",
  "ping",
  "background",
  "poster",
  "srcdoc",
  "data",
  "lowsrc",
  "dynsrc",
  "codebase",
  "code",
  "archive",
  "manifest",
  "base",
  "autofocus",
  "contenteditable",
  "autoplay",
]);
const policy =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function archivePreview(original: string): string {
  const tree = parse(original);
  const pending: Tree.ParentNode[] = [tree];
  const root = tree.childNodes.find(
    (node): node is Tree.Element =>
      "tagName" in node && node.tagName === "html",
  )!;
  const head = root.childNodes.find(
    (node): node is Tree.Element =>
      "tagName" in node && node.tagName === "head",
  )!;
  while (pending.length) {
    const node = pending.pop()!;
    node.childNodes = node.childNodes.filter(
      (child) =>
        !("tagName" in child && removedTags.has(child.tagName.toLowerCase())),
    );
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      child.attrs = child.attrs.filter(
        ({ name, prefix }) =>
          !name.toLowerCase().startsWith("on") &&
          !removedAttributes.has(name.toLowerCase()) &&
          prefix !== "xlink",
      );
      pending.push(child);
      if ("content" in child) pending.push((child as Tree.Template).content);
    }
  }
  // parse5 always constructs the document's head. Install the policy before rendering any captured node.
  const security = parseFragment(
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
  head.childNodes.unshift(...security.childNodes);
  return serialize(tree);
}

export function inspectionDocument(
  original: string,
  host: Document,
): XMLDocument {
  const parsed = parse(original);
  // Generic nodes in an XML document have no browsing context or HTML resource-loading behavior.
  // Retain the archived tag order and attributes for offline CSS and XPath tests.
  const document = host.implementation.createDocument(null, "", null);
  const pending: [Tree.ParentNode, Node][] = [[parsed, document]];
  while (pending.length) {
    const [source, parent] = pending.pop()!;
    for (const node of source.childNodes) {
      if ("tagName" in node) {
        const element = document.createElement(node.tagName);
        for (const { name, prefix, value } of node.attrs)
          element.setAttribute(prefix ? `${prefix}:${name}` : name, value);
        parent.appendChild(element);
        pending.push([node, element]);
      } else if ("value" in node)
        parent.appendChild(document.createTextNode(node.value));
      else if ("data" in node)
        parent.appendChild(document.createComment(node.data));
    }
  }
  return document;
}
