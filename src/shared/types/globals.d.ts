import type { BurbotState } from "./domain";
import type { ElementExtractionSpec } from "./extraction";

interface BurbotFieldDefinition {
  type: string;
  default?: unknown;
  references?: string;
  [key: string]: unknown;
}

interface BurbotCoreApi {
  clean(value: unknown): string;
  coerce(value: unknown, type: string): string | number;
  coerceField(
    value: unknown,
    definition: BurbotFieldDefinition,
    state: BurbotState,
  ): unknown;
  occurrences(text: string, part: string): number[];
  readElement(element: Element, extraction: ElementExtractionSpec): string;
  empty(): BurbotState;
  mutate(
    state: BurbotState,
    message: unknown,
    uuid: () => string,
    now: string,
  ): BurbotState;
}

interface BurbotSchemaEntry {
  label: string;
  primary?: string;
  fields?: Record<string, BurbotFieldDefinition>;
  [key: string]: unknown;
}

declare global {
  var BurbotCore: BurbotCoreApi;
  var BurbotSchema: Record<string, BurbotSchemaEntry>;
  var BurbotFunding: Record<string, unknown>;
  var BurbotDocuments: Record<string, unknown>;
  var __burbotPickerLoaded: boolean | undefined;
}

export {};
