let pendingChoice = "";
let restoring = false;

function currentChoiceControl(): HTMLSelectElement | null {
  const control = document.getElementById("edit-value");
  return control instanceof HTMLSelectElement ? control : null;
}

function updateEvidenceButtonLabel(): void {
  const button = document.getElementById("selected-text");
  if (!(button instanceof HTMLButtonElement)) return;
  button.textContent = currentChoiceControl()
    ? "Use selected text as evidence"
    : "Use selected text";
}

function rememberChoice(): void {
  const control = currentChoiceControl();
  pendingChoice = control?.value ?? "";
}

function restoreChoice(): void {
  if (restoring || !pendingChoice) {
    updateEvidenceButtonLabel();
    return;
  }

  const control = currentChoiceControl();
  if (!control) {
    updateEvidenceButtonLabel();
    return;
  }

  const optionExists = Array.from(control.options).some(
    (option) => option.value === pendingChoice,
  );
  if (!optionExists) {
    pendingChoice = "";
    updateEvidenceButtonLabel();
    return;
  }

  restoring = true;
  control.value = pendingChoice;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  pendingChoice = "";
  restoring = false;
  updateEvidenceButtonLabel();
}

export function initChoiceEvidenceUi(): void {
  const selectedText = document.getElementById("selected-text");
  selectedText?.addEventListener("click", rememberChoice, true);

  const root = document.getElementById("value-control");
  if (root) {
    const observer = new MutationObserver(() => {
      queueMicrotask(restoreChoice);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  document.addEventListener("input", (event) => {
    if (event.target === currentChoiceControl()) updateEvidenceButtonLabel();
  });

  updateEvidenceButtonLabel();
}
