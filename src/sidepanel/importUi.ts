import { createImportReviewSession, importReviewView } from "../shared/import/review";
import {
  readImportReview,
  writeImportReview,
} from "../shared/import/reviewStore";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const button = document.getElementById("import") as HTMLButtonElement | null;
const input = document.getElementById("import-file") as HTMLInputElement | null;
const notice = document.getElementById("notice");

if (button && input && notice) {
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    button.disabled = true;
    notice.className = "";
    notice.textContent = "Przygotowuję import do review…";

    try {
      const existing = await readImportReview();
      if (
        existing &&
        !confirm("Masz już aktywny import review. Zastąpić go nowym plikiem?")
      ) {
        notice.textContent = "Import anulowany.";
        return;
      }

      const document = JSON.parse(await file.text()) as unknown;
      const session = createImportReviewSession(
        document,
        file.name,
        () => crypto.randomUUID(),
        new Date().toISOString(),
      );
      await writeImportReview(session);
      const view = importReviewView(session);
      notice.textContent = `Załadowano ${view.objects.length} obiektów do review. Nic nie trafiło jeszcze do commita.`;
      window.dispatchEvent(
        new CustomEvent("burbot:import-review-changed", { detail: { open: true } }),
      );
    } catch (error) {
      notice.className = "error";
      notice.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
}

export {};
