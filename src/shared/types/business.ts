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
  godzinaRozpoczecia: string | null;
  dataZakonczeniaDo: string | null;
  godzinaZakonczenia: string | null;

  /** Legacy range-boundary fields kept only for older stored data. */
  dataRozpoczeciaDo: string | null;
  dataZakonczeniaOd: string | null;

  plannedStartLowDate: string | null;
  plannedStartCeilDate: string | null;
  plannedStartLowTime: string | null;
  plannedStartCeilTime: string | null;
  plannedEndLowDate: string | null;
  plannedEndCeilDate: string | null;
  plannedEndLowTime: string | null;
  plannedEndCeilTime: string | null;

  plannedStartLowYear: number | null;
  plannedStartCeilYear: number | null;
  plannedStartLowMonth: number | null;
  plannedStartCeilMonth: number | null;
  plannedStartLowWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedStartCeilWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedStartLowQuarter: 1 | 2 | 3 | 4 | null;
  plannedStartCeilQuarter: 1 | 2 | 3 | 4 | null;

  plannedEndLowYear: number | null;
  plannedEndCeilYear: number | null;
  plannedEndLowMonth: number | null;
  plannedEndCeilMonth: number | null;
  plannedEndLowWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedEndCeilWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedEndLowQuarter: 1 | 2 | 3 | 4 | null;
  plannedEndCeilQuarter: 1 | 2 | 3 | 4 | null;

  /** Legacy single-value planned fields. */
  plannedStartLowDate: string | null;
  plannedStartCeilDate: string | null;
  plannedStartLowTime: string | null;
  plannedStartCeilTime: string | null;
  plannedEndLowDate: string | null;
  plannedEndCeilDate: string | null;
  plannedEndLowTime: string | null;
  plannedEndCeilTime: string | null;
  plannedStartLowYear: number | null;
  plannedStartCeilYear: number | null;
  plannedStartLowMonth: number | null;
  plannedStartCeilMonth: number | null;
  plannedStartLowWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedStartCeilWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedStartLowQuarter: 1 | 2 | 3 | 4 | null;
  plannedStartCeilQuarter: 1 | 2 | 3 | 4 | null;
  plannedEndLowYear: number | null;
  plannedEndCeilYear: number | null;
  plannedEndLowMonth: number | null;
  plannedEndCeilMonth: number | null;
  plannedEndLowWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedEndCeilWeek: 1 | 2 | 3 | 4 | 5 | null;
  plannedEndLowQuarter: 1 | 2 | 3 | 4 | null;
  plannedEndCeilQuarter: 1 | 2 | 3 | 4 | null;
  planowanyStartRok: number | null;
  planowanyStartMiesiac: number | null;
  planowanyStartTydzien: 1 | 2 | 3 | 4 | 5 | null;
  planowanyStartKwartal: 1 | 2 | 3 | 4 | null;
  planowanyKoniecRok: number | null;
  planowanyKoniecMiesiac: number | null;
  planowanyKoniecTydzien: 1 | 2 | 3 | 4 | 5 | null;
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
  godzinaRozpoczecia: string | null;
  dataRozpoczeciaDo: string | null;
  dataZakonczeniaOd: string | null;
  dataZakonczeniaDo: string | null;
  godzinaZakonczenia: string | null;
  planowanyStartRok: number | null;
  planowanyStartMiesiac: number | null;
  planowanyStartTydzien: 1 | 2 | 3 | 4 | 5 | null;
  planowanyStartKwartal: 1 | 2 | 3 | 4 | null;
  planowanyKoniecRok: number | null;
  planowanyKoniecMiesiac: number | null;
  planowanyKoniecTydzien: 1 | 2 | 3 | 4 | 5 | null;
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
