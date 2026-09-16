import type { PdfTextSelector, SelectionQuote } from "../types/extraction";
import type { PdfTextExtractionCandidate } from "../types/picker";

const DEFAULT_CONTEXT = 80;

function assertOffset(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

export function normalizePdfPageText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function buildPdfSelectionQuote(
  pageText: string,
  start: number,
  end: number,
  contextLength = DEFAULT_CONTEXT,
): SelectionQuote {
  assertOffset(start, "Selection start");
  assertOffset(end, "Selection end");
  if (end <= start || end > pageText.length) {
    throw new Error("Select a non-empty value inside one PDF page.");
  }
  if (!Number.isSafeInteger(contextLength) || contextLength < 0) {
    throw new Error("Context length must be a non-negative integer.");
  }

  const exact = pageText.slice(start, end);
  if (!exact.trim()) throw new Error("The selected PDF value is empty.");

  return {
    exact,
    prefix: pageText.slice(Math.max(0, start - contextLength), start),
    suffix: pageText.slice(end, end + contextLength),
  };
}

function quoteMatchesAt(pageText: string, quote: SelectionQuote, start: number): boolean {
  if (pageText.slice(start, start + quote.exact.length) !== quote.exact) return false;

  if (quote.prefix) {
    const before = pageText.slice(Math.max(0, start - quote.prefix.length), start);
    if (before !== quote.prefix) return false;
  }

  if (quote.suffix) {
    const after = pageText.slice(
      start + quote.exact.length,
      start + quote.exact.length + quote.suffix.length,
    );
    if (after !== quote.suffix) return false;
  }

  return true;
}

export function resolvePdfTextSelector(
  pageText: string,
  selector: PdfTextSelector,
): string {
  if (!Number.isSafeInteger(selector.pageNumber) || selector.pageNumber < 1) {
    throw new Error("PDF page number must be a positive integer.");
  }

  const quote = selector.quote;
  if (!quote?.exact) throw new Error("PDF selector has no exact text quote.");

  const matches: number[] = [];
  for (
    let index = pageText.indexOf(quote.exact);
    index !== -1;
    index = pageText.indexOf(quote.exact, index + 1)
  ) {
    if (quoteMatchesAt(pageText, quote, index)) matches.push(index);
    if (matches.length > 1) break;
  }

  if (matches.length === 0) {
    throw new Error("PDF selector no longer matches this page.");
  }
  if (matches.length !== 1) {
    throw new Error("PDF selector is ambiguous. Select a larger text fragment.");
  }

  return quote.exact;
}

export function createPdfTextCandidate(
  sourceId: string,
  sourceUrl: string,
  pageNumber: number,
  pageText: string,
  start: number,
  end: number,
): PdfTextExtractionCandidate {
  if (!sourceId) throw new Error("PDF source id is required.");
  const url = new URL(sourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PDF extraction requires an HTTP(S) source URL.");
  }

  const quote = buildPdfSelectionQuote(pageText, start, end);
  const selector: PdfTextSelector = { pageNumber, quote };
  // Validate uniqueness before persisting the candidate.
  resolvePdfTextSelector(pageText, selector);

  return {
    pageUrl: url.href,
    selector: null,
    options: [
      {
        label: `PDF text · page ${pageNumber}`,
        raw: quote.exact,
        extraction: {
          type: "pdfText",
          sourceId,
          selector,
        },
      },
    ],
  };
}
