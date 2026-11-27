import { generate, parse as parseCSS, walk, type CssNode } from "css-tree";
import {
  defaultTreeAdapter as tree,
  parse,
  parseFragment,
  serialize,
} from "parse5";
import type { DefaultTreeAdapterTypes as Tree } from "parse5";
import { readSourceSet } from "../../content/monitoring-comparison";
import { archiveSVG } from "./archive-svg";
import { maxVisualArchiveBytes, secretName } from "./contracts";

const images = new Set([
  "image/png",
  "image/apng",
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

export type FullArchiveRewrite =
  | {
      mode: "capture";
      reference(value: string, base: string): string | undefined;
    }
  | {
      mode: "replay";
      assets: ReadonlyMap<string, { mediaType: string; token: string }>;
      styles: ReadonlyMap<string, { css: string; base: string }>;
    };

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

export function archiveBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

function resourceKey(value: string, base: string) {
  if (!value || value.startsWith("#")) return;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

function scopedImport(css: string, tail: CssNode[]) {
  const wrappers: string[] = [];
  const layer = tail[0];
  if (layer?.type === "Identifier" && layer.name.toLowerCase() === "layer") {
    wrappers.push("@layer");
    tail.shift();
  } else if (
    layer?.type === "Function" &&
    layer.name.toLowerCase() === "layer"
  ) {
    wrappers.push(
      "@layer " +
        layer.children
          .toArray()
          .map((node) => generate(node))
          .join(""),
    );
    tail.shift();
  }
  const supports = tail[0];
  if (
    supports?.type === "Function" &&
    supports.name.toLowerCase() === "supports"
  ) {
    wrappers.push(
      "@supports (" +
        supports.children
          .toArray()
          .map((node) => generate(node))
          .join("") +
        ")",
    );
    tail.shift();
  }
  if (tail.length)
    wrappers.push("@media " + tail.map((node) => generate(node)).join(" "));
  return wrappers.reduceRight((inner, rule) => rule + "{" + inner + "}", css);
}

export function archiveCssReferences(
  text: string,
  visit: (value: string) => void,
) {
  walk(parseCSS(text, { parseCustomProperty: true }), (node) => {
    if (node.type === "Url") visit(node.value);
    if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
      const first =
        node.prelude?.type === "AtrulePrelude" && node.prelude.children.first;
      if (first && first.type === "String") visit(first.value);
    }
    if (node.type === "Function" && /^(?:-webkit-)?image-set$/i.test(node.name))
      for (const child of node.children)
        if (child.type === "String") visit(child.value);
  });
}

// Archive markup is parsed as data. It never becomes the DOM of an extension page.
export function archiveDocument(
  original: string,
  pageBase = "",
  resources: ReadonlyMap<string, ArchiveResource> = new Map(),
  full?: FullArchiveRewrite,
): string {
  const document = parse(original);
  let budget =
    maxVisualArchiveBytes - new TextEncoder().encode(original).length;
  const encoded = new Map<ArchiveResource, string>();
  let stylesheetBudget = 16 * 1024 * 1024;

  const keyFor = (value: string, base: string) =>
    full?.mode === "capture"
      ? full.reference(value, base)
      : resourceKey(value, base);

  function embed(value: string, base: string, types: ReadonlySet<string>) {
    if (value.startsWith("data:")) {
      if (
        full &&
        value.length <= 2 * 1024 * 1024 &&
        /^data:image\/svg\+xml[,;]/i.test(value)
      ) {
        try {
          const split = value.indexOf(",");
          if (split < 0) return undefined;
          const payload = value.slice(split + 1);
          const text = /;base64$/i.test(value.slice(0, split))
            ? new TextDecoder().decode(
                Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)),
              )
            : decodeURIComponent(payload);
          const image = archiveSVG(text);
          return image
            ? "data:image/svg+xml;base64," +
                archiveBase64(new TextEncoder().encode(image))
            : undefined;
        } catch {
          return undefined;
        }
      }
      const type = embedded.exec(value)?.[1].toLowerCase();
      return type && types.has(type) ? value : undefined;
    }
    const key = keyFor(value, base);
    if (full?.mode === "capture") return key;
    if (full?.mode === "replay") {
      const asset = key && full.assets.get(key);
      if (
        asset &&
        (types.has(asset.mediaType) || asset.mediaType === "image/svg+xml")
      )
        return asset.token;
      return;
    }
    const resource = key && resources.get(key);
    if (!resource || !types.has(resource.mediaType)) return;
    const length =
      4 * Math.ceil(resource.bytes.length / 3) + resource.mediaType.length + 13;
    if (length > budget) return;
    budget -= length;
    // Each inline reference occupies bytes in the serialized archive even
    // when the same resource was encoded before. Count every occurrence.
    const uri =
      encoded.get(resource) ??
      "data:" + resource.mediaType + ";base64," + archiveBase64(resource.bytes);
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
      if (
        full?.mode === "replay" &&
        node.type === "Atrule" &&
        node.name.toLowerCase() === "charset" &&
        item &&
        list
      ) {
        list.remove(item);
        return this.skip;
      }
      if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
        const prelude =
          node.prelude?.type === "AtrulePrelude"
            ? node.prelude.children
            : undefined;
        const first = prelude?.first;
        const value =
          first && (first.type === "Url" || first.type === "String")
            ? first.value
            : "";
        const key = keyFor(value, base);
        const style =
          !full &&
          value.startsWith("data:text/css;base64,") &&
          embedded.test(value)
            ? { uri: value }
            : key
              ? stylesheet(key, imports)
              : undefined;
        if (style?.cssText !== undefined && list && item) {
          list.replace(
            item,
            list.createItem({
              type: "Raw",
              value: scopedImport(
                style.cssText,
                prelude?.toArray().slice(1) ?? [],
              ),
            }),
          );
        } else if (
          style?.uri &&
          first &&
          (first.type === "Url" || first.type === "String")
        )
          first.value = style.uri;
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

  function stylesheet(
    key: string,
    imports: readonly string[],
  ): { uri?: string; cssText?: string } | undefined {
    if (full?.mode === "capture") return { uri: key };
    if (full?.mode === "replay") {
      const sheet = full.styles.get(key);
      if (
        !sheet ||
        imports.length >= 8 ||
        imports.includes(key) ||
        sheet.css.length > stylesheetBudget
      )
        return;
      stylesheetBudget -= sheet.css.length;
      return { cssText: css(sheet.css, sheet.base, [...imports, key]) };
    }
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
    return { uri: "data:text/css;base64," + archiveBase64(bytes) };
  }

  const pending: Tree.ParentNode[] = [document];
  while (pending.length) {
    const parent = pending.pop()!;
    const children: Tree.ChildNode[] = [];
    for (const child of parent.childNodes) {
      if (!("tagName" in child)) {
        if (!full || child.nodeName !== "#comment") children.push(child);
        continue;
      }
      const tag = child.tagName.toLowerCase();
      const attr = (name: string) =>
        child.attrs.find((item) => item.name === name)?.value;
      if (activeTags.has(tag)) {
        if (
          full &&
          tag === "template" &&
          attr("shadowrootmode") === "open" &&
          "content" in child
        ) {
          child.attrs = [{ name: "shadowrootmode", value: "open" }];
          children.push(child);
          pending.push((child as Tree.Template).content);
        }
        continue;
      }
      if (tag === "link") {
        const rel = attr("rel")?.toLowerCase().split(/\s+/) ?? [];
        if (
          !rel.includes("stylesheet") ||
          rel.includes("alternate") ||
          attr("disabled") !== undefined
        )
          continue;
        const key = keyFor(attr("href") ?? "", pageBase);
        const sheet = key && stylesheet(key, []);
        if (!sheet) continue;
        const media = attr("media");
        if (full?.mode === "capture" && sheet.uri) {
          child.attrs = [
            { name: "rel", value: "stylesheet" },
            { name: "href", value: sheet.uri },
          ];
          if (media) child.attrs.push({ name: "media", value: media });
          children.push(child);
          continue;
        }
        const style = tree.createElement("style", htmlNamespace, []);
        if (media) style.attrs.push({ name: "media", value: media });
        tree.insertText(
          style,
          sheet.cssText !== undefined
            ? sheet.cssText.replace(/<(?=\/style\b)/gi, "\\3c ")
            : '@import url("' + sheet.uri + '");',
        );
        children.push(style);
        continue;
      }
      if (tag === "style") {
        const fallback = attr("data-burbot-style-fallback");
        if (full?.mode === "replay" && fallback && full.styles.has(fallback))
          continue;
        const text = child.childNodes
          .map((node) => ("value" in node ? node.value : ""))
          .join("");
        child.childNodes = [];
        tree.insertText(
          child,
          css(
            text,
            (attr("data-burbot-style-base") &&
              resourceKey(attr("data-burbot-style-base")!, pageBase)) ||
              pageBase,
          ).replace(/<(?=\/style\b)/gi, "\\3c "),
        );
      }
      if (
        tag === "textarea" ||
        (full &&
          attr("contenteditable") !== undefined &&
          attr("contenteditable") !== "false")
      )
        child.childNodes = [];
      const imageAttr =
        tag === "img" ? "src" : tag === "image" ? "href" : undefined;
      const image = imageAttr && embed(attr(imageAttr) ?? "", pageBase, images);
      const srcset =
        full &&
        (tag === "img" ||
          (tag === "source" &&
            "tagName" in parent &&
            parent.tagName === "picture"))
          ? readSourceSet(attr("srcset") ?? "", pageBase)
              ?.flatMap(([url, descriptor]) => {
                const archived = embed(url, pageBase, images);
                return archived ? [archived + " " + descriptor] : [];
              })
              .join(", ")
          : undefined;
      const poster =
        tag === "video" && embed(attr("poster") ?? "", pageBase, images);
      const background = embed(attr("background") ?? "", pageBase, images);
      const fallback =
        tag === "style" &&
        full?.mode === "capture" &&
        attr("data-burbot-style-fallback");
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
      if (fallback) {
        const safeFallback = keyFor(fallback, pageBase);
        if (safeFallback)
          child.attrs.push({
            name: "data-burbot-style-fallback",
            value: safeFallback,
          });
      }
      if (image && imageAttr)
        child.attrs.push({ name: imageAttr, value: image });
      if (srcset) child.attrs.push({ name: "srcset", value: srcset });
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
