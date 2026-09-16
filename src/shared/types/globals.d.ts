import type { LegacyStorageState } from "./legacy-storage";
import type { ElementExtractionSpec } from "./extraction";

interface BurbotFieldDefinition {
  type: string;
  default?: unknown;
  references?: string;
  options?: Record<string, string>;
  aliases?: Record<string, string>;
  numeric?: boolean;
  [key: string]: unknown;
}

interface BurbotCoreApi {
  clean(value: unknown): string;
  coerce(value: unknown, type: "url" | "string" | "date"): string;
  coerce(value: unknown, type: "number"): number;
  coerce(value: unknown, type: string): string | number;
  coerceField(
    value: unknown,
    definition: BurbotFieldDefinition,
    state: LegacyStorageState,
  ): unknown;
  occurrences(text: string, part: string): number[];
  readElement(element: Element, extraction: ElementExtractionSpec): string;
  empty(): LegacyStorageState;
  mutate(
    state: LegacyStorageState,
    message: unknown,
    uuid: () => string,
    now: string,
  ): LegacyStorageState;
}

interface BurbotSchemaEntry {
  label: string;
  primary?: string;
  fields?: Record<string, BurbotFieldDefinition>;
  geography?: boolean;
  [key: string]: unknown;
}

interface BurbotGeographyCatalogEntry {
  type: string;
  value: string;
  label: string;
  context?: string;
  search: string;
}

interface BurbotGeographyApi {
  types: Record<string, string>;
  roles: Record<string, string>;
  fields: Record<string, BurbotFieldDefinition>;
  catalog: BurbotGeographyCatalogEntry[];
}

declare global {
  var BurbotCore: BurbotCoreApi;
  var BurbotSchema: Record<string, BurbotSchemaEntry>;
  var BurbotGeography: BurbotGeographyApi;
  var BurbotFunding: Record<string, unknown>;
  var BurbotDocuments: Record<string, unknown>;
  var __burbotPickerLoaded: boolean | undefined;
}

export {};
