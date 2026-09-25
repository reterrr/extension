import { isSourceFileType, type SourceFileType } from "../types/source";
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
const IMPORT_SOURCE_TYPES = new Set<ImportSourceType>(["HTML", "DOC", "DOCX", "PDF", "XLSX", "PNG", "JPG", "JPEG"]);
const FUNDING_SIZES = new Set(["MICRO", "SMALL", "MEDIUM", "LARGE", "B2C"]);
const GEOGRAPHY_TYPES = new Set([
  "POLSKA",
  "WOJEWODZTWO",
  "PODREGION",
  "POWIAT",
  "GMINA",
  "MIASTO_NA_PRAWACH_POWIATU",
]);
const GEOGRAPHY_ROLES = new Set(["OBEJMUJE", "WYKLUCZA"]);
const OPERATOR_CONTACT_KINDS = new Set(["EMAIL", "PHONE"]);

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

interface ImportFileMetadata {
  document_kind?: string;
  purpose?: string;
  has_fields?: boolean;
  intended_use?: string;
  client_requirement?: string;
  signature_requirement?: string;
  delivery_method?: string;
}

interface ImportFileAttachment {
  source: string;
  source_page?: string;
  /** Legacy-only. Canonical name is derived from the source URL filename. */
  name?: string;
  metadata?: ImportFileMetadata;
  evidence?: Record<string, ImportEvidence[]>;
}

interface ImportFinancingVariant {
  key: string;
  company_size: string;
  data: Record<string, unknown>;
  evidence?: Record<string, ImportEvidence[]>;
}

interface ImportGeography {
  key: string;
  type: string;
  role: string;
  value: string;
  evidence?: Record<string, ImportEvidence[]>;
}

interface ImportOperatorContact {
  key: string;
  kind: string;
  value: string;
  evidence?: Record<string, ImportEvidence[]>;
}

interface ImportDocumentRequirement {
  key: string;
  document_type_key: string;
  data: Record<string, unknown>;
  evidence?: Record<string, ImportEvidence[]>;
}

interface ImportObject {
  key: string;
  type: LegacyObjectType;
  data: Record<string, unknown>;
  evidence?: Record<string, ImportEvidence[]>;
  files?: ImportFileAttachment[];
  geography?: ImportGeography[];
  contacts?: ImportOperatorContact[];
  financing?: ImportFinancingVariant[];
  documents?: ImportDocumentRequirement[];
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

function parseFileMetadata(
  value: unknown,
  path: string,
): ImportFileMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);

  const result: ImportFileMetadata = {};
  const textFields = [
    "document_kind",
    "purpose",
    "intended_use",
    "client_requirement",
    "signature_requirement",
    "delivery_method",
  ] as const;

  for (const field of textFields) {
    if (value[field] === undefined) continue;
    result[field] = requiredString(value[field], `${path}.${field}`);
  }

  if (value.has_fields !== undefined) {
    if (typeof value.has_fields !== "boolean") {
      throw new Error(`${path}.has_fields must be true or false.`);
    }
    result.has_fields = value.has_fields;
  }

  return result;
}

const FILE_METADATA_EVIDENCE_FIELDS = Object.freeze({
  document_kind: true,
  purpose: true,
  has_fields: true,
  intended_use: true,
  client_requirement: true,
  signature_requirement: true,
  delivery_method: true,
});


