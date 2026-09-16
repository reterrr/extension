import {
  Gmina,
  MiastoNaPrawachPowiatu,
  Podregion,
  Polska,
  Powiat,
  Wojewodztwo,
} from "../types/geography";

export interface GeographyCatalogEntry {
  type:
    | "POLSKA"
    | "WOJEWODZTWO"
    | "PODREGION"
    | "POWIAT"
    | "GMINA"
    | "MIASTO_NA_PRAWACH_POWIATU";
  value: string;
  label: string;
  search: string;
}

const powiatKeyPrefixes = Object.keys(Powiat).sort((a, b) => b.length - a.length);

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("pl-PL"));
}

function lastSegment(value: string): string {
  return value.split("|").at(-1) ?? value;
}

function humanizeGminaKey(key: string): string {
  const suffixless = key
    .replace(/_MIEJSKO_WIEJSKA$/, "")
    .replace(/_MIEJSKA$/, "")
    .replace(/_WIEJSKA$/, "");
  const powiatPrefix = powiatKeyPrefixes.find((prefix) =>
    suffixless.startsWith(`${prefix}_`),
  );
  const locality = powiatPrefix
    ? suffixless.slice(powiatPrefix.length + 1)
    : suffixless;
  return titleCase(locality.replaceAll("_", " "));
}

function simpleEntries(
  type: GeographyCatalogEntry["type"],
  values: object,
  label: (key: string, value: string) => string = (_key, value) => value,
): GeographyCatalogEntry[] {
  return Object.entries(values as Record<string, string>).map(([key, value]) => ({
    type,
    value,
    label: label(key, value),
    search: `${key} ${value}`,
  }));
}

export const geographyCatalog: GeographyCatalogEntry[] = [
  ...simpleEntries("POLSKA", Polska),
  ...simpleEntries("WOJEWODZTWO", Wojewodztwo),
  ...simpleEntries("PODREGION", Podregion),
  ...simpleEntries("POWIAT", Powiat, (_key, value) => lastSegment(value)),
  ...simpleEntries("GMINA", Gmina, (key) => humanizeGminaKey(key)),
  ...simpleEntries(
    "MIASTO_NA_PRAWACH_POWIATU",
    MiastoNaPrawachPowiatu,
    (_key, value) => lastSegment(value),
  ),
];

export const geographyRuntime = Object.freeze({
  types: Object.freeze({
    POLSKA: "Polska",
    WOJEWODZTWO: "Województwo",
    PODREGION: "Podregion",
    POWIAT: "Powiat",
    GMINA: "Gmina",
    MIASTO_NA_PRAWACH_POWIATU: "Miasto na prawach powiatu",
  }),
  roles: Object.freeze({
    OBEJMUJE: "Obejmuje",
    WYKLUCZA: "Wyklucza",
  }),
  fields: Object.freeze({
    value: Object.freeze({
      label: "Geografia",
      type: "geography",
      group: "Geografia",
    }),
  }),
  catalog: geographyCatalog,
});

globalThis.BurbotGeography = geographyRuntime;
