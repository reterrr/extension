import type {
  ElementExtractionSpec,
  PageUrlExtraction,
} from "./extraction";

export interface ElementExtractionCandidateOption {
  label: string;
  raw: string;
  extraction: ElementExtractionSpec;
}

export interface PageUrlExtractionCandidateOption {
  label: string;
  raw: string;
  extraction: PageUrlExtraction;
}

export type ExtractionCandidateOption =
  | ElementExtractionCandidateOption
  | PageUrlExtractionCandidateOption;

export interface ElementExtractionCandidate {
  pageUrl: string;
  selector: string;
  options: ElementExtractionCandidateOption[];
}

export interface PageUrlExtractionCandidate {
  pageUrl: string;
  selector: null;
  options: [PageUrlExtractionCandidateOption];
}

/** UI/picker state before the user chooses one extraction option. */
export type ExtractionCandidate =
  | ElementExtractionCandidate
  | PageUrlExtractionCandidate;
