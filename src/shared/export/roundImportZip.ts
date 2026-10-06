import {
  safeDownloadPathSegment,
  uniqueDownloadFileNames,
} from "../fileDownloads";
import { projectForRecruitment } from "../fileInheritance";
import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "../types/legacy-storage";

const MIB = 1024 * 1024;
export const ROUND_IMPORT_MANIFEST_MAX_BYTES = 1 * MIB;
export const ROUND_IMPORT_FILE_MAX_BYTES = 10 * MIB;
export const ROUND_IMPORT_TOTAL_FILE_MAX_BYTES = 99 * MIB;
export const ROUND_IMPORT_MAX_FILES = 30;

const TARGET_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
]);

const FILE_TYPE_EXTENSION: Record<string, string> = {
  PDF: "pdf",
  DOC: "doc",
  DOCX: "docx",
  XLSX: "xlsx",
  JPG: "jpg",
  JPEG: "jpeg",
  PNG: "png",
};

const VOIVODESHIP_TERYT: Record<string, string> = {
  "dolnośląskie": "02",
  "kujawsko-pomorskie": "04",
  lubelskie: "06",
  lubuskie: "08",
  "łódzkie": "10",
  "małopolskie": "12",
  mazowieckie: "14",
  opolskie: "16",
  podkarpackie: "18",
  podlaskie: "20",
  pomorskie: "22",
  "śląskie": "24",
  "świętokrzyskie": "26",
  "warmińsko-mazurskie": "28",
  wielkopolskie: "30",
  zachodniopomorskie: "32",
};

type RoundFilePurpose = "regulations" | "instructions" | "form" | "other";
type RoundRequirement =
  | "unknown"
  | "required"
  | "conditional"
  | "informational";
type RoundSignatureRequirement =
  | "unknown"
  | "not_required"
  | "required_file"
  | "external_operator";
type RoundBusinessCategory = "mikro" | "male" | "srednie" | "duze" | "ngo";
type RoundMspSize = "mikro" | "male" | "srednie" | "duze" | "nie_msp";
type RoundOperatorStatus = "unknown" | "upcoming" | "active" | "closed";
type RoundAidBasis =
  | "unknown"
  | "de_minimis"
  | "gber_training"
  | "mixed"
  | "other";

export interface RoundImportFileDeclaration {
  id: string;
  path: string;
  purpose: RoundFilePurpose;
  requiresCompletion: boolean;
}

export interface RoundImportFundingVariant {
  label: string;
  serviceCategoryId?: string | null;
  mspSize: RoundMspSize | null;
  refundPct: number | null;
  maxAmountPln: number | null;
  maxPerPersonPln: number | null;
  ownContributionForm: "monetary" | "salary" | null;
}

export interface RoundImportDocument {
  key: string;
  label: string;
  purpose: string;
  requirement: RoundRequirement;
  condition?: string;
  fulfillmentMode: "operator_template" | "without_operator_template";
  deliveryStage?: string;
  responsibility?: "fundpilot" | "client" | "shared" | null;
  requiredEvidence?: string;
  originalFileId?: string | null;
  sourceFileIds?: string[];
  sourceUrl?: string | null;
  sourceDescription?: string;
  versionLabel?: string;
  signatureRequirement?: RoundSignatureRequirement;
}

export interface RoundImportConditions {
  officialRoundIdentifier?: string | null;
  officialIdentifierStatus?:
    | "unknown"
    | "provided"
    | "not_issued"
    | "not_in_announcement";
  officialIdentifierEvidenceUrl?: string | null;
  evidenceFileId?: string | null;
  projectName: string | null;
  programCode: string | null;
  operatorStatus: RoundOperatorStatus;
  includedTerytCodes: string[];
  excludedTerytCodes: string[];
  eligibleEntities: string;
  eligibleBusinessCategories: RoundBusinessCategory[];
  aidBasis: RoundAidBasis;
  aidBasisDescription: string;
  fundingVariants: RoundImportFundingVariant[];
  submissionInstructions: string;
  sourceFileIds: string[];
}

export interface RoundImportManifestV1 {
  format: "RoundImportManifestV1";
  name: string;
  files: RoundImportFileDeclaration[];
  workspace: {
    notes: string;
    schedule?: {
      opensOn: string | null;
      closesOn: string | null;
      closeMode: "unknown" | "dated" | "until_allocation" | "no_deadline";
    };
    conditions: RoundImportConditions;
    documents: RoundImportDocument[];
  };
}

