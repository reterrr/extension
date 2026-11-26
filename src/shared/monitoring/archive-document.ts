import { generate, parse as parseCSS, walk } from "css-tree";
import {
  defaultTreeAdapter as tree,
  parse,
  parseFragment,
  serialize,
} from "parse5";
import type { DefaultTreeAdapterTypes as Tree } from "parse5";
import { maxVisualArchiveBytes, secretName } from "./contracts";

const images = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const fonts = new Set([
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/vnd.ms-fontobject",
]);
export const archiveMediaTypes = new Set(["text/css", ...images, ...fonts]);

export interface ArchiveResource {
  mediaType: string;
  bytes: Uint8Array;
  responseUrl?: string;
}

const activeTags = new Set([
  "script",
  "noscript",
  "base",
  "meta",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "fencedframe",
  "template",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
  "plaintext",
  "xmp",
]);
const resourceAttributes = new Set([
  "href",
  "src",
  "srcset",
  "imagesrcset",
  "imagesizes",
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
  "autoplay",
  "contenteditable",
  "nonce",
  "value",
]);
const policy = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' data:",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const fragment = /^#[\w.:-]+$/;
const credentialValue =
  /\b(?:access[_-]?token|password|csrf[_-]?token|session[_-]?id)\s*[:=]/i;
const embedded = /^data:([\w.+/-]+);base64,[a-z0-9+/=]+$/i;
const htmlNamespace =
  "http://www.w3.org/1999/xhtml" as Tree.Element["namespaceURI"];

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

function resourceKey(value: string, base: string) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

