import type { SelectionExtraction } from "../shared/types/extraction";

/**
 * Resolve a selection after its DOM container moved.
 *
 * Full prefix+suffix context may safely locate a changed value. If either side
 * of the context is missing, only the original exact text is accepted and only
 * when it is unique on the page; this prevents a selection captured at an
 * element boundary from expanding to the remainder of the document.
 */
export function readSelectionFromDocument(
  extraction: SelectionExtraction,
): string {
  const source =
    document.body?.textContent ?? document.documentElement.textContent ?? "";
  const quote = extraction.quote;

  if (quote.prefix && quote.suffix) {
    try {
      return BurbotCore.selectedText(source, quote);
    } catch {
      // Exact unique text is still a safe fallback below.
    }
  }

  const pageText = BurbotCore.clean(source);
  const exact = BurbotCore.clean(quote.exact);
  if (!exact) throw new Error("Selection quote is empty.");

  const positions = BurbotCore.occurrences(pageText, exact);
  if (positions.length !== 1) {
    throw new Error(
      "Selection moved and its text is no longer unique on the page.",
    );
  }

  return exact;
}
