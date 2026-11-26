import {
  captureMessage,
  comparisonVersion,
  hasSensitiveParameters,
  maxSnapshotBytes,
  maxVisualArchiveBytes,
  monitoredURL,
  secretName,
  sha256,
  type Capture,
  type CaptureMessage,
  type SnapshotComparison,
  type VisualMarkup,
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

function visualMarkup(
  doc: Document,
  pageUrl: string,
): VisualMarkup | undefined {
  try {
    const archive = doc.implementation.createHTMLDocument("");
    archive.replaceChild(
      archive.importNode(doc.documentElement, true),
      archive.documentElement,
    );
    // Use Firefox's selected image candidate without waking lazy images.
    const copies = Array.from(archive.querySelectorAll("img"));
    Array.from(doc.images).forEach((image, index) => {
      const copy = copies[index];
      if (image.currentSrc && copy) copy.setAttribute("src", image.currentSrc);
    });
    // CSSOM is a fallback when a stylesheet came from cache or the user has not
    // granted Firefox's optional response-filter permission. It represents the
    // rules the page actually loaded, not a second network fetch.
    function readableRules(sheet: CSSStyleSheet): string | undefined {
      try {
        return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      } catch {
        // Cross-origin stylesheets without CORS are opaque to CSSOM. Keep the
        // original link so the separately captured response can be used.
        return undefined;
      }
    }

    const styleCopies = Array.from(archive.querySelectorAll("style"));
    Array.from(doc.querySelectorAll("style")).forEach((element, index) => {
      const sheet = element.sheet;
      const copy = styleCopies[index];
      if (!copy || !sheet) return;
      if (sheet.disabled) {
        copy.remove();
        return;
      }
      const rules = readableRules(sheet);
      if (rules !== undefined) copy.textContent = rules;
    });

    const linkCopies = Array.from(archive.querySelectorAll("link"));
    Array.from(doc.querySelectorAll("link")).forEach((link, index) => {
      const copy = linkCopies[index];
      if (!copy) return;
      if (link.disabled || link.sheet?.disabled) {
        copy.remove();
        return;
      }
      if (!link.relList.contains("stylesheet") || !link.sheet) return;
      const rules = readableRules(link.sheet);
      if (rules === undefined) return;
      const style = archive.createElement("style");
      // CSS url(...) inside an external stylesheet resolves relative to the
      // stylesheet, not the document. Preserve its base for offline rewriting.
      if (safeReference(link.href, pageUrl))
        style.setAttribute("data-burbot-style-base", link.href);
      if (link.media) style.setAttribute("media", link.media);
      style.textContent = rules;
      copy.replaceWith(style);
    });
    for (const sheet of doc.adoptedStyleSheets ?? []) {
      if (sheet.disabled) continue;
      const rules = readableRules(sheet);
      if (rules === undefined) continue;
      const style = archive.createElement("style");
      style.textContent = rules;
      archive.head.append(style);
    }
    for (const node of archive.querySelectorAll(
      "script,iframe,object,embed,template",
    ))
      node.remove();
    const doctype = doc.compatMode === "CSS1Compat" ? "<!doctype html>\n" : "";
    const html = doctype + archive.documentElement.outerHTML;
    // The visual representation may contain CSSOM rules in addition to DOM.
    // Apply its own archive limit, not the smaller canonical evidence limit.
    if (new TextEncoder().encode(html).length > maxVisualArchiveBytes)
      return undefined;
    return {
      html,
      baseUrl: safeReference(doc.baseURI, pageUrl) ? doc.baseURI : pageUrl,
    };
  } catch {
    // Visual capture cannot invalidate the separately collected evidence.
    return undefined;
  }
}

async function capture(
  message: CaptureMessage,
): Promise<Capture & { visualMarkup?: VisualMarkup }> {
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
  const archive = message.visualArchive && visualMarkup(document, pageUrl);
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
    ...(archive && { visualMarkup: archive }),
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
