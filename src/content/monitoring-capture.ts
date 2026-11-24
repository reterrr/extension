import {
  captureMessage,
  comparisonVersion,
  hasSensitiveParameters,
  maxSnapshotBytes,
  monitoredURL,
  secretName,
  sha256,
  type Capture,
  type CaptureMessage,
  type SnapshotComparison,
} from "../shared/monitoring/contracts";
import {
  validateSelectorEvaluation,
  validateSelectorTree,
} from "../shared/selectors/validation.js";
import {
  createDOMSelectorRuntime,
  evaluateSelectorVersion,
} from "./selector-resolver";
import {
  comparisonRepresentation,
  isResponsiveImage,
  readSourceSet,
  shape,
  type SourceSet,
} from "./monitoring-comparison";

export { shape };

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
      !hasSensitiveParameters(url)
    );
  } catch {
    return false;
  }
}

export function sanitizedDOM(
  doc: Document,
  pageUrl: string,
  nativeSourceSets?: Map<Element, SourceSet>,
): Document {
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
    "div[data-burbot-import-review-focused]",
    "div#automa-palette",
  ];
  for (const node of Array.from(snapshot.querySelectorAll(remove.join(","))))
    node.remove();
  const walker = snapshot.createTreeWalker(snapshot, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  const baseUrl = safeReference(doc.baseURI, pageUrl) ? doc.baseURI : pageUrl;
  for (const node of Array.from(snapshot.querySelectorAll("*"))) {
    if (
      node.tagName.toLowerCase() === "meta" &&
      secretName.test(node.getAttribute("name") ?? "")
    ) {
      node.remove();
      continue;
    }
    for (const { name, value } of Array.from(node.attributes)) {
      // Evidence keeps its existing srcset redaction. Retain only validated
      // image candidates for the comparison before removing the raw attribute.
      if (nativeSourceSets && name === "srcset" && isResponsiveImage(node)) {
        const sourceSet = readSourceSet(value, baseUrl);
        if (sourceSet) nativeSourceSets.set(node, sourceSet);
      }
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
  base.href = baseUrl;
  snapshot.head?.prepend(base);
  return snapshot;
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
  const pageOrigin = monitoredURL(pageUrl, {
    allowHttp: message.allowHttp,
  }).origin;
  if (!message.expectedOrigins.includes(pageOrigin))
    throw new Error("Source navigated outside its approval.");
  const capturedAt = new Date().toISOString();
  const nativeSourceSets =
    message.comparisonVersion === comparisonVersion
      ? new Map<Element, SourceSet>()
      : undefined;
  const dom = sanitizedDOM(document, pageUrl, nativeSourceSets);
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
  const normalized =
    nativeSourceSets && comparisonRepresentation(dom, nativeSourceSets);
  const [contentHash, structureHash, comparison] = await Promise.all([
    sha256(bytes),
    sha256(encoder.encode(shape(dom))),
    normalized &&
      Promise.all([
        sha256(encoder.encode(normalized.content)),
        sha256(encoder.encode(normalized.structure)),
      ]).then<SnapshotComparison>(([contentHash, structureHash]) => ({
        version: comparisonVersion,
        contentHash,
        structureHash,
      })),
  ]);
  return {
    html,
    contentHash,
    structureHash,
    ...(comparison && { comparison }),
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
