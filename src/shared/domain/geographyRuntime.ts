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
  context?: string;
  search: string;
}

const powiatByKey = Powiat as unknown as Record<string, string>;
const powiatKeyPrefixes = Object.keys(powiatByKey).sort(
  (a, b) => b.length - a.length,
);

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("pl-PL"));
}

function lastSegment(value: string): string {
  return value.split("|").at(-1) ?? value;
}

function parentContext(value: string): string | undefined {
  const parts = value.split("|");
  if (parts.length < 3) return undefined;
  return parts.slice(0, -1).filter((part) => part !== "powiat" && part !== "miasto").join(" · ");
}

function gminaMetadata(key: string): { label: string; context?: string } {
  const suffixless = key
    .replace(/_MIEJSKO_WIEJSKA$/, "")
    .replace(/_MIEJSKA$/, "")
    .replace(/_WIEJSKA$/, "");
  const powiatKey = powiatKeyPrefixes.find((prefix) =>
    suffixless.startsWith(`${prefix}_`),
  );
  const locality = powiatKey
    ? suffixless.slice(powiatKey.length + 1)
    : suffixless;
  const powiatValue = powiatKey ? powiatByKey[powiatKey] : undefined;

  return {
    label: titleCase(locality.replaceAll("_", " ")),
    context: powiatValue
      ? `${lastSegment(powiatValue)} · ${powiatValue.split("|")[0]}`
      : undefined,
  };
}

function simpleEntries(
  type: GeographyCatalogEntry["type"],
  values: object,
  metadata: (
    key: string,
    value: string,
  ) => Pick<GeographyCatalogEntry, "label" | "context"> = (_key, value) => ({
    label: value,
  }),
): GeographyCatalogEntry[] {
  return Object.entries(values as Record<string, string>).map(([key, value]) => {
    const presentation = metadata(key, value);
    return {
      type,
      value,
      ...presentation,
      search: `${key} ${value} ${presentation.label} ${presentation.context ?? ""}`,
    };
  });
}

export const geographyCatalog: GeographyCatalogEntry[] = [
  ...simpleEntries("POLSKA", Polska),
  ...simpleEntries("WOJEWODZTWO", Wojewodztwo),
  ...simpleEntries("PODREGION", Podregion),
  ...simpleEntries("POWIAT", Powiat, (_key, value) => ({
    label: lastSegment(value),
    context: parentContext(value),
  })),
  ...simpleEntries("GMINA", Gmina, (key) => gminaMetadata(key)),
  ...simpleEntries(
    "MIASTO_NA_PRAWACH_POWIATU",
    MiastoNaPrawachPowiatu,
    (_key, value) => ({
      label: lastSegment(value),
      context: parentContext(value),
    }),
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
