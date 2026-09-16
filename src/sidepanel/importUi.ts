interface DataResponse<T = unknown> {
  ok?: boolean;
  value?: T;
  error?: string;
}

interface StateRevision {
  revision: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function data<T>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const result = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op,
    ...extra,
  })) as DataResponse<T>;
  if (!result?.ok) throw new Error(result?.error || "Storage is unavailable.");
  return result.value as T;
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
    notice.textContent = "Importing…";

    try {
      const document = JSON.parse(await file.text()) as unknown;
      const current = await data<StateRevision>("GET");
      const beforeCount = Array.isArray((current as { objects?: unknown[] }).objects)
        ? (current as { objects: unknown[] }).objects.length
        : 0;
      const next = await data<StateRevision & { objects?: unknown[] }>("IMPORT", {
        expectedRevision: current.revision,
        document,
      });
      const afterCount = Array.isArray(next.objects) ? next.objects.length : beforeCount;
      const imported = Math.max(0, afterCount - beforeCount);
      notice.textContent = `Imported ${imported} ${imported === 1 ? "object" : "objects"}.`;
    } catch (error) {
      notice.className = "error";
      notice.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
}

export {};
