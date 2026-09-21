const EXPORT_SERVICE_URL = "http://127.0.0.1:8766";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch {
    // Fall through to the HTTP status.
  }
  return response.statusText || `HTTP ${response.status}`;
}

function filenameFrom(response: Response): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/i);
  return (
    match?.[1] || `burbot-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

const button = document.getElementById(
  "export-excel",
) as HTMLButtonElement | null;
const notice = document.getElementById("notice");

if (button && notice) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    notice.className = "";
    notice.textContent = "Eksportuję zatwierdzony stan SQLite do Excela…";

    try {
      const response = await fetch(`${EXPORT_SERVICE_URL}/export.xlsx`);
      if (!response.ok) throw new Error(await responseError(response));

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const menu = document.getElementById(
        "more",
      ) as HTMLDetailsElement | null;
      if (menu) menu.open = false;
      notice.textContent = "Wyeksportowano SQLite do pliku Excel.";
    } catch (error) {
      notice.className = "error";
      const detail = errorMessage(error);
      notice.textContent = detail.includes("Failed to fetch")
        ? 'Usługa eksportu nie działa. Uruchom lokalnie "npm run db" i spróbuj ponownie.'
        : `Nie udało się wyeksportować Excela: ${detail}`;
    } finally {
      button.disabled = false;
    }
  });
}

export {};
