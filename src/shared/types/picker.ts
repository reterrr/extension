import type {
  ElementExtractionSpec,
  PageUrlExtraction,
  PdfTextExtraction,
} from "./extraction";
import type { SelectorVersion } from "./selectors";

export interface ElementExtractionCandidateOption {
  label: string;
  raw: string;
  extraction: ElementExtractionSpec;
  selectorVersion?: SelectorVersion;
}

export interface PageUrlExtractionCandidateOption {
  label: string;
  raw: string;
  extraction: PageUrlExtraction;
}

export interface PdfTextExtractionCandidateOption {
  label: string;
  raw: string;
  extraction: PdfTextExtraction;
}

export type ExtractionCandidateOption =
  | ElementExtractionCandidateOption
  | PageUrlExtractionCandidateOption
  | PdfTextExtractionCandidateOption;

export interface ElementExtractionCandidate {
  pageUrl: string;
  selector: string;
  selectorFallbacks?: string[];
  options: ElementExtractionCandidateOption[];
}

export interface PageUrlExtractionCandidate {
  pageUrl: string;
  selector: null;
  options: [PageUrlExtractionCandidateOption];
}

export interface PdfTextExtractionCandidate {
  pageUrl: string;
  selector: null;
  options: [PdfTextExtractionCandidateOption];
}

/** UI/picker state before the user chooses one extraction option. */
export type ExtractionCandidate =
  | ElementExtractionCandidate
  | PageUrlExtractionCandidate
  | PdfTextExtractionCandidate;
