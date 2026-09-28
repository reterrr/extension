export const FILE_PURPOSES = [
  "Formularz do uzupełnienia",
  "Regulamin",
  "Instrukcja",
  "Inny dokument",
] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const FILE_CLIENT_REQUIREMENTS = [
  "Obowiązkowy",
  "Warunkowy",
  "Informacyjny",
] as const;

export type FileClientRequirement =
  (typeof FILE_CLIENT_REQUIREMENTS)[number];

export const FILE_SIGNATURE_REQUIREMENTS = [
  "Nie jest wymagany",
  "Wymagany podpisany plik",
  "Dowód w systemie operatora",
] as const;

export type FileSignatureRequirement =
  (typeof FILE_SIGNATURE_REQUIREMENTS)[number];

export const FILE_METADATA_UNSET_LABEL = "Nie ustalono";
export const FILE_METADATA_INFERENCE_VERSION = 1;

export interface InferredFileMetadata {
  purpose?: FilePurpose;
  has_fields?: boolean;
  client_requirement?: FileClientRequirement;
  signature_requirement?: FileSignatureRequirement;
}

function oneOf<T extends readonly string[]>(
  options: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === "string" &&
    (options as readonly string[]).includes(value)
  );
}

export function isFilePurpose(value: unknown): value is FilePurpose {
  return oneOf(FILE_PURPOSES, value);
}

export function isFileClientRequirement(
  value: unknown,
): value is FileClientRequirement {
  return oneOf(FILE_CLIENT_REQUIREMENTS, value);
}

export function isFileSignatureRequirement(
  value: unknown,
): value is FileSignatureRequirement {
  return oneOf(FILE_SIGNATURE_REQUIREMENTS, value);
}

function normalizeFileName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Keep the original value when the URL/file name contains a stray '%'.
  }

  const withoutExtension = decoded.replace(/\.[a-z0-9]{1,8}(?:[?#].*)?$/iu, "");
  return withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pl-PL")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function contains(text: string, ...needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

const FORM = "Formularz do uzupełnienia" as const;
const INFO = "Informacyjny" as const;
const REQUIRED = "Obowiązkowy" as const;
const CONDITIONAL = "Warunkowy" as const;
const SIGNED = "Wymagany podpisany plik" as const;
const NO_SIGNATURE = "Nie jest wymagany" as const;

/**
 * Conservative filename-based defaults for BUR/PSF document metadata.
 *
 * The rules intentionally infer only fields that are strongly suggested by the
 * document name. Explicit/imported/manual metadata always wins. In particular,
 * "do Regulaminu" in an attachment name does NOT make the attachment a
 * regulation; more specific document patterns are checked first.
 */
export function inferFileMetadataFromName(
  rawName: string,
): InferredFileMetadata {
  const name = normalizeFileName(rawName);
  if (!name) return {};

  const pur1 =
    /\bpur\s*cz\s*1\b/u.test(name) ||
    /\bplan uslug rozwojowych\s*cz\s*1\b/u.test(name);
  const pur2 =
    /\bpur\s*cz\s*2\b/u.test(name) ||
    /\bplan uslug rozwojowych\s*cz\s*2\b/u.test(name);

  if (pur1 && !contains(name, "kryteria", "karta oceny")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: REQUIRED,
      signature_requirement: SIGNED,
    };
  }

  if (pur2 && !contains(name, "kryteria", "karta oceny")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: CONDITIONAL,
      signature_requirement: SIGNED,
    };
  }

  if (contains(name, "karta oceny")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "lista sprawdzajaca")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "protokol") && contains(name, "monitoring", "wizyta")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: INFO,
      signature_requirement: SIGNED,
    };
  }

  if (
    contains(
      name,
      "podstawowa lista",
      "lista podstawowa",
      "ostateczna lista",
      "lista ostateczna",
      "lista rankingowa",
    )
  ) {
    return {
      purpose: "Inny dokument",
      has_fields: true,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "lista zatwierdzonych", "lista uczestnikow")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: CONDITIONAL,
    };
  }

  if (contains(name, "formularz uczestnika")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: CONDITIONAL,
    };
  }

  if (contains(name, "pelnomocnictwo")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: CONDITIONAL,
      signature_requirement: SIGNED,
    };
  }

  if (contains(name, "wniosek o rozliczenie", "wniosek rozliczenie")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: REQUIRED,
      signature_requirement: SIGNED,
    };
  }

  if (contains(name, "zaswiadczenie o zakonczeniu")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: REQUIRED,
    };
  }

  if (contains(name, "formularz") && contains(name, "de minimis")) {
    return {
      purpose: FORM,
      has_fields: true,
      client_requirement: REQUIRED,
    };
  }

  if (contains(name, "oswiadczenie")) {
    return {
      purpose: FORM,
      has_fields: true,
      signature_requirement: SIGNED,
    };
  }

  if (contains(name, "umowa")) {
    return {
      purpose: "Inny dokument",
      has_fields: true,
      client_requirement: CONDITIONAL,
      signature_requirement: SIGNED,
    };
  }

  if (contains(name, "kryteria")) {
    return {
      purpose: "Instrukcja",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "instrukcja")) {
    return {
      purpose: "Instrukcja",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "wykaz")) {
    return {
      purpose: "Instrukcja",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "klauzula") && contains(name, "inform")) {
    return {
      purpose: "Inny dokument",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (contains(name, "zasady urp", "zasady wdrazania")) {
    return {
      purpose: "Regulamin",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  const mentionsRegulation = contains(name, "regulamin");
  const isAttachmentToRegulation = contains(name, "do regulaminu");
  if (mentionsRegulation && !isAttachmentToRegulation) {
    return {
      purpose: "Regulamin",
      has_fields: false,
      client_requirement: INFO,
      signature_requirement: NO_SIGNATURE,
    };
  }

  if (
    contains(
      name,
      "formularz",
      "wniosek",
      "zaswiadczenie",
      "deklaracja",
    )
  ) {
    return {
      purpose: FORM,
      has_fields: true,
    };
  }

  return {};
}
