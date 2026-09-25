import type {
  ExecutableExtractionRule,
  ExtractionRuleRunResult,
  ExtractionSpec,
  SelectionQuote,
} from "../types/extraction";
import type { ElementExtractionCandidate } from "../types/picker";
import { isSourceFileType, type RemoteFileSourceCandidate } from "../types/source";

export interface SelectorHighlight {
  id: string;
  selector: string;
  selectorFallbacks?: string[];
  quote?: SelectionQuote;
}

export type PickerOperation =
  | "PICK"
  | "PICK_FILE"
  | "STOP"
  | "RUN"
  | "SHOW_SELECTORS"
  | "URL"
  | "SELECTION";

export type PickerRequest =
  | { id: string; op: "PICK" }
  | { id: string; op: "PICK_FILE" }
  | { id: string; op: "STOP" }
  | { id: string; op: "RUN"; rules: ExecutableExtractionRule[] }
  | { id: string; op: "SHOW_SELECTORS"; highlights: SelectorHighlight[] }
  | { id: string; op: "URL" }
  | { id: string; op: "SELECTION" };

export interface PickerSelectionRequest {
  type: "BURBOT_SELECTION";
}

export type PickerSelectionResponse =
  | { ok: true; value: ElementExtractionCandidate }
  | { ok: false; error: string };

export type PickerRpcValue =
  | boolean
  | string
  | ElementExtractionCandidate
  | ExtractionRuleRunResult[];

export type PickerRpcResponse =
  | { id: string; ok: true; value: PickerRpcValue }
  | { id: string; ok: false; error: string };

export type PickerEvent =
  | { event: "CAPTURE"; candidate: ElementExtractionCandidate }
  | { event: "FILE_CAPTURE"; file: RemoteFileSourceCandidate }
  | { event: "MODE"; picking: boolean }
  | { event: "ERROR"; error: string };

export type PickerPortMessage = PickerRpcResponse | PickerEvent;

const SUPPORTED_ATTRIBUTES = new Set<string>([
  "href",
  "src",
  "datetime",
  "title",
  "alt",
  "content",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSelectionQuote(value: unknown): value is SelectionQuote {
  return (
    isRecord(value) &&
    typeof value.exact === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isExtractionSpec(value: unknown): value is ExtractionSpec {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "text" || value.type === "pageUrl") return true;

  if (value.type === "attribute") {
    return (
      typeof value.attribute === "string" &&
      SUPPORTED_ATTRIBUTES.has(value.attribute)
    );
  }

  if (value.type === "selection") return isSelectionQuote(value.quote);
  return false;
}

function isRemoteFileSourceCandidate(
  value: unknown,
): value is RemoteFileSourceCandidate {
  return (
    isRecord(value) &&
    isSourceFileType(value.fileType) &&
    typeof value.url === "string" &&
    typeof value.sourcePageUrl === "string" &&
    typeof value.name === "string"
  );
}

function isSelectorHighlight(value: unknown): value is SelectorHighlight {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.selector === "string" &&
    value.selector.length > 0 &&
    (value.selectorFallbacks === undefined || isStringArray(value.selectorFallbacks)) &&
    (value.quote === undefined || isSelectionQuote(value.quote))
  );
}

export function isElementExtractionCandidate(
  value: unknown,
): value is ElementExtractionCandidate {
  if (
    !isRecord(value) ||
    typeof value.pageUrl !== "string" ||
    typeof value.selector !== "string" ||
    (value.selectorFallbacks !== undefined && !isStringArray(value.selectorFallbacks)) ||
    !Array.isArray(value.options)
  ) {
    return false;
  }

  return value.options.every((option) => {
    if (
      !isRecord(option) ||
      typeof option.label !== "string" ||
      typeof option.raw !== "string" ||
      !isExtractionSpec(option.extraction)
    ) {
      return false;
    }

    return option.extraction.type !== "pageUrl";
  });
}

export function isPickerSelectionRequest(
  value: unknown,
): value is PickerSelectionRequest {
  return isRecord(value) && value.type === "BURBOT_SELECTION";
}

export function isPickerSelectionResponse(
  value: unknown,
): value is PickerSelectionResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;

  if (value.ok) return isElementExtractionCandidate(value.value);
  return typeof value.error === "string";
}

export function isPickerRequest(value: unknown): value is PickerRequest {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.op !== "string"
  ) {
    return false;
  }

  if (value.op === "RUN") return Array.isArray(value.rules);
  if (value.op === "SHOW_SELECTORS") {
    return Array.isArray(value.highlights) && value.highlights.every(isSelectorHighlight);
  }
  return ["PICK", "PICK_FILE", "STOP", "URL", "SELECTION"].includes(value.op);
}

export function isPickerRpcResponse(value: unknown): value is PickerRpcResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }

  if (value.ok) return "value" in value;
  return typeof value.error === "string";
}

export function isPickerEvent(value: unknown): value is PickerEvent {
  if (!isRecord(value) || typeof value.event !== "string") return false;

  if (value.event === "CAPTURE") {
    return isElementExtractionCandidate(value.candidate);
  }
  if (value.event === "FILE_CAPTURE") {
    return isRemoteFileSourceCandidate(value.file);
  }
  if (value.event === "MODE") return typeof value.picking === "boolean";
  if (value.event === "ERROR") return typeof value.error === "string";
  return false;
}
