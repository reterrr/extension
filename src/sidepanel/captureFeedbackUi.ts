let initialized = false;

function syncFeedback(globalNotice: HTMLElement, captureNotice: HTMLElement): void {
  const text = globalNotice.textContent?.trim() ?? "";
  captureNotice.textContent = text;
  captureNotice.hidden = !text;
  captureNotice.classList.toggle("error", globalNotice.classList.contains("error"));
}

export function initCaptureFeedbackUi(): void {
  if (initialized) return;
  initialized = true;

  const captureArea = document.getElementById("capture-area");
  const captureHeading = captureArea?.querySelector(".capture-heading");
  const globalNotice = document.getElementById("notice");
  if (!captureArea || !captureHeading || !globalNotice) return;

  const captureNotice = document.createElement("p");
  captureNotice.id = "capture-notice";
  captureNotice.hidden = true;
  captureHeading.insertAdjacentElement("afterend", captureNotice);

  if (!document.querySelector("style[data-burbot-capture-feedback]")) {
    const style = document.createElement("style");
    style.dataset.burbotCaptureFeedback = "true";
    style.textContent = `
#capture-notice {
  margin: 7px 0 2px;
  padding: 7px 8px;
  border-radius: 6px;
  background: #edf4eb;
  color: #436349;
  font-size: 10px;
  overflow-wrap: anywhere;
}
#capture-notice.error {
  background: #f8e9e7;
  color: #9d3d3d;
  border: 1px solid #ecc9c4;
}
`;
    document.head.append(style);
  }

  const observer = new MutationObserver(() => syncFeedback(globalNotice, captureNotice));
  observer.observe(globalNotice, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  syncFeedback(globalNotice, captureNotice);
}