function parseEvidenceMap(
  value: unknown,
  path: string,
): Record<string, ImportEvidence[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);

  const evidence: Record<string, ImportEvidence[]> = {};
  for (const [field, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      throw new Error(`${path}.${field} must be an array.`);
    }
    evidence[field] = entries.map((entry, evidenceIndex) => {
      const evidencePath = `${path}.${field}[${evidenceIndex}]`;
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
        raw_value:
          typeof entry.raw_value === "string"
            ? entry.raw_value
            : (() => {
                throw new Error(`${evidencePath}.raw_value must be a string.`);
              })(),
        ...(Object.prototype.hasOwnProperty.call(entry, "normalized_value")
          ? { normalized_value: entry.normalized_value }
          : {}),
      };
    });
  }
  return evidence;
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
      throw new Error(`${path}.type must be HTML, DOC, DOCX, PDF, XLSX, PNG, JPG or JPEG.`);
    }
    const url = optionalString(raw.url, `${path}.url`);
    if (url !== undefined) BurbotCore.coerce(url, "url");
    if (!isRecord(raw.snapshot)) throw new Error(`${path}.snapshot must be an object.`);
    const snapshot: ImportSnapshot = {
      text:
        typeof raw.snapshot.text === "string"
          ? raw.snapshot.text
          : (() => {
              throw new Error(`${path}.snapshot.text must be a string.`);
            })(),
      captured_at: optionalString(raw.snapshot.captured_at, `${path}.snapshot.captured_at`),
      content_hash: optionalString(raw.snapshot.content_hash, `${path}.snapshot.content_hash`),
      parser_version: optionalString(raw.snapshot.parser_version, `${path}.snapshot.parser_version`),
    };
    if (
      snapshot.captured_at !== undefined &&
      Number.isNaN(Date.parse(snapshot.captured_at))
    ) {
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

    const evidence = parseEvidenceMap(raw.evidence, `${path}.evidence`);

    let files: ImportFileAttachment[] | undefined;
    if (raw.files !== undefined) {
      if (!Array.isArray(raw.files)) throw new Error(`${path}.files must be an array.`);
      files = raw.files.map((entry, fileIndex) => {
        const filePath = `${path}.files[${fileIndex}]`;
        if (!isRecord(entry)) throw new Error(`${filePath} must be an object.`);
        return {
          source: requiredString(entry.source, `${filePath}.source`),
          source_page: optionalString(entry.source_page, `${filePath}.source_page`),
          name: optionalString(entry.name, `${filePath}.name`),
          metadata: parseFileMetadata(entry.metadata, `${filePath}.metadata`),
          evidence: parseEvidenceMap(entry.evidence, `${filePath}.evidence`),
        };
      });
    }


    let geography: ImportGeography[] | undefined;
    if (raw.geography !== undefined) {
      if (!Array.isArray(raw.geography)) {
        throw new Error(`${path}.geography must be an array.`);
      }
      geography = raw.geography.map((entry, geographyIndex) => {
        const geographyPath = `${path}.geography[${geographyIndex}]`;
        if (!isRecord(entry)) throw new Error(`${geographyPath} must be an object.`);
        const type = requiredString(entry.type, `${geographyPath}.type`);
        const role = requiredString(entry.role, `${geographyPath}.role`);
        if (!GEOGRAPHY_TYPES.has(type)) {
          throw new Error(`${geographyPath}.type is not a supported geography type.`);
        }
        if (!GEOGRAPHY_ROLES.has(role)) {
          throw new Error(`${geographyPath}.role must be OBEJMUJE or WYKLUCZA.`);
        }
        return {
          key: requiredString(entry.key, `${geographyPath}.key`),
          type,
          role,
          value: requiredString(entry.value, `${geographyPath}.value`),
          evidence: parseEvidenceMap(
            entry.evidence,
            `${geographyPath}.evidence`,
          ),
        };
      });
      uniqueByKey(geography, `${path} geography`);
    }

    let contacts: ImportOperatorContact[] | undefined;
    if (raw.contacts !== undefined) {
      if (!Array.isArray(raw.contacts)) {
        throw new Error(`${path}.contacts must be an array.`);
      }
      contacts = raw.contacts.map((entry, contactIndex) => {
        const contactPath = `${path}.contacts[${contactIndex}]`;
        if (!isRecord(entry)) throw new Error(`${contactPath} must be an object.`);
        const kind = requiredString(entry.kind, `${contactPath}.kind`);
        if (!OPERATOR_CONTACT_KINDS.has(kind)) {
          throw new Error(`${contactPath}.kind must be EMAIL or PHONE.`);
        }
        return {
          key: requiredString(entry.key, `${contactPath}.key`),
          kind,
          value: requiredString(entry.value, `${contactPath}.value`),
          evidence: parseEvidenceMap(
            entry.evidence,
            `${contactPath}.evidence`,
          ),
        };
      });
      uniqueByKey(contacts, `${path} contacts`);
    }

    let documents: ImportDocumentRequirement[] | undefined;
    if (raw.documents !== undefined) {
      if (!Array.isArray(raw.documents)) {
        throw new Error(`${path}.documents must be an array.`);
      }
      documents = raw.documents.map((entry, documentIndex) => {
        const documentPath = `${path}.documents[${documentIndex}]`;
        if (!isRecord(entry)) throw new Error(`${documentPath} must be an object.`);
        if (!isRecord(entry.data)) {
          throw new Error(`${documentPath}.data must be an object.`);
        }
        return {
          key: requiredString(entry.key, `${documentPath}.key`),
          document_type_key: requiredString(
            entry.document_type_key,
            `${documentPath}.document_type_key`,
          ),
          data: entry.data,
          evidence: parseEvidenceMap(
            entry.evidence,
            `${documentPath}.evidence`,
          ),
        };
      });
      uniqueByKey(documents, `${path} documents`);
      const documentTypes = new Set<string>();
      for (const document of documents) {
        if (documentTypes.has(document.document_type_key)) {
          throw new Error(
            `Duplicate ${path} document_type_key: ${document.document_type_key}`,
          );
        }
        documentTypes.add(document.document_type_key);
      }
    }

    let financing: ImportFinancingVariant[] | undefined;
    if (raw.financing !== undefined) {
      if (!Array.isArray(raw.financing)) {
        throw new Error(`${path}.financing must be an array.`);
      }
      financing = raw.financing.map((entry, financeIndex) => {
        const financePath = `${path}.financing[${financeIndex}]`;
        if (!isRecord(entry)) throw new Error(`${financePath} must be an object.`);
        const companySize = requiredString(
          entry.company_size,
          `${financePath}.company_size`,
        );
        if (!FUNDING_SIZES.has(companySize)) {
          throw new Error(`${financePath}.company_size must be MICRO, SMALL, MEDIUM, LARGE or B2C.`);
        }
        if (!isRecord(entry.data)) throw new Error(`${financePath}.data must be an object.`);
        return {
          key: requiredString(entry.key, `${financePath}.key`),
          company_size: companySize,
          data: entry.data,
          evidence: parseEvidenceMap(
            entry.evidence,
            `${financePath}.evidence`,
          ),
        };
      });
      uniqueByKey(financing, `${path} financing`);
    }

    return {
      key,
      type,
      data: raw.data,
      evidence,
      files,
      geography,
      contacts,
      financing,
      documents,
    };
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

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
    return name || "document";
  } catch {
    return "document.pdf";
  }
}