// Archive markup is parsed as data. It never becomes the DOM of an extension page.
export function archiveDocument(
  original: string,
  pageBase = "",
  resources: ReadonlyMap<string, ArchiveResource> = new Map(),
): string {
  const document = parse(original);
  let budget =
    maxVisualArchiveBytes - new TextEncoder().encode(original).length;
  const encoded = new Map<ArchiveResource, string>();

  function embed(value: string, base: string, types: ReadonlySet<string>) {
    if (value.startsWith("data:")) {
      const type = embedded.exec(value)?.[1].toLowerCase();
      return type && types.has(type) ? value : undefined;
    }
    const key = resourceKey(value, base);
    const resource = key && resources.get(key);
    if (!resource || !types.has(resource.mediaType)) return;
    const length =
      4 * Math.ceil(resource.bytes.length / 3) + resource.mediaType.length + 13;
    if (length > budget) return;
    budget -= length;
    const uri =
      encoded.get(resource) ??
      `data:${resource.mediaType};base64,${base64(resource.bytes)}`;
    encoded.set(resource, uri);
    return uri;
  }

  function css(
    text: string,
    base: string,
    imports: readonly string[] = [],
    context: "stylesheet" | "declarationList" = "stylesheet",
  ): string {
    const ast = parseCSS(text, { context, parseCustomProperty: true });
    walk(ast, function (node, item, list) {
      if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
        const first =
          node.prelude?.type === "AtrulePrelude" && node.prelude.children.first;
        const value =
          first && (first.type === "Url" || first.type === "String")
            ? first.value
            : "";
        const key = resourceKey(value, base);
        const uri =
          value.startsWith("data:text/css;base64,") && embedded.test(value)
            ? value
            : key && stylesheet(key, imports);
        if (uri && first && (first.type === "Url" || first.type === "String"))
          first.value = uri;
        else if (item && list) list.remove(item);
        return this.skip;
      }
      if (node.type === "Url" && !fragment.test(node.value))
        node.value = embed(node.value, base, cssAssets) ?? "#";
      if (
        node.type === "Function" &&
        /^(?:-webkit-)?image-set$/i.test(node.name)
      ) {
        for (const child of node.children)
          if (child.type === "String")
            child.value = embed(child.value, base, images) ?? "#";
      }
    });
    return generate(ast);
  }

  function stylesheet(key: string, imports: readonly string[]) {
    const resource = resources.get(key);
    if (
      resource?.mediaType !== "text/css" ||
      resource.bytes.length > budget ||
      imports.length >= 8 ||
      imports.includes(key)
    )
      return;
    const text = css(
      new TextDecoder().decode(resource.bytes),
      resource.responseUrl ?? key,
      [...imports, key],
    );
    const bytes = new TextEncoder().encode(text);
    const length = 4 * Math.ceil(bytes.length / 3) + 21;
    if (length > budget) return;
    budget -= length;
    return `data:text/css;base64,${base64(bytes)}`;
  }

  const pending: Tree.ParentNode[] = [document];
  while (pending.length) {
    const parent = pending.pop()!;
    const children: Tree.ChildNode[] = [];
    for (const child of parent.childNodes) {
      if (!("tagName" in child)) {
        children.push(child);
        continue;
      }
      const tag = child.tagName.toLowerCase();
      const attr = (name: string) =>
        child.attrs.find((item) => item.name === name)?.value;
      if (activeTags.has(tag)) continue;
      if (tag === "link") {
        const rel = attr("rel")?.toLowerCase().split(/\s+/) ?? [];
        if (
          !rel.includes("stylesheet") ||
          rel.includes("alternate") ||
          attr("disabled") !== undefined
        )
          continue;
        const key = resourceKey(attr("href") ?? "", pageBase);
        const uri = key && stylesheet(key, []);
        if (!uri) continue;
        const style = tree.createElement("style", htmlNamespace, []);
        const media = attr("media");
        if (media) style.attrs.push({ name: "media", value: media });
        tree.insertText(style, `@import url("${uri}");`);
        children.push(style);
        continue;
      }
      if (tag === "style") {
        const text = child.childNodes
          .map((node) => ("value" in node ? node.value : ""))
          .join("");
        child.childNodes = [];
        tree.insertText(
          child,
          css(text, pageBase).replace(/<(?=\/style\b)/gi, "\\3c "),
        );
      }
      if (tag === "textarea") child.childNodes = [];
      const imageAttr =
        tag === "img" ? "src" : tag === "image" ? "href" : undefined;
      const image = imageAttr && embed(attr(imageAttr) ?? "", pageBase, images);
      const poster =
        tag === "video" && embed(attr("poster") ?? "", pageBase, images);
      const background = embed(attr("background") ?? "", pageBase, images);
      child.attrs = child.attrs.filter(({ name, prefix, value }) => {
        if (
          name.startsWith("on") ||
          name.startsWith("data-burbot-") ||
          secretName.test(name) ||
          credentialValue.test(value)
        )
          return false;
        if (name === "href" && !image && fragment.test(value)) return true;
        return (
          !resourceAttributes.has(name) &&
          prefix !== "xlink" &&
          name !== "loading"
        );
      });
      if (image && imageAttr)
        child.attrs.push({ name: imageAttr, value: image });
      if (poster) child.attrs.push({ name: "poster", value: poster });
      if (background)
        child.attrs.push({ name: "background", value: background });
      const style = child.attrs.find(({ name }) => name === "style");
      if (style)
        style.value = css(style.value, pageBase, [], "declarationList");
      if (tag === "form" && attr("inert") === undefined)
        child.attrs.push({ name: "inert", value: "" });
      children.push(child);
      pending.push(child);
    }
    parent.childNodes = children;
  }
  const root = document.childNodes.find(
    (node): node is Tree.Element =>
      "tagName" in node && node.tagName === "html",
  )!;
  const head = root.childNodes.find(
    (node): node is Tree.Element =>
      "tagName" in node && node.tagName === "head",
  )!;
  head.childNodes.unshift(
    ...parseFragment(
      `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`,
    ).childNodes,
  );
  return serialize(document);
}

const cssAssets = new Set([...images, ...fonts]);
