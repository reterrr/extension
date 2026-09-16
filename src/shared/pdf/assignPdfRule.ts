import type { CapturedExtractionInput } from "../types/extraction";
import type {
  LegacyStorageState,
  LegacyStoredObject,
  LegacyStoredRule,
} from "../types/legacy-storage";

type PdfCapturedExtractionInput = Extract<
  CapturedExtractionInput,
  { extraction: { type: "pdfText" } }
>;

export interface AssignPdfRuleMessage {
  op: "ASSIGN_PDF";
  expectedRevision: number;
  objectId: string;
  field: string;
  target?: { kind: string; id: string };
  value?: unknown;
  candidate: CapturedExtractionInput;
}

function assertPdfCandidate(
  state: LegacyStorageState,
  object: LegacyStoredObject,
  candidate: CapturedExtractionInput,
): asserts candidate is PdfCapturedExtractionInput {
  const extraction = candidate.extraction;
  if (extraction.type !== "pdfText") {
    throw new Error("Expected a PDF text extraction candidate.");
  }
  if (candidate.selector !== null) {
    throw new Error("PDF extraction cannot contain a DOM selector.");
  }
  if (!candidate.raw || candidate.raw.length > 100000) {
    throw new Error("Invalid PDF selection.");
  }
  if (
    !Number.isSafeInteger(extraction.selector.pageNumber) ||
    extraction.selector.pageNumber < 1
  ) {
    throw new Error("Invalid PDF page number.");
  }
  const quote = extraction.selector.quote;
  if (
    !quote ||
    !quote.exact ||
    [quote.exact, quote.prefix, quote.suffix].some(
      (part) => typeof part !== "string",
    )
  ) {
    throw new Error("Invalid PDF text selector.");
  }
  if (quote.exact !== candidate.raw) {
    throw new Error("PDF selection does not match its selector quote.");
  }

  const source = state.fileSources?.find(
    (entry) =>
      entry.id === extraction.sourceId && entry.objectId === object.id,
  );
  if (!source) throw new Error("PDF source no longer exists for this object.");
  if (source.fileType !== "PDF") throw new Error("Source is not a PDF.");
  if (source.url !== candidate.pageUrl) {
    throw new Error("PDF selector URL does not match the stored source.");
  }
}

export function assignPdfRuleIntoState(
  original: LegacyStorageState,
  message: AssignPdfRuleMessage,
  uuid: () => string,
  now: string,
): LegacyStorageState {
  if (message.expectedRevision !== original.revision) {
    throw new Error(
      "Data changed in another panel. Review the refreshed values and retry.",
    );
  }

  const state = JSON.parse(JSON.stringify(original)) as LegacyStorageState;
  const object = state.objects.find((entry) => entry.id === message.objectId);
  if (!object) throw new Error("Choose an object.");

  assertPdfCandidate(state, object, message.candidate);

  const { values, definition } = BurbotCore.fieldContext(
    state,
    object,
    message.field,
    message.target,
    uuid,
  );
  const input = message.value ?? message.candidate.raw;
  const value = BurbotCore.coerceField(input, definition, state);
  values[message.field] = value;

  state.rules = state.rules.filter(
    (rule) =>
      !BurbotCore.matches(
        rule,
        object.id,
        message.field,
        message.target,
      ),
  );

  const rule: LegacyStoredRule = {
    id: uuid(),
    objectId: object.id,
    field: message.field,
    pageUrl: message.candidate.pageUrl,
    selector: null,
    extraction: message.candidate.extraction,
    sampleValue: message.candidate.raw,
    createdAt: now,
  };
  if (message.target) rule.target = message.target;

  if (String(input) !== message.candidate.raw) {
    rule.transform = { sample: message.candidate.raw, value: input };
  }

  state.rules.push(rule);

  if (!message.target) {
    if (object.manualFields) delete object.manualFields[message.field];
    if (object.evidence) {
      delete object.evidence[message.field];
      if (Object.keys(object.evidence).length === 0) delete object.evidence;
    }

    if (message.field === BurbotSchema[object.type]?.primary) {
      object.label = String(value);
    }
  }

  object.updatedAt = now;
  state.revision += 1;
  return state;
}