function storeEvidence(
  itemKey: string,
  field: string,
  entries: ImportEvidence[],
  sourceByKey: Map<string, ImportedSource>,
): ImportedEvidence[] {
  const storedEntries: ImportedEvidence[] = [];
  for (const entry of entries) {
    const source = sourceByKey.get(entry.source);
    if (!source) throw new Error(`Unknown evidence source: ${entry.source}.`);
    const textLength = Array.from(source.snapshot.text).length;
    if (entry.char_end > textLength) {
      throw new Error(`Evidence range for ${itemKey}.${field} is outside source ${entry.source}.`);
    }
    const actual = codepointSlice(source.snapshot.text, entry.char_start, entry.char_end);
    if (actual !== entry.raw_value) {
      throw new Error(
        `Evidence mismatch for ${itemKey}.${field}: source text at [${entry.char_start}, ${entry.char_end}) does not equal raw_value.`,
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
  }
  return storedEntries;
}


function storeTargetEvidence(
  state: LegacyStorageState,
  objectId: string,
  target: { kind: string; id: string },
  targetImportKey: string,
  itemKey: string,
  field: string,
  entries: ImportEvidence[],
  sourceByKey: Map<string, ImportedSource>,
  uuid: () => string,
): void {
  const stored = storeEvidence(itemKey, field, entries, sourceByKey);
  for (const evidence of stored) {
    (state.importTargetEvidence ||= []).push({
      id: uuid(),
      objectId,
      field,
      target,
      targetImportKey,
      ...evidence,
    });
  }
}

function validateTargetEvidenceFields(
  evidence: Record<string, ImportEvidence[]> | undefined,
  allowedFields: Record<string, unknown>,
  presentValues: Record<string, unknown>,
  path: string,
): void {
  if (!evidence) return;
  for (const field of Object.keys(evidence)) {
    if (!Object.prototype.hasOwnProperty.call(allowedFields, field)) {
      throw new Error(`Unknown evidence field ${path}.${field}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(presentValues, field)) {
      throw new Error(
        `Evidence for ${path}.${field} requires a value in the same imported row.`,
      );
    }
  }
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
    if (!schema?.primary || !schema.fields) {
      throw new Error(`No schema for object type ${item.type}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(item.data, schema.primary)) {
      throw new Error(`objects.${item.key}.data.${schema.primary} is required.`);
    }
    for (const field of Object.keys(item.data)) {
      if (!Object.prototype.hasOwnProperty.call(schema.fields, field)) {
        throw new Error(`Unknown field ${item.type}.${field}.`);
      }
      if (schema.fields[field]?.system) {
        throw new Error(
          `${item.type}.${field} is managed automatically and must not be imported.`,
        );
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

    if (item.evidence) {
      for (const [field, entries] of Object.entries(item.evidence)) {
        if (!schema.fields?.[field]) {
          throw new Error(`Unknown evidence field ${item.type}.${field}.`);
        }
        if (!Object.prototype.hasOwnProperty.call(item.data, field)) {
          throw new Error(`Evidence for ${item.key}.${field} requires a value in data.`);
        }
        const storedEntries = storeEvidence(item.key, field, entries, sourceByKey);
        if (storedEntries.length) {
          (object.evidence ||= {})[field] = storedEntries;
          const source = sourceByKey.get(entries[0]?.source ?? "");
          if (!object.sourceUrl && source?.url) object.sourceUrl = source.url;
        }
      }
    }

    if (item.files?.length) {
      for (const [fileIndex, file] of item.files.entries()) {
        const source = sourceByKey.get(file.source);
        if (!source) throw new Error(`Unknown file source: ${file.source}.`);
        if (!isSourceFileType(source.type) || !source.url) {
          throw new Error(
            `objects.${item.key}.files[${fileIndex}].source must reference a supported file source with an HTTP(S) URL.`,
          );
        }
        const pageSource = file.source_page
          ? sourceByKey.get(file.source_page)
          : undefined;
        if (file.source_page && !pageSource) {
          throw new Error(`Unknown file source page: ${file.source_page}.`);
        }
        if (file.source_page && !pageSource?.url) {
          throw new Error(
            `objects.${item.key}.files[${fileIndex}].source_page must reference a source with a URL.`,
          );
        }
        const row = {
          id: uuid(),
          objectId: object.id,
          fileType: source.type as SourceFileType,
          url: source.url,
          // Canonical file name always comes from the actual remote filename.
          name: fileNameFromUrl(source.url),
          sourcePageUrl: pageSource?.url ?? object.sourceUrl ?? source.url,
          addedAt: now,
          sourceImportKey: source.importKey,
          ...(pageSource ? { sourcePageImportKey: pageSource.importKey } : {}),
          ...(file.metadata ?? {}),
        };
        (state.fileSources ||= []).push(row);

        validateTargetEvidenceFields(
          file.evidence,
          FILE_METADATA_EVIDENCE_FIELDS,
          file.metadata ?? {},
          `${item.key}.files[${fileIndex}]`,
        );
        for (const [field, entries] of Object.entries(file.evidence ?? {})) {
          storeTargetEvidence(
            state,
            object.id,
            { kind: "file_source", id: row.id },
            source.importKey,
            item.key,
            field,
            entries,
            sourceByKey,
            uuid,
          );
        }
      }
    }


    if (item.geography?.length) {
      if (!schema.geography) {
        throw new Error(`Object type ${item.type} does not support geography.`);
      }
      for (const [geographyIndex, geography] of item.geography.entries()) {
        const entry = globalThis.BurbotGeography?.catalog?.find(
          (candidate: { type: string; value: string }) =>
            candidate.type === geography.type && candidate.value === geography.value,
        );
        if (!entry) {
          throw new Error(
            `Unknown geography value ${geography.value} for type ${geography.type} in ${item.key}.geography[${geographyIndex}].`,
          );
        }
        const row = {
          id: uuid(),
          objectId: object.id,
          importKey: geography.key,
          type: geography.type,
          role: geography.role,
          value: geography.value,
        };
        (state.geographies ||= []).push(row);

        validateTargetEvidenceFields(
          geography.evidence,
          globalThis.BurbotGeography.fields,
          { value: geography.value },
          `${item.key}.geography.${geography.key}`,
        );
        for (const [field, entries] of Object.entries(geography.evidence ?? {})) {
          storeTargetEvidence(
            state,
            object.id,
            { kind: "geography", id: row.id },
            geography.key,
            item.key,
            field,
            entries,
            sourceByKey,
            uuid,
          );
        }
      }
    }

    if (item.contacts?.length) {
      if (item.type !== "operator" || !schema.contacts) {
        throw new Error(`Object type ${item.type} does not support operator contacts.`);
      }
      const variantsByKind = new Map<string, number>();
      for (const contact of item.contacts) {
        const variant = (variantsByKind.get(contact.kind) ?? 0) + 1;
        variantsByKind.set(contact.kind, variant);
        const definition = globalThis.BurbotOperatorContacts?.fields?.[contact.kind]?.value;
        if (!definition) {
          throw new Error(`Unknown operator contact kind ${contact.kind}.`);
        }
        const row = {
          id: uuid(),
          objectId: object.id,
          importKey: contact.key,
          kind: contact.kind,
          variant_no: variant,
          value: BurbotCore.coerceField(contact.value, definition, state),
        };
        (state.operatorContacts ||= []).push(row);

        validateTargetEvidenceFields(
          contact.evidence,
          globalThis.BurbotOperatorContacts.fields[contact.kind],
          { value: contact.value },
          `${item.key}.contacts.${contact.key}`,
        );
        for (const [field, entries] of Object.entries(contact.evidence ?? {})) {
          storeTargetEvidence(
            state,
            object.id,
            { kind: "operator_contact", id: row.id },
            contact.key,
            item.key,
            field,
            entries,
            sourceByKey,
            uuid,
          );
        }
      }
    }

    if (item.documents?.length) {
      if (!schema.configuration) {
        throw new Error(`Object type ${item.type} does not support document requirements.`);
      }
      for (const document of item.documents) {
        if (
          !globalThis.BurbotDocuments?.catalog?.some(
            (entry: { key: string }) => entry.key === document.document_type_key,
          )
        ) {
          throw new Error(
            `Unknown document type ${document.document_type_key} in ${item.key}.`,
          );
        }
        const row: Record<string, unknown> = {
          id: uuid(),
          objectId: object.id,
          importKey: document.key,
          document_type_key: document.document_type_key,
        };
        for (const [field, rawValue] of Object.entries(document.data)) {
          const definition = globalThis.BurbotDocuments?.fields?.[field];
          if (!definition) {
            throw new Error(
              `Unknown document field ${field} in ${item.key}.${document.key}.`,
            );
          }
          row[field] = BurbotCore.coerceField(rawValue, definition, state);
        }
        (state.documentRequirements ||= []).push(row);

        validateTargetEvidenceFields(
          document.evidence,
          globalThis.BurbotDocuments.fields,
          document.data,
          `${item.key}.documents.${document.key}`,
        );
        for (const [field, entries] of Object.entries(document.evidence ?? {})) {
          storeTargetEvidence(
            state,
            object.id,
            { kind: "document", id: String(document.document_type_key) },
            document.key,
            item.key,
            field,
            entries,
            sourceByKey,
            uuid,
          );
        }
      }
    }

    if (item.financing?.length) {
      if (!schema.configuration) {
        throw new Error(`Object type ${item.type} does not support financing configuration.`);
      }
      const variantsPerSize = new Map<string, number>();
      for (const variant of item.financing) {
        const row: Record<string, unknown> = {
          id: uuid(),
          objectId: object.id,
          importKey: variant.key,
          company_size: variant.company_size,
          variant_no: (variantsPerSize.get(variant.company_size) ?? 0) + 1,
          own_contribution_form: "UNSPECIFIED",
        };
        variantsPerSize.set(variant.company_size, Number(row.variant_no));

        for (const [field, rawValue] of Object.entries(variant.data)) {
          const definition = BurbotFunding.fields[field];
          if (!definition) {
            throw new Error(
              `Unknown financing field ${field} in ${item.key}.${variant.key}.`,
            );
          }
          row[field] = BurbotCore.coerceField(rawValue, definition, state);
        }
        (state.financingRules ||= []).push(row);

        validateTargetEvidenceFields(
          variant.evidence,
          BurbotFunding.fields,
          variant.data,
          `${item.key}.financing.${variant.key}`,
        );
        for (const [field, entries] of Object.entries(variant.evidence ?? {})) {
          storeTargetEvidence(
            state,
            object.id,
            { kind: "funding", id: String(row.id) },
            variant.key,
            item.key,
            field,
            entries,
            sourceByKey,
            uuid,
          );
        }
      }
    }
  }

  state.revision++;
  return state;
}
