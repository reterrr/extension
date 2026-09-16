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

  if (
    rule.selector !== null &&
    rule.selectorFallbacks?.length &&
    rule.extraction.type !== "pageUrl" &&
    rule.extraction.type !== "pdfText"
  ) {
    // The current legacy domain core reconstructs the rule envelope but copies
    // `extraction` verbatim. Mirror the fallback list there so it survives that
    // boundary until the core is removed in favor of typed repositories.
    return {
      ...rule,
      extraction: {
        ...rule.extraction,
        selectorFallbacks: rule.selectorFallbacks,
      },
      raw: option.raw,
    } as CapturedExtractionInput;
  }

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
