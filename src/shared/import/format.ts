import type {
  ImportSourceType,
  ImportedEvidence,
  ImportedSource,
  LegacyObjectType,
  LegacyStorageState,
  LegacyStoredObject,
} from "../types/legacy-storage";

const IMPORTABLE_OBJECT_TYPES = new Set<LegacyObjectType>([
  "project",
  "recruitment",
  "operator",
]);
const IMPORT_SOURCE_TYPES = new Set<ImportSourceType>(["HTML", "PDF", "XLSX"]);

interface ImportReference {
  $ref: string;
}

interface ImportSnapshot {
  text: string;
  captured_at?: string;
  content_hash?: string;
  parser_version?: string;
}

interface ImportSource {
  key: string;
  type: ImportSourceType;
  url?: string;
  snapshot: ImportSnapshot;
}

interface ImportEvidence {
  source: string;
  char_start: number;
  char_end: number;
  raw_value: string;
  normalized_value?: unknown;
}

interface ImportObject {
  key: string;
  type: LegacyObjectType;
  data: Record<string, unknown>;
  evidence?: Record<string, ImportEvidence[]>;
}

interface BurbotImportV1 {
  version: 1;
  offset_unit: "unicode_codepoint";
  sources: ImportSource[];
  objects: ImportObject[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function uniqueByKey<T extends { key: string }>(items: T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) throw new Error(`Duplicate ${label} key: ${item.key}`);
    seen.add(item.key);
  }
}

