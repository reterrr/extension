import { secretName } from "./contracts";

const svgNamespace = "http://www.w3.org/2000/svg";
const local = /^#[\w.:-]+$/;
const active =
  /^(?:script|style|foreignObject|a|animate\w*|set|discard|iframe)$/i;

/** Retain static SVG shapes without active content, scripts or external references. */
export function archiveSVG(text: string) {
  const svg = new DOMParser().parseFromString(
    text,
    "image/svg+xml",
  ).documentElement;
  if (svg.namespaceURI !== svgNamespace || svg.localName !== "svg")
    return undefined;
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    if (node.namespaceURI !== svgNamespace || active.test(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value;
      if (
        name.startsWith("on") ||
        secretName.test(name) ||
        (name === "href" && !local.test(value)) ||
        /(?:@import|(?:https?|javascript|data|blob):)/i.test(value) ||
        /url\(/i.test(value.replace(/url\(\s*['"]?#[\w.:-]+['"]?\s*\)/gi, ""))
      ) {
        if (attr.namespaceURI !== "http://www.w3.org/2000/xmlns/")
          node.removeAttributeNode(attr);
      }
    }
  }
  return new XMLSerializer().serializeToString(svg);
}
