import type {
  LegacyStorageState,
  LegacyStoredObject,
  LegacyStoredRule,
} from "./legacy-storage";
import type { ElementExtractionSpec } from "./extraction";

interface BurbotFieldDefinition {
  label?: string;
  type: string;
  default?: unknown;
  references?: string;
  options?: Record<string, string>;
  aliases?: Record<string, string>;
  numeric?: boolean;
  legacy?: boolean;
  multiline?: boolean;
  min?: number;
  max?: number;
  [key: string]: unknown;
}

interface BurbotFieldContext {
  values: Record<string, any>;
  definition: BurbotFieldDefinition;
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
  formatValue(
    value: unknown,
    definition: BurbotFieldDefinition,
    state: LegacyStorageState,
  ): string;
  occurrences(text: string, part: string): number[];
  readElement(element: Element, extraction: ElementExtractionSpec): string;
  empty(): LegacyStorageState;
  hasValue(value: unknown): boolean;
  displayName(object: LegacyStoredObject): string;
  targetKey(target?: { kind: string; id: string }): string;
  matches(
    rule: LegacyStoredRule,
    objectId: string,
    field: string,
    target?: { kind: string; id: string },
  ): boolean;
  fieldContext(
    state: LegacyStorageState,
    object: LegacyStoredObject,
    field: string,
    target?: { kind: string; id: string },
    createDocument?: () => string,
  ): BurbotFieldContext;
  ruleValue(
    state: LegacyStorageState,
    object: LegacyStoredObject,
    rule: LegacyStoredRule,
    raw: string,
  ): unknown;
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
  types: Readonly<Record<string, string>>;
  roles: Readonly<Record<string, string>>;
  fields: Readonly<Record<string, BurbotFieldDefinition>>;
  catalog: ReadonlyArray<BurbotGeographyCatalogEntry>;
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