function parseDocument(input: unknown): BurbotImportV1 {
  if (!isRecord(input)) throw new Error("Import must be a JSON object.");
  if (input.version !== 1) throw new Error("Only Burbot import version 1 is supported.");
  if (input.offset_unit !== "unicode_codepoint") {
    throw new Error('offset_unit must be "unicode_codepoint".');
  }
  if (!Array.isArray(input.sources)) throw new Error("sources must be an array.");
  if (!Array.isArray(input.objects)) throw new Error("objects must be an array.");
  if (input.objects.length === 0) throw new Error("Import must contain at least one object.");

  const sources: ImportSource[] = input.sources.map((raw, index) => {
    const path = `sources[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
    const key = requiredString(raw.key, `${path}.key`);
    const type = raw.type as ImportSourceType;
    if (!IMPORT_SOURCE_TYPES.has(type)) {
      throw new Error(`${path}.type must be HTML, PDF or XLSX.`);
    }
    const url = optionalString(raw.url, `${path}.url`);
    if (url !== undefined) BurbotCore.coerce(url, "url");
    if (!isRecord(raw.snapshot)) throw new Error(`${path}.snapshot must be an object.`);
    const snapshot: ImportSnapshot = {
      text: typeof raw.snapshot.text === "string" ? raw.snapshot.text : (() => {
        throw new Error(`${path}.snapshot.text must be a string.`);
      })(),
      captured_at: optionalString(raw.snapshot.captured_at, `${path}.snapshot.captured_at`),
      content_hash: optionalString(raw.snapshot.content_hash, `${path}.snapshot.content_hash`),
      parser_version: optionalString(raw.snapshot.parser_version, `${path}.snapshot.parser_version`),
    };
    if (snapshot.captured_at !== undefined && Number.isNaN(Date.parse(snapshot.captured_at))) {
      throw new Error(`${path}.snapshot.captured_at must be an ISO date-time.`);
    }
    return { key, type, url, snapshot };
  });

  const objects: ImportObject[] = input.objects.map((raw, index) => {
    const path = `objects[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
    const key = requiredString(raw.key, `${path}.key`);
    const type = raw.type as LegacyObjectType;
    if (!IMPORTABLE_OBJECT_TYPES.has(type)) {
      throw new Error(`${path}.type must be project, recruitment or operator.`);
    }
    if (!isRecord(raw.data)) throw new Error(`${path}.data must be an object.`);
    let evidence: Record<string, ImportEvidence[]> | undefined;
    if (raw.evidence !== undefined) {
      if (!isRecord(raw.evidence)) throw new Error(`${path}.evidence must be an object.`);
      evidence = {};
      for (const [field, entries] of Object.entries(raw.evidence)) {
        if (!Array.isArray(entries)) {
          throw new Error(`${path}.evidence.${field} must be an array.`);
        }
        evidence[field] = entries.map((entry, evidenceIndex) => {
          const evidencePath = `${path}.evidence.${field}[${evidenceIndex}]`;
          if (!isRecord(entry)) throw new Error(`${evidencePath} must be an object.`);
          const charStart = entry.char_start;
          const charEnd = entry.char_end;
          if (!Number.isInteger(charStart) || Number(charStart) < 0) {
            throw new Error(`${evidencePath}.char_start must be a non-negative integer.`);
          }
          if (!Number.isInteger(charEnd) || Number(charEnd) <= Number(charStart)) {
            throw new Error(`${evidencePath}.char_end must be greater than char_start.`);
          }
          return {
            source: requiredString(entry.source, `${evidencePath}.source`),
            char_start: Number(charStart),
            char_end: Number(charEnd),
            raw_value: typeof entry.raw_value === "string" ? entry.raw_value : (() => {
              throw new Error(`${evidencePath}.raw_value must be a string.`);
            })(),
            ...(Object.prototype.hasOwnProperty.call(entry, "normalized_value")
              ? { normalized_value: entry.normalized_value }
              : {}),
          };
        });
      }
    }
    return { key, type, data: raw.data, evidence };
  });

  uniqueByKey(sources, "source");
  uniqueByKey(objects, "object");
  return { version: 1, offset_unit: "unicode_codepoint", sources, objects };
}

function isReference(value: unknown): value is ImportReference {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.$ref === "string";
}

function codepointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

export function importDocumentIntoState(
  original: LegacyStorageState,
  input: unknown,
  expectedRevision: unknown,
  uuid: () => string,
  now: string,
): LegacyStorageState {
  if (expectedRevision !== original.revision) {
    throw new Error("Data changed in another panel. Review the refreshed values and retry.");
  }

  const document = parseDocument(input);
  const state = JSON.parse(JSON.stringify(original)) as LegacyStorageState;
  const sourceByKey = new Map<string, ImportedSource>();

  for (const source of document.sources) {
    const stored: ImportedSource = {
      id: uuid(),
      importKey: source.key,
      type: source.type,
      ...(source.url ? { url: BurbotCore.coerce(source.url, "url") } : {}),
      snapshot: {
        text: source.snapshot.text,
        ...(source.snapshot.captured_at ? { capturedAt: source.snapshot.captured_at } : {}),
        ...(source.snapshot.content_hash ? { contentHash: source.snapshot.content_hash } : {}),
        ...(source.snapshot.parser_version ? { parserVersion: source.snapshot.parser_version } : {}),
      },
      importedAt: now,
    };
    sourceByKey.set(source.key, stored);
    (state.importSources ||= []).push(stored);
  }

  const objectIdByKey = new Map<string, string>();
  const importedByKey = new Map<string, LegacyStoredObject>();

  for (const item of document.objects) {
    const schema = BurbotSchema[item.type];
    if (!schema?.primary || !schema.fields) throw new Error(`No schema for object type ${item.type}.`);
    if (!Object.prototype.hasOwnProperty.call(item.data, schema.primary)) {
      throw new Error(`objects.${item.key}.data.${schema.primary} is required.`);
    }
    for (const field of Object.keys(item.data)) {
      if (!Object.prototype.hasOwnProperty.call(schema.fields, field)) {
        throw new Error(`Unknown field ${item.type}.${field}.`);
      }
    }

    const id = uuid();
    objectIdByKey.set(item.key, id);
    const object: LegacyStoredObject = {
      id,
      type: item.type,
      importKey: item.key,
      values: {},
      createdAt: now,
      updatedAt: now,
    };
    for (const [field, definition] of Object.entries(schema.fields)) {
      if (Object.prototype.hasOwnProperty.call(definition, "default")) {
        object.values[field] = definition.default;
      }
    }
    state.objects.push(object);
    importedByKey.set(item.key, object);
  }

  for (const item of document.objects) {
    const object = importedByKey.get(item.key)!;
    const schema = BurbotSchema[item.type];

    for (const [field, rawValue] of Object.entries(item.data)) {
      const definition = schema.fields![field];
      let value = rawValue;
      if (definition.type === "reference") {
        if (!isReference(rawValue)) {
          throw new Error(`${item.key}.${field} must use {"$ref":"object-key"}.`);
        }
        const targetId = objectIdByKey.get(rawValue.$ref);
        const target = document.objects.find((candidate) => candidate.key === rawValue.$ref);
        if (!targetId || !target) throw new Error(`Unknown object reference: ${rawValue.$ref}.`);
        if (target.type !== definition.references) {
          throw new Error(`${item.key}.${field} must reference a ${definition.references}.`);
        }
        value = targetId;
      } else if (isReference(rawValue)) {
        throw new Error(`${item.key}.${field} is not a reference field.`);
      }
      object.values[field] = BurbotCore.coerceField(value, definition, state);
    }

    object.label = String(object.values[schema.primary!]);

    if (!item.evidence) continue;
    for (const [field, entries] of Object.entries(item.evidence)) {
      if (!schema.fields?.[field]) throw new Error(`Unknown evidence field ${item.type}.${field}.`);
      if (!Object.prototype.hasOwnProperty.call(item.data, field)) {
        throw new Error(`Evidence for ${item.key}.${field} requires a value in data.`);
      }
      const storedEntries: ImportedEvidence[] = [];
      for (const entry of entries) {
        const source = sourceByKey.get(entry.source);
        if (!source) throw new Error(`Unknown evidence source: ${entry.source}.`);
        const textLength = Array.from(source.snapshot.text).length;
        if (entry.char_end > textLength) {
          throw new Error(`Evidence range for ${item.key}.${field} is outside source ${entry.source}.`);
        }
        const actual = codepointSlice(source.snapshot.text, entry.char_start, entry.char_end);
        if (actual !== entry.raw_value) {
          throw new Error(
            `Evidence mismatch for ${item.key}.${field}: source text at [${entry.char_start}, ${entry.char_end}) does not equal raw_value.`,
          );
        }
        storedEntries.push({
          sourceId: source.id,
          charStart: entry.char_start,
          charEnd: entry.char_end,
          rawValue: entry.raw_value,
          ...(Object.prototype.hasOwnProperty.call(entry, "normalized_value")
            ? { normalizedValue: entry.normalized_value }
            : {}),
        });
        if (!object.sourceUrl && source.url) object.sourceUrl = source.url;
      }
      if (storedEntries.length) (object.evidence ||= {})[field] = storedEntries;
    }
  }

  state.revision++;
  return state;
}
