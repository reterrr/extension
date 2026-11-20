import {
  captureMessage,
  maxSnapshotBytes,
  monitoredURL,
  secretName,
  sha256,
  type Capture,
  type CaptureMessage,
} from "../shared/monitoring/contracts";
import {
  validateSelectorEvaluation,
  validateSelectorTree,
} from "../shared/selectors/validation.js";
import {
  createDOMSelectorRuntime,
  evaluateSelectorVersion,
} from "./selector-resolver";

const settleQuietMs = 600;
const settleMaxMs = 4_000;

function settleDOM(): Promise<void> {
  return new Promise((resolve) => {
    let location = document.URL;
    let lastChange = performance.now();
    const started = lastChange;
    const observer = new MutationObserver(() => {
      lastChange = performance.now();
    });
    observer.observe(document, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
    const timer = setInterval(() => {
      const now = performance.now();
      if (document.URL !== location) {
        location = document.URL;
        lastChange = now;
      }
      if (
        (document.readyState !== "loading" &&
          now - lastChange >= settleQuietMs) ||
        now - started >= settleMaxMs
      ) {
        observer.disconnect();
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

function safeReference(value: string, base: string): boolean {
  try {
    const url = new URL(value, base);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      [
        ...url.searchParams.keys(),
        ...new URLSearchParams(url.hash.slice(1)).keys(),
      ].every((key) => !secretName.test(key))
    );
  } catch {
    return false;
  }
}

export function sanitizedDOM(doc: Document, pageUrl: string): Document {
  const snapshot = doc.implementation.createHTMLDocument("");
  snapshot.replaceChild(
    snapshot.importNode(doc.documentElement, true),
    snapshot.documentElement,
  );
  const remove = [
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "frame",
    "object",
    "embed",
    "input",
    "textarea",
    "select",
    "[contenteditable]",
    "meta[http-equiv]",
    "base",
    "[data-burbot-selector-highlight]",
    "[data-burbot-picker]",
    "[data-burbot-import-review-highlight]",
  ];
  for (const node of snapshot.querySelectorAll(remove.join(","))) node.remove();
  const walker = snapshot.createTreeWalker(snapshot, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  for (const node of snapshot.querySelectorAll("*")) {
    if (
      node.tagName.toLowerCase() === "meta" &&
      secretName.test(node.getAttribute("name") ?? "")
    ) {
      node.remove();
      continue;
    }
    for (const { name, value } of [...node.attributes]) {
      if (
        name.startsWith("on") ||
        name === "nonce" ||
        name === "srcset" ||
        name === "imagesrcset" ||
        (name === "style" && /(?:url|image-set)\s*\(/i.test(value)) ||
        name === "srcdoc" ||
        name === "value" ||
        name.startsWith("data-burbot-") ||
        secretName.test(name) ||
        /\b(?:access[_-]?token|password|csrf[_-]?token|session[_-]?id)\s*[:=]/i.test(
          value,
        ) ||
        ([
          "src",
          "href",
          "xlink:href",
          "action",
          "formaction",
          "poster",
          "ping",
        ].includes(name) &&
          !safeReference(value, pageUrl))
      )
        node.removeAttribute(name);
    }
  }
  const base = snapshot.createElement("base");
  base.href = safeReference(doc.baseURI, pageUrl) ? doc.baseURI : pageUrl;
  snapshot.head?.prepend(base);
  return snapshot;
}

export function shape(snapshot: Document): string {
  const indexes = new Map<Element, number>();
  return JSON.stringify(
    Array.from(snapshot.querySelectorAll("*"), (node, index) => {
      indexes.set(node, index);
      return [
        node.parentElement ? indexes.get(node.parentElement) : null,
        node.namespaceURI,
        node.localName,
        [...node.attributes].map((attribute) => attribute.name).sort(),
      ];
    }),
  );
}

function cleanResult(result: {
  status: string;
  diagnostic?: string;
  rawValue?: string;
}) {
  if (result.diagnostic !== undefined) result.diagnostic = result.status;
  if (result.rawValue?.includes("\u0000"))
    throw new Error("Unsupported character in literal.");
}

async function capture(message: CaptureMessage): Promise<Capture> {
  await settleDOM();
  if (document.contentType !== "text/html")
    throw new Error("Source must be HTML.");
  const pageUrl = document.URL;
  if (!message.expectedOrigins.includes(monitoredURL(pageUrl).origin))
    throw new Error("Source navigated outside its approval.");
  const capturedAt = new Date().toISOString();
  const dom = sanitizedDOM(document, pageUrl);
  const html = "<!doctype html>\n" + dom.documentElement.outerHTML;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  if (!bytes.length || bytes.length > maxSnapshotBytes)
    throw new Error("Snapshot exceeds the size limit.");
  const runtime = createDOMSelectorRuntime(dom);
  const evaluations = message.selectors.map((pin) => {
    const definition = pin.definition;
    validateSelectorTree({
      selector: {
        uuid: pin.selectorUuid,
        createdAt: definition.createdAt,
        target: { objectId: "monitoring", field: "monitoring" },
        activeVersionUuid: pin.versionUuid,
      },
      versions: [definition],
    });
    if (
      definition.uuid !== pin.versionUuid ||
      definition.versionNo !== pin.versionNo ||
      !/^[a-f0-9]{64}$/.test(pin.definitionFingerprint)
    )
      throw new Error("Invalid selector version.");
    const result = evaluateSelectorVersion(definition, runtime);
    validateSelectorEvaluation(result, definition);
    cleanResult(result);
    for (const recipe of result.recipeResults) {
      cleanResult(recipe);
      for (const part of recipe.partResults) {
        cleanResult(part);
        part.locatorResults.forEach(cleanResult);
      }
    }
    return { definitionFingerprint: pin.definitionFingerprint, result };
  });
  const [contentHash, structureHash] = await Promise.all([
    sha256(bytes),
    sha256(encoder.encode(shape(dom))),
  ]);
  return {
    html,
    contentHash,
    structureHash,
    contentSize: bytes.length,
    capturedAt,
    pageUrl,
    evaluations,
  };
}

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const input = message as Partial<CaptureMessage> | null;
  if (sender.id !== browser.runtime.id || input?.type !== captureMessage)
    return undefined;
  return capture(input as CaptureMessage).catch(() => null);
});
