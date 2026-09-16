import { createPdfTextCandidate } from "../shared/pdf/textSelector";

const params = new URLSearchParams(location.search);
const objectId = params.get("objectId") ?? "";
const sourceId = params.get("sourceId") ?? "";

function selectionPageElement(node: Node | null): HTMLElement | null {
  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>(".pdf-page-text") ?? null;
}

async function sendSelectionToSidebar(): Promise<void> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const startPage = selectionPageElement(range.startContainer);
  const endPage = selectionPageElement(range.endContainer);
  if (!startPage || !endPage || startPage !== endPage) return;

  const sourceUrl = document.querySelector<HTMLAnchorElement>("#source-url")?.href;
  if (!sourceUrl || !objectId || !sourceId) return;

  const pageNumber = Number(startPage.dataset.pageNumber);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return;

  const before = document.createRange();
  before.selectNodeContents(startPage);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;

  const candidate = createPdfTextCandidate(
    sourceId,
    sourceUrl,
    pageNumber,
    startPage.textContent ?? "",
    start,
    end,
  );
  const currentWindow = await browser.windows.getCurrent();

  await browser.runtime.sendMessage({
    type: "BURBOT_PDF_CAPTURE",
    windowId: currentWindow.id,
    objectId,
    sourceId,
    candidate,
  });
}

export function initPdfSidebarBridge(): void {
  const pages = document.getElementById("pages");
  if (!pages) return;

  const emit = () => {
    void sendSelectionToSidebar().catch(() => undefined);
  };

  pages.addEventListener("mouseup", emit);
  pages.addEventListener("keyup", emit);
}
