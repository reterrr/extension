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

function oneOf<T extends readonly string[]>(
  options: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && options.includes(value);
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
