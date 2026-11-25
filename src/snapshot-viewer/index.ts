import {
  snapshotViewerReady,
  snapshotViewerStore,
  uuid,
  type ViewerPayload,
} from "../shared/monitoring/snapshot-viewer-store";
import { archivePreview, inspectionDocument } from "./dom";

type Locator = {
  kind: string;
  selector?: string;
  expression?: string;
  elementId?: string;
};
type Selector = {
  version?: {
    uuid: string;
    versionNo: number;
    status: string;
    recipes: { parts: { locators: Locator[] }[] }[];
  };
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function diagnostics(label: string, data: unknown) {
  const details = element("details");
  details.append(
    element("summary", label),
    element("pre", JSON.stringify(data, null, 2)),
  );
  return details;
}

function showSelectors(payload: ViewerPayload) {
  const section = document.getElementById("selector")!;
  const version = (payload.selector as Selector | null)?.version;
  if (!version) {
    section.append(
      element("p", "This capture was opened without a recorded selector."),
    );
    return;
  }
  section.append(
    element("h2", `SelectorTree · Version ${version.versionNo}`),
    element("p", `${version.status} · ${version.uuid}`),
  );
  let offline: XMLDocument | undefined;
  for (const [index, recipe] of version.recipes.entries()) {
    section.append(element("h3", `Recipe ${index + 1}`));
    for (const part of recipe.parts) {
      for (const locator of part.locators) {
        const row = element("div");
        row.className = "locator";
        const expression =
          locator.selector ?? locator.expression ?? locator.elementId;
        row.append(element("span", locator.kind), element("code", expression));
        if (
          expression &&
          ["css_path", "xpath", "element_id"].includes(locator.kind)
        ) {
          const result = element("span");
          result.className = "result";
          result.setAttribute("aria-live", "polite");
          const test = element("button", "Test locator");
          test.addEventListener("click", () => {
            try {
              offline ??= inspectionDocument(payload.html, document);
              const count =
                locator.kind === "xpath"
                  ? offline.evaluate(
                      expression,
                      offline,
                      null,
                      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    ).snapshotLength
                  : locator.kind === "element_id"
                    ? Array.from(offline.querySelectorAll("[id]")).filter(
                        (node) => node.id === expression,
                      ).length
                    : offline.querySelectorAll(expression).length;
              result.textContent = `${count} ${count === 1 ? "match" : "matches"}`;
            } catch {
              result.textContent = "Could not evaluate locator";
            }
          });
          row.append(test, result);
        }
        section.append(row);
      }
    }
  }
  if (payload.evaluation)
    section.append(
      diagnostics("Recorded execution diagnostics", payload.evaluation),
    );
  section.append(diagnostics("Recorded SelectorTree", payload.selector));
}

async function start() {
  const loading = document.getElementById("loading")!;
  const id = location.hash.slice(1);
  const payload = uuid.test(id)
    ? (await snapshotViewerStore.get(id).catch(() => undefined))?.payload
    : undefined;
  if (!payload) {
    loading.textContent =
      "This capture is unavailable. Open it again from Burbot Studio.";
    return;
  }
  document.title = `Burbot · Snapshot #${payload.snapshotId}`;
  document.getElementById("title")!.textContent =
    `Snapshot #${payload.snapshotId}`;
  document.getElementById("capture")!.textContent =
    `Source #${payload.sourceId} · ${new Date(payload.capturedAt).toLocaleString()}`;
  document.getElementById("source")!.textContent = payload.sourceUrl ?? "";
  document.getElementById("original")!.textContent = payload.html;
  try {
    (document.getElementById("archive") as HTMLIFrameElement).srcdoc =
      archivePreview(payload.html);
  } catch {
    document
      .getElementById("page")!
      .append(
        element(
          "p",
          "Page layout unavailable. The original markup is in HTML source.",
        ),
      );
  }
  try {
    showSelectors(payload);
  } catch {
    document
      .getElementById("selector")!
      .append(element("p", "Selector details are unavailable."));
  }
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-panel]"),
  );
  for (const button of buttons)
    button.addEventListener("click", () => {
      for (const candidate of buttons) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
        document.getElementById(candidate.dataset.panel!)!.hidden =
          candidate !== button;
      }
    });
  loading.hidden = true;
  document.getElementById("viewer")!.hidden = false;
  void browser.runtime
    .sendMessage({ type: snapshotViewerReady, id })
    .catch(() => undefined);
}

void start();
