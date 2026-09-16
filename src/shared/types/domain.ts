import type {ExecutableExtractionRule} from "./extraction";

export type ObjectType = "project" | "recruitment" | "operator" | "nabor";
export type ImportSourceType = "HTML" | "PDF" | "XLSX";

export interface ImportedSourceSnapshot {
    text: string;
    capturedAt?: string;
    contentHash?: string;
    parserVersion?: string;
}

export interface ImportedSource {
    id: string;
    importKey: string;
    type: ImportSourceType;
    url?: string;
    snapshot: ImportedSourceSnapshot;
    importedAt: string;
}

export interface ImportedEvidence {
    sourceId: string;
    charStart: number;
    charEnd: number;
    rawValue: string;
    normalizedValue?: unknown;
}

export interface BurbotObject {
    id: string;
    type: ObjectType;
    label?: string;
    values: Record<string, unknown>;
    sourceUrl?: string;
    creationNote?: string;
    createdAt?: string;
    updatedAt?: string;
    importKey?: string;
    evidence?: Record<string, ImportedEvidence[]>;
    manualFields?: Record<string, boolean>;
}

export type BurbotRule = ExecutableExtractionRule & {
    objectId: string;
    field: string;
    sampleValue?: string;
    lastSampleValue?: string;
    lastExtractedAt?: string;
    target?: { kind: string; id: string };
    transform?: { sample: string; value: unknown };
    createdAt?: string;
};

export interface BurbotState {
    version: 1;
    revision: number;
    objects: BurbotObject[];
    rules: BurbotRule[];
    importSources?: ImportedSource[];
    financingRules?: Array<Record<string, unknown>>;
    documentRequirements?: Array<Record<string, unknown>>;
}

export interface FocusPayload {
    objectId?: string;
    tabId?: number;
    stamp: string;
    note?: string;
    error?: string;
}

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
// WARTOSCI GEOGRAFICZNE
// ============================================================

export enum Wojewodztwo {
    PODKARPACKIE = "PODKARPACKIE",
    MAZOWIECKIE = "MAZOWIECKIE",
    MALOPOLSKIE = "MALOPOLSKIE",
    // ...
}

export enum Podregion {}

export enum Powiat {}

export enum Gmina {}

export enum MiastoNaPrawachPowiatu {}


export enum Polska {
    POLSKA = "POLSKA",
}

// ============================================================
// FRONT / DOMAIN DTO
// tylko te 3 modele wychodza do frontendu
// ============================================================

export interface Projekt {
    id: bigint

    typ: TypProjektu
    nazwa: string
    numer: string | null
    status: StatusProjektu

    dataRozpoczecia: string | null
    dataZakonczenia: string | null

    urlNaborow: string | null

    operatorzy: Array<
        Operator & {
        typOperatora: TypOperatora
    }>

    geografia: GeografiaProjektu[]
}


export interface Operator {
    id: bigint
    nazwa: string
    nip: string | null
}


export interface Nabor {
    id: bigint

    projekt: Projekt

    numerZewnetrzny: string | null
    numerKolejny: number | null
    rok: number | null

    status: StatusNaboru

    /**
     * Dokladna data:
     * od == do
     *
     * Zakres:
     * 16.06.2026 - 25.06.2026
     */
    dataRozpoczeciaOd: string | null
    dataRozpoczeciaDo: string | null

    dataZakonczeniaOd: string | null
    dataZakonczeniaDo: string | null

    /**
     * Uzywane, gdy znamy tylko przyblizony termin,
     * np. "IV kwartal 2026" albo "listopad 2026".
     */
    planowanyStartRok: number | null
    planowanyStartMiesiac: number | null
    planowanyStartKwartal: 1 | 2 | 3 | 4 | null

    planowanyKoniecRok: number | null
    planowanyKoniecMiesiac: number | null
    planowanyKoniecKwartal: 1 | 2 | 3 | 4 | null

    statusZakonczenia: string | null
    powodStatusu: string | null

    urlOgloszenia: string | null

    geografia: GeografiaNaboru[]
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
    | MiastoNaPrawachPowiatu


export interface GeografiaProjektu {
    typ: TypGeografii
    rola: RolaGeografii
    wartosc: WartoscGeografii
}


export interface GeografiaNaboru {
    typ: TypGeografii
    rola: RolaGeografii
    wartosc: WartoscGeografii
}


// ============================================================
// SQLITE ROW TYPES
// ============================================================

export interface ProjektRow {
    id: bigint

    typ: TypProjektu
    nazwa: string
    numer: string | null
    status: StatusProjektu

    dataRozpoczecia: string | null
    dataZakonczenia: string | null

    urlNaborow: string | null

    grupaGeografiiId: bigint | null
}


export interface NaborRow {
    id: bigint
    projektId: bigint

    numerZewnetrzny: string | null
    numerKolejny: number | null
    rok: number | null

    status: StatusNaboru

    dataRozpoczeciaOd: string | null
    dataRozpoczeciaDo: string | null

    dataZakonczeniaOd: string | null
    dataZakonczeniaDo: string | null

    planowanyStartRok: number | null
    planowanyStartMiesiac: number | null
    planowanyStartKwartal: 1 | 2 | 3 | 4 | null

    planowanyKoniecRok: number | null
    planowanyKoniecMiesiac: number | null
    planowanyKoniecKwartal: 1 | 2 | 3 | 4 | null

    statusZakonczenia: string | null
    powodStatusu: string | null

    urlOgloszenia: string | null

    grupaGeografiiId: bigint | null
}


export interface OperatorRow {
    id: bigint

    nazwa: string
    nip: string | null
}


export interface ProjektOperatorRow {
    id: bigint

    projektId: bigint
    operatorId: bigint

    typOperatora: TypOperatora
}


// ============================================================
// SQLITE - GEOGRAFIA
// ============================================================

export interface GrupaGeografiiRow {
    id: bigint
}


export interface GeografiaRow {
    id: bigint

    grupaGeografiiId: bigint

    typ: TypGeografii
    rola: RolaGeografii

    obiektGeografiiId: bigint
}


export interface PolskaRow {
    id: bigint
    wartosc: Polska
}

export interface WojewodztwoRow {
    id: bigint
    wartosc: Wojewodztwo
}


export interface PodregionRow {
    id: bigint
    wartosc: Podregion
}


export interface PowiatRow {
    id: bigint
    wartosc: Powiat
}


export interface GminaRow {
    id: bigint
    wartosc: Gmina
}


export interface MiastoNaPrawachPowiatuRow {
    id: bigint
    wartosc: MiastoNaPrawachPowiatu
}