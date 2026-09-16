import type {
  Gmina,
  MiastoNaPrawachPowiatu,
  Podregion,
  Polska,
  Powiat,
  Wojewodztwo,
} from "./geography";

export {
  Gmina,
  MiastoNaPrawachPowiatu,
  Podregion,
  Polska,
  Powiat,
  Wojewodztwo,
} from "./geography";

// ============================================================
// ENUMY
// ============================================================

export enum TypProjektu {
  B2B = "B2B",
  B2C = "B2C",
}

export enum StatusProjektu {
  PLANOWANY = "PLANOWANY",
  AKTYWNY = "AKTYWNY",
  ZAWIESZONY = "ZAWIESZONY",
  ZAKONCZONY = "ZAKONCZONY",
}

export enum StatusNaboru {
  PLANOWANY = "PLANOWANY",
  OGLOSZONY = "OGLOSZONY",
  AKTYWNY = "AKTYWNY",
  ZAWIESZONY = "ZAWIESZONY",
  ZAKONCZONY = "ZAKONCZONY",
}

export enum TypOperatora {
  GLOWNY = "GLOWNY",
  DODATKOWY = "DODATKOWY",
}

export enum TypGeografii {
  POLSKA = "POLSKA",
  WOJEWODZTWO = "WOJEWODZTWO",
  PODREGION = "PODREGION",
  POWIAT = "POWIAT",
  GMINA = "GMINA",
  MIASTO_NA_PRAWACH_POWIATU = "MIASTO_NA_PRAWACH_POWIATU",
}

export enum RolaGeografii {
  OBEJMUJE = "OBEJMUJE",
  WYKLUCZA = "WYKLUCZA",
}

// ============================================================
// FRONT / DOMAIN DTO
// ============================================================

export interface Projekt {
  id: bigint;

  typ: TypProjektu;
  nazwa: string;
  numer: string | null;
  status: StatusProjektu;

  dataRozpoczecia: string | null;
  dataZakonczenia: string | null;

  urlNaborow: string | null;

  operatorzy: OperatorProjektu[];
  geografia: GeografiaProjektu[];
}

export interface Operator {
  id: bigint;
  nazwa: string;
  nip: string | null;
}

/** Typ operatora jest cecha relacji projekt-operator. */
export type OperatorProjektu = Operator & {
  typOperatora: TypOperatora;
};

export interface Nabor {
  id: bigint;
  projekt: Projekt;

  numerZewnetrzny: string | null;
  numerKolejny: number | null;
  rok: number | null;

  status: StatusNaboru;

  dataRozpoczeciaOd: string | null;
  dataRozpoczeciaDo: string | null;
  dataZakonczeniaOd: string | null;
  dataZakonczeniaDo: string | null;

  planowanyStartRok: number | null;
  planowanyStartMiesiac: number | null;
  planowanyStartKwartal: 1 | 2 | 3 | 4 | null;

  planowanyKoniecRok: number | null;
  planowanyKoniecMiesiac: number | null;
  planowanyKoniecKwartal: 1 | 2 | 3 | 4 | null;

  statusZakonczenia: string | null;
  powodStatusu: string | null;

  urlOgloszenia: string | null;
  geografia: GeografiaNaboru[];
}

// ============================================================
// FRONT - GEOGRAFIA
// ============================================================

export type WartoscGeografii =
  | Polska
  | Wojewodztwo
  | Podregion
  | Powiat
  | Gmina
  | MiastoNaPrawachPowiatu;

export interface GeografiaProjektu {
  typ: TypGeografii;
  rola: RolaGeografii;
  wartosc: WartoscGeografii;
}

export interface GeografiaNaboru {
  typ: TypGeografii;
  rola: RolaGeografii;
  wartosc: WartoscGeografii;
}

// ============================================================
// SQLITE ROW TYPES
// ============================================================

export interface ProjektRow {
  id: bigint;
  typ: TypProjektu;
  nazwa: string;
  numer: string | null;
  status: StatusProjektu;
  dataRozpoczecia: string | null;
  dataZakonczenia: string | null;
  urlNaborow: string | null;
  grupaGeografiiId: bigint | null;
}

export interface NaborRow {
  id: bigint;
  projektId: bigint;
  numerZewnetrzny: string | null;
  numerKolejny: number | null;
  rok: number | null;
  status: StatusNaboru;
  dataRozpoczeciaOd: string | null;
  dataRozpoczeciaDo: string | null;
  dataZakonczeniaOd: string | null;
  dataZakonczeniaDo: string | null;
  planowanyStartRok: number | null;
  planowanyStartMiesiac: number | null;
  planowanyStartKwartal: 1 | 2 | 3 | 4 | null;
  planowanyKoniecRok: number | null;
  planowanyKoniecMiesiac: number | null;
  planowanyKoniecKwartal: 1 | 2 | 3 | 4 | null;
  statusZakonczenia: string | null;
  powodStatusu: string | null;
  urlOgloszenia: string | null;
  grupaGeografiiId: bigint | null;
}

export interface OperatorRow {
  id: bigint;
  nazwa: string;
  nip: string | null;
}

export interface ProjektOperatorRow {
  id: bigint;
  projektId: bigint;
  operatorId: bigint;
  typOperatora: TypOperatora;
}

// ============================================================
// SQLITE - GEOGRAFIA
// ============================================================

export interface GrupaGeografiiRow {
  id: bigint;
}

export interface GeografiaRow {
  id: bigint;
  grupaGeografiiId: bigint;
  typ: TypGeografii;
  rola: RolaGeografii;
  obiektGeografiiId: bigint;
}

export interface PolskaRow {
  id: bigint;
  wartosc: Polska;
}

export interface WojewodztwoRow {
  id: bigint;
  wartosc: Wojewodztwo;
}

export interface PodregionRow {
  id: bigint;
  wartosc: Podregion;
}

export interface PowiatRow {
  id: bigint;
  wartosc: Powiat;
}

export interface GminaRow {
  id: bigint;
  wartosc: Gmina;
}

export interface MiastoNaPrawachPowiatuRow {
  id: bigint;
  wartosc: MiastoNaPrawachPowiatu;
}
