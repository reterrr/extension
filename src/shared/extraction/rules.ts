import type {
  CapturedExtractionInput,
  ExtractionRule,
} from "../types/extraction";
import type {
  ExtractionCandidate,
  ExtractionCandidateOption,
  PageUrlExtractionCandidate,
} from "../types/picker";

export function createExtractionRule(
  candidate: ExtractionCandidate,
  option: ExtractionCandidateOption,
): ExtractionRule {
  if (option.extraction.type === "pageUrl") {
    return {
      pageUrl: candidate.pageUrl,
      selector: null,
      extraction: option.extraction,
    };
  }

  if (option.extraction.type === "pdfText") {
    return {
      pageUrl: candidate.pageUrl,
      selector: null,
      extraction: option.extraction,
    };
  }

  if (candidate.selector === null) {
    throw new Error("Element extraction requires a DOM selector.");
  }

  return {
    pageUrl: candidate.pageUrl,
    selector: candidate.selector,
    ...(candidate.selectorFallbacks?.length
      ? { selectorFallbacks: candidate.selectorFallbacks }
      : {}),
    extraction: option.extraction,
  };
}

export function createCapturedExtractionInput(
  candidate: ExtractionCandidate,
  option: ExtractionCandidateOption,
): CapturedExtractionInput {
  const rule = createExtractionRule(candidate, option);
  return { ...rule, raw: option.raw } as CapturedExtractionInput;
}

export function createPageUrlCandidate(
  pageUrl: string,
): PageUrlExtractionCandidate {
  return {
    pageUrl,
    selector: null,
    options: [
      {
        label: "Page URL",
        raw: pageUrl,
        extraction: { type: "pageUrl" },
      },
    ],
  };
}