export interface RoundImportPackageFile {
  source: LegacyStoredFileSource;
  id: string;
  path: string;
}

export interface RoundImportPackagePlan {
  manifest: RoundImportManifestV1;
  files: RoundImportPackageFile[];
  zipFileName: string;
  warnings: string[];
}

export interface RoundImportZipResult {
  blob: Blob;
  manifest: RoundImportManifestV1;
  zipFileName: string;
  warnings: string[];
}

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value: unknown, max: number, field: string): string {
  const text = cleanText(value);
  if (text.length > max) {
    throw new Error(
      `${field} ma ${text.length} znaków; RoundImportManifestV1 dopuszcza maksymalnie ${max}.`,
    );
  }
  return text;
}

function maybeBoundedText(
  value: unknown,
  max: number,
  field: string,
): string | null {
  const text = boundedText(value, max, field);
  return text || null;
}

function httpUrl(value: unknown, max = 2000): string | null {
  const raw = cleanText(value);
  if (!raw || raw.length > max) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null;
}

function exactPlannedDate(
  low: unknown,
  ceil: unknown,
): string | null {
  const lowDate = dateOnly(low);
  const ceilDate = dateOnly(ceil);
  return lowDate && ceilDate && lowDate === ceilDate ? lowDate : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function percentage(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function firstPercentage(
  row: Record<string, unknown>,
  fields: readonly string[],
): number | null {
  for (const field of fields) {
    const value = percentage(row[field]);
    if (value !== null) return value;
  }
  return null;
}

function filePurpose(source: LegacyStoredFileSource): RoundFilePurpose {
  switch (source.purpose) {
    case "Regulamin":
      return "regulations";
    case "Instrukcja":
      return "instructions";
    case "Formularz do uzupełnienia":
      return "form";
    default:
      return "other";
  }
}

function requirement(source: LegacyStoredFileSource): RoundRequirement {
  switch (source.client_requirement) {
    case "Obowiązkowy":
      return "required";
    case "Warunkowy":
      return "conditional";
    case "Informacyjny":
      return "informational";
    default:
      return "unknown";
  }
}

function signatureRequirement(
  source: LegacyStoredFileSource,
): RoundSignatureRequirement {
  switch (source.signature_requirement) {
    case "Nie jest wymagany":
      return "not_required";
    case "Wymagany podpisany plik":
      return "required_file";
    case "Dowód w systemie operatora":
      return "external_operator";
    default:
      return "unknown";
  }
}

function purposeLabel(purpose: RoundFilePurpose): string {
  return {
    regulations: "Regulamin",
    instructions: "Instrukcja",
    form: "Formularz",
    other: "Inny dokument",
  }[purpose];
}

function sourceExtension(source: LegacyStoredFileSource): string | null {
  const name = cleanText(source.name);
  const match = name.match(/\.([A-Za-z0-9]+)$/u);
  const fromName = match?.[1]?.toLocaleLowerCase("en-US") ?? "";
  if (TARGET_EXTENSIONS.has(fromName)) return fromName;
  return FILE_TYPE_EXTENSION[source.fileType] ?? null;
}

function targetFileName(
  source: LegacyStoredFileSource,
  index: number,
): string {
  const extension = sourceExtension(source);
  if (!extension) {
    throw new Error(
      `${source.name || `Plik ${index + 1}`}: RoundImportManifestV1 obsługuje tylko PDF, DOC, DOCX, XLSX, JPG, JPEG i PNG.`,
    );
  }

  const fallback = `plik-${index + 1}.${extension}`;
  let name = safeDownloadPathSegment(source.name, fallback, false, 180);
  const current = name.match(/\.([A-Za-z0-9]+)$/u)?.[1]?.toLocaleLowerCase("en-US");
  if (!current || !TARGET_EXTENSIONS.has(current)) {
    name = `${name.replace(/\.+$/u, "")}.${extension}`;
  }
  return name;
}

function recruitmentName(recruitment: LegacyStoredObject): string {
  const name =
    cleanText(recruitment.values?.external_number) ||
    cleanText(recruitment.label) ||
    cleanText(recruitment.importKey) ||
    cleanText(recruitment.id);
  if (!name) throw new Error("Nabór nie ma nazwy.");
  return boundedText(name, 255, "name");
}

function projectName(project: LegacyStoredObject | undefined): string | null {
  if (!project) return null;
  return maybeBoundedText(
    cleanText(project.values?.name) || cleanText(project.label),
    500,
    "workspace.conditions.projectName",
  );
}

function programCode(
  recruitment: LegacyStoredObject,
  project: LegacyStoredObject | undefined,
): string | null {
  const code =
    cleanText(recruitment.values?.action_code) ||
    cleanText(project?.values?.number);
  return maybeBoundedText(code, 50, "workspace.conditions.programCode");
}

function status(value: unknown): RoundOperatorStatus {
  switch (String(value ?? "")) {
    case "PLANOWANY":
    case "OGLOSZONY":
      return "upcoming";
    case "AKTYWNY":
      return "active";
    case "ZAMKNIETY":
    case "ANULOWANY":
      return "closed";
    default:
      return "unknown";
  }
}

function terytCode(type: string, value: string): string | null {
  if (/^\d{2,8}$/u.test(value)) return value;
  if (type === "WOJEWODZTWO") return VOIVODESHIP_TERYT[value] ?? null;
  return null;
}

function geographyCodes(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): { included: string[]; excluded: string[]; skipped: number } {
  const included = new Set<string>();
  const excluded = new Set<string>();
  let skipped = 0;

  for (const row of state.geographies ?? []) {
    if (row.objectId !== recruitment.id) continue;
    const code = terytCode(String(row.type ?? ""), String(row.value ?? ""));
    if (!code) {
      skipped++;
      continue;
    }
    if (row.role === "WYKLUCZA") excluded.add(code);
    else if (row.role === "OBEJMUJE") included.add(code);
  }

  return {
    included: [...included].slice(0, 500),
    excluded: [...excluded].slice(0, 500),
    skipped,
  };
}

const CATEGORY_MAP: Record<string, RoundBusinessCategory> = {
  MICRO: "mikro",
  SMALL: "male",
  MEDIUM: "srednie",
  LARGE: "duze",
  NGO: "ngo",
};

const MSP_SIZE_MAP: Record<string, RoundMspSize> = {
  MICRO: "mikro",
  SMALL: "male",
  MEDIUM: "srednie",
  LARGE: "duze",
};

const FUNDING_LABEL: Record<string, string> = {
  MICRO: "Mikro",
  SMALL: "Małe",
  MEDIUM: "Średnie",
  LARGE: "Duże",
  B2C: "B2C",
  NGO: "NGO",
};

function fundingLabel(row: Record<string, unknown>, index: number): string {
  const size = String(row.company_size ?? "");
  const base = FUNDING_LABEL[size] ?? "Wariant";
  const variantNo = Number(row.variant_no);
  const variant =
    Number.isInteger(variantNo) && variantNo > 0 ? variantNo : index + 1;
  const note = cleanText(row.notes).replace(/\s+/gu, " ");
  const label = note ? `${base} — ${note}` : `${base} — wariant ${variant}`;
  return label.slice(0, 200).trim() || `Wariant ${index + 1}`;
}

function fundingVariants(
  rows: Array<Record<string, unknown>>,
): RoundImportFundingVariant[] {
  if (rows.length > 30) {
    throw new Error(
      `Nabór ma ${rows.length} wariantów dofinansowania; RoundImportManifestV1 dopuszcza maksymalnie 30.`,
    );
  }

  return rows.map((row, index) => ({
    label: fundingLabel(row, index),
    mspSize: MSP_SIZE_MAP[String(row.company_size ?? "")] ?? null,
    refundPct: firstPercentage(row, [
      "refund_percent_max",
      "refund_percent_standard",
      "refund_percent_avg",
      "refund_percent_base",
      "refund_percent_min",
      "refund_percent",
    ]),
    maxAmountPln: nonNegativeNumber(row.max_amount_pln),
    maxPerPersonPln: nonNegativeNumber(row.max_per_person_pln),
    ownContributionForm:
      row.own_contribution_form === "CASH"
        ? "monetary"
        : row.own_contribution_form === "WAGES"
          ? "salary"
          : null,
  }));
}

function aidBasis(description: string): RoundAidBasis {
  const normalized = description
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pl-PL");
  const deMinimis = /\bde\s+minimis\b/u.test(normalized);
  const gber = /\bgber\b/u.test(normalized);
  if (deMinimis && gber) return "mixed";
  if (deMinimis) return "de_minimis";
  if (gber) return "gber_training";
  return "unknown";
}

function schedule(
  recruitment: LegacyStoredObject,
): RoundImportManifestV1["workspace"]["schedule"] | undefined {
  const values = recruitment.values ?? {};
  const opensOn =
    dateOnly(values.dataRozpoczeciaOd) ??
    exactPlannedDate(
      values.planned_start_low_date,
      values.planned_start_ceil_date,
    );
  const closesOn =
    dateOnly(values.dataZakonczeniaDo) ??
    exactPlannedDate(values.planned_end_low_date, values.planned_end_ceil_date);
  const continuous = values.continuous === true;

  if (!opensOn && !closesOn && !continuous) return undefined;
  return {
    opensOn,
    closesOn,
    closeMode: closesOn ? "dated" : continuous ? "no_deadline" : "unknown",
  };
}

function documentFromFile(
  source: LegacyStoredFileSource,
  declaration: RoundImportFileDeclaration,
): RoundImportDocument {
  const purpose = filePurpose(source);
  const intendedUse = boundedText(
    source.intended_use,
    1000,
    `documents.${declaration.id}.purpose`,
  );
  const label = boundedText(
    cleanText(source.display_name) || source.name,
    500,
    `documents.${declaration.id}.label`,
  );
  const sourceUrl = httpUrl(source.sourcePageUrl) ?? httpUrl(source.url);
  const document: RoundImportDocument = {
    key: declaration.id,
    label: label || declaration.path.slice("files/".length),
    purpose: intendedUse || purposeLabel(purpose),
    requirement: requirement(source),
    fulfillmentMode:
      purpose === "form" ? "operator_template" : "without_operator_template",
    originalFileId: declaration.id,
    sourceFileIds: [declaration.id],
    signatureRequirement: signatureRequirement(source),
  };

  if (
    document.requirement === "conditional" &&
    intendedUse &&
    intendedUse.length <= 1000
  ) {
    document.condition = intendedUse;
  }
  if (sourceUrl) document.sourceUrl = sourceUrl;
  return document;
}

function officialIdentity(
  recruitment: LegacyStoredObject,
): Pick<
  RoundImportConditions,
  | "officialRoundIdentifier"
  | "officialIdentifierStatus"
  | "officialIdentifierEvidenceUrl"
> | null {
  const identifier = cleanText(recruitment.values?.source_number);
  const sequence = finiteNumber(recruitment.values?.sequence_number);
  if (
    !identifier ||
    (/^\d+$/u.test(identifier) &&
      Number.isInteger(sequence) &&
      Number(identifier) === sequence)
  ) {
    return null;
  }
  const bounded = boundedText(
    identifier,
    200,
    "workspace.conditions.officialRoundIdentifier",
  );
  return {
    officialRoundIdentifier: bounded,
    officialIdentifierStatus: "provided",
    officialIdentifierEvidenceUrl: httpUrl(recruitment.values?.urlOgloszenia),
  };
}

export function buildRoundImportPackagePlan(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): RoundImportPackagePlan {
  if (recruitment.type !== "recruitment") {
    throw new Error("RoundImportManifestV1 można utworzyć tylko dla naboru.");
  }

  const project = projectForRecruitment(state, recruitment);
  if (!project) {
    throw new Error(
      "Najpierw przypisz projekt do naboru — import V5 jest stosowany do naboru w wybranym programie/projekcie.",
    );
  }

  const sources = (state.fileSources ?? []).filter(
    (source) => source.objectId === recruitment.id,
  );
  if (sources.length > ROUND_IMPORT_MAX_FILES) {
    throw new Error(
      `Nabór ma ${sources.length} plików; RoundImportManifestV1 dopuszcza maksymalnie ${ROUND_IMPORT_MAX_FILES}.`,
    );
  }

  const fileNames = uniqueDownloadFileNames(
    sources.map((source, index) => targetFileName(source, index)),
    false,
  );
  const packageFiles: RoundImportPackageFile[] = sources.map(
    (source, index) => ({
      source,
      id: `FILE_${String(index + 1).padStart(3, "0")}`,
      path: `files/${fileNames[index]}`,
    }),
  );

  for (const file of packageFiles) {
    if (file.path.length > 240) {
      throw new Error(
        `${file.source.name}: ścieżka ${file.path.length} znaków przekracza limit 240.`,
      );
    }
  }

  const declarations: RoundImportFileDeclaration[] = packageFiles.map(
    (file) => {
      const purpose = filePurpose(file.source);
      return {
        id: file.id,
        path: file.path,
        purpose,
        requiresCompletion:
          purpose === "form" ? true : file.source.has_fields === true,
      };
    },
  );

  const rows = (state.financingRules ?? []).filter(
    (row) => String(row.objectId ?? "") === recruitment.id,
  );
  const categories = [
    ...new Set(
      rows
        .map((row) => CATEGORY_MAP[String(row.company_size ?? "")])
        .filter((value): value is RoundBusinessCategory => !!value),
    ),
  ].slice(0, 5);

  const geo = geographyCodes(state, recruitment);
  const eligibleEntities = boundedText(
    recruitment.values?.eligible_entities,
    4000,
    "workspace.conditions.eligibleEntities",
  );
  const fundingDescription = boundedText(
    cleanText(recruitment.values?.funding_conditions) ||
      cleanText(recruitment.values?.funding_rules),
    4000,
    "workspace.conditions.aidBasisDescription",
  );
  const submissionInstructions = boundedText(
    recruitment.values?.application_instructions,
    5000,
    "workspace.conditions.submissionInstructions",
  );

  const conditions: RoundImportConditions = {
    projectName: projectName(project),
    programCode: programCode(recruitment, project),
    operatorStatus: status(recruitment.values?.status),
    includedTerytCodes: geo.included,
    excludedTerytCodes: geo.excluded,
    eligibleEntities,
    eligibleBusinessCategories: categories,
    aidBasis: aidBasis(fundingDescription),
    aidBasisDescription: fundingDescription,
    fundingVariants: fundingVariants(rows),
    submissionInstructions,
    sourceFileIds: declarations.map((file) => file.id),
  };
  const identity = officialIdentity(recruitment);
  if (identity) Object.assign(conditions, identity);

  const roundSchedule = schedule(recruitment);
  const notes = boundedText(
    recruitment.values?.notes,
    5000,
    "workspace.notes",
  );
  const manifest: RoundImportManifestV1 = {
    format: "RoundImportManifestV1",
    name: recruitmentName(recruitment),
    files: declarations,
    workspace: {
      notes,
      ...(roundSchedule ? { schedule: roundSchedule } : {}),
      conditions,
      documents: packageFiles.map((file, index) =>
        documentFromFile(file.source, declarations[index]),
      ),
    },
  };

  const warnings: string[] = [];
  if (geo.skipped) {
    warnings.push(
      `Pominięto ${geo.skipped} wpisów geografii bez bezpośredniego kodu TERYT 2–8 cyfr.`,
    );
  }

  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2),
  );
  if (manifestBytes.byteLength > ROUND_IMPORT_MANIFEST_MAX_BYTES) {
    throw new Error("import.json przekracza limit 1 MiB.");
  }

  const folder = safeDownloadPathSegment(
    `${recruitmentName(recruitment)} - ${projectName(project) ?? "Projekt"}`,
    "import",
    false,
    170,
  );

  return {
    manifest,
    files: packageFiles,
    zipFileName: `${folder}.zip`,
    warnings,
  };
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function buildStoreZip(
  entries: readonly ZipEntry[],
  modifiedAt = new Date(),
): Uint8Array {
  if (!entries.length || entries.length > 0xffff) {
    throw new Error("ZIP musi zawierać od 1 do 65535 wpisów.");
  }

  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(modifiedAt);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const paths = new Set<string>();
  let localOffset = 0;

  for (const entry of entries) {
    if (
      !entry.path ||
      entry.path.startsWith("/") ||
      entry.path.includes("\\") ||
      entry.path.includes(":") ||
      entry.path.includes("%") ||
      entry.path.split("/").includes("..")
    ) {
      throw new Error(`Nieprawidłowa ścieżka ZIP: ${entry.path}`);
    }
    if (paths.has(entry.path)) {
      throw new Error(`Duplikat ścieżki ZIP: ${entry.path}`);
    }
    paths.add(entry.path);

    const name = encoder.encode(entry.path);
    if (name.byteLength > 0xffff) {
      throw new Error(`Nazwa ZIP jest zbyt długa: ${entry.path}`);
    }
    if (entry.data.byteLength > 0xffffffff) {
      throw new Error(`Plik jest zbyt duży dla ZIP bez ZIP64: ${entry.path}`);
    }

    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    setU32(lv, 0, 0x04034b50);
    setU16(lv, 4, 20);
    setU16(lv, 6, 0x0800);
    setU16(lv, 8, 0);
    setU16(lv, 10, time);
    setU16(lv, 12, date);
    setU32(lv, 14, crc);
    setU32(lv, 18, entry.data.byteLength);
    setU32(lv, 22, entry.data.byteLength);
    setU16(lv, 26, name.byteLength);
    setU16(lv, 28, 0);
    local.set(name, 30);
    locals.push(local, entry.data);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    setU32(cv, 0, 0x02014b50);
    setU16(cv, 4, 20);
    setU16(cv, 6, 20);
    setU16(cv, 8, 0x0800);
    setU16(cv, 10, 0);
    setU16(cv, 12, time);
    setU16(cv, 14, date);
    setU32(cv, 16, crc);
    setU32(cv, 20, entry.data.byteLength);
    setU32(cv, 24, entry.data.byteLength);
    setU16(cv, 28, name.byteLength);
    setU16(cv, 30, 0);
    setU16(cv, 32, 0);
    setU16(cv, 34, 0);
    setU16(cv, 36, 0);
    setU32(cv, 38, 0);
    setU32(cv, 42, localOffset);
    central.set(name, 46);
    centrals.push(central);

    localOffset += local.byteLength + entry.data.byteLength;
  }

  const centralBytes = concatBytes(centrals);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  setU32(ev, 0, 0x06054b50);
  setU16(ev, 4, 0);
  setU16(ev, 6, 0);
  setU16(ev, 8, entries.length);
  setU16(ev, 10, entries.length);
  setU32(ev, 12, centralBytes.byteLength);
  setU32(ev, 16, localOffset);
  setU16(ev, 20, 0);

  return concatBytes([...locals, centralBytes, end]);
}

async function readResponseWithLimit(
  response: Response,
  sourceName: string,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > ROUND_IMPORT_FILE_MAX_BYTES
  ) {
    throw new Error(
      `${sourceName}: plik ma ponad 10 MiB i nie może wejść do RoundImportManifestV1.`,
    );
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > ROUND_IMPORT_FILE_MAX_BYTES) {
      throw new Error(`${sourceName}: plik przekracza limit 10 MiB.`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > ROUND_IMPORT_FILE_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`${sourceName}: plik przekracza limit 10 MiB.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

async function fetchPackageFile(file: RoundImportPackageFile): Promise<Uint8Array> {
  const response = await fetch(file.source.url, {
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `${file.source.name}: pobranie zwróciło HTTP ${response.status}.`,
    );
  }
  return readResponseWithLimit(response, file.source.name);
}

export async function buildRoundImportZip(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
  onProgress?: (completed: number, total: number, fileName: string) => void,
): Promise<RoundImportZipResult> {
  const plan = buildRoundImportPackagePlan(state, recruitment);
  const entries: ZipEntry[] = [];
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(plan.manifest, null, 2),
  );
  entries.push({ path: "import.json", data: manifestBytes });

  let totalBytes = 0;
  for (let index = 0; index < plan.files.length; index++) {
    const file = plan.files[index];
    onProgress?.(index, plan.files.length, file.source.name);
    const data = await fetchPackageFile(file);
    totalBytes += data.byteLength;
    if (totalBytes > ROUND_IMPORT_TOTAL_FILE_MAX_BYTES) {
      throw new Error(
        "Łączny rozmiar plików przekracza 99 MiB (1 MiB pozostaje zarezerwowany na manifest).",
      );
    }
    entries.push({ path: file.path, data });
  }
  if (plan.files.length) {
    onProgress?.(plan.files.length, plan.files.length, "");
  }

  const zip = buildStoreZip(entries);
  const blobBytes = new Uint8Array(zip.byteLength);
  blobBytes.set(zip);
  return {
    blob: new Blob([blobBytes.buffer], { type: "application/zip" }),
    manifest: plan.manifest,
    zipFileName: plan.zipFileName,
    warnings: plan.warnings,
  };
}
