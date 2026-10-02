import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBurSheets,
  SHEET_HEADERS,
} from "../scripts/db/bur-excel-export.mjs";
import { buildXlsxWorkbook } from "../scripts/db/xlsx.mjs";

const geographySource = `
export enum Wojewodztwo {
  PODKARPACKIE = "podkarpackie",
  DOLNOSLASKIE = "dolnośląskie",
}
export enum Powiat {
  PODKARPACKIE_RZESZOWSKI = "podkarpackie|powiat|rzeszowski",
}
export enum MiastoNaPrawachPowiatu {
  DOLNOSLASKIE_MIASTO_WROCLAW = "dolnośląskie|miasto|Wrocław",
}
export enum Gmina {
  PODKARPACKIE_RZESZOWSKI_TRZEBOWNISKO_WIEJSKA = "1816132",
  DOLNOSLASKIE_WROCLAW_WROCLAW_MIEJSKA = "0264011",
}
`;

function snapshot() {
  return {
    state: {
      version: 1,
      revision: 3,
      objects: [
        {
          id: "OP_1",
          importKey: "OP_1",
          type: "operator",
          label: "RARR",
          createdAt: "2026-01-01T08:00:00.000Z",
          updatedAt: "2026-09-20T10:15:00.000Z",
          values: {
            name: "RARR",
            role: "OPERATOR",
            nip: "1234567890",
            address: "ul. Testowa 1, Rzeszów",
            email: "kontakt@rarr.example",
            phone: "+48 17 123 45 67",
            website: "https://rarr.example",
            notes: "Operator testowy",
            last_checked_at: "2026-09-20T10:15:00.000Z",
          },
        },
        {
          id: "PR_1",
          importKey: "PR_1",
          type: "project",
          label: "Projekt",
          createdAt: "2026-01-02T08:00:00.000Z",
          updatedAt: "2026-09-20T11:00:00.000Z",
          values: {
            name: "Projekt",
            operator_id: "OP_1",
            type: "B2B",
            status: "AKTYWNY",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            announcements_site_url: "https://rarr.example/nabory",
            project_url: "https://rarr.example/projekt",
            number: "FEPK.01.01-TEST",
            last_checked_at: "2026-09-20T11:00:00.000Z",
          },
        },
        {
          id: "NAB_1",
          importKey: "NAB_1",
          type: "recruitment",
          label: "Nabór 1",
          createdAt: "2026-09-01T09:00:00.000Z",
          updatedAt: "2026-09-21T14:22:33.000Z",
          values: {
            external_number: "Nabór 1",
            source_number: "1",
            sequence_number: 1,
            year: 2026,
            continuous: false,
            project_id: "PR_1",
            operator_id: "OP_1",
            status: "PLANOWANY",
            planned_start_low_date: "2026-06-22",
            planned_start_ceil_date: "2026-06-23",
            planned_start_time: "08:30",
            planned_end_low_date: "2026-06-25",
            planned_end_ceil_date: "2026-06-27",
            planned_end_time: "16:30",
            planned_start_low_year: 2026,
            planned_start_ceil_year: 2026,
            planned_start_low_month: 6,
            planned_start_ceil_month: 6,
            planned_start_low_week: 4,
            planned_start_ceil_week: 4,
            planned_start_low_quarter: 2,
            planned_start_ceil_quarter: 2,
            planned_end_low_year: 2026,
            planned_end_ceil_year: 2026,
            planned_end_low_month: 6,
            planned_end_ceil_month: 6,
            planned_end_low_week: 4,
            planned_end_ceil_week: 4,
            planned_end_low_quarter: 2,
            planned_end_ceil_quarter: 2,
            urlOgloszenia: "https://rarr.example/nabor",
            data_source_url: "https://rarr.example/nabor",
            direct_recruitment_link: true,
            action_code: "FEPK.07.09",
            eligible_entities: "NGO prowadzące działalność na obszarze projektu.",
            funding_conditions: "Wsparcie do 80% kosztów kwalifikowanych.",
            application_instructions: "Złóż formularz elektronicznie i podpisz w systemie.",
            funding_verified_at: "2026-09-21",
            statusZakonczenia: "ZAKONCZONY",
            powodStatusu: "Koniec terminu",
            last_checked_at: "2026-09-21T14:22:33.000Z",
          },
        },
      ],
      rules: [],
      operatorAssignments: [
        {
          id: "PA_1",
          objectId: "PR_1",
          operatorId: "OP_1",
          operatorType: "GLOWNY",
        },
        {
          id: "RA_1",
          objectId: "NAB_1",
          operatorId: "OP_1",
          operatorType: "GLOWNY",
        },
      ],
      geographies: [
        {
          id: "GPR_1",
          objectId: "PR_1",
          operatorId: "OP_1",
          type: "WOJEWODZTWO",
          role: "OBEJMUJE",
          value: "podkarpackie",
        },
        {
          id: "GNAB_1",
          objectId: "NAB_1",
          type: "GMINA",
          role: "OBEJMUJE",
          value: "1816132",
          operatorId: "OP_1",
        },
        {
          id: "GNAB_2",
          objectId: "NAB_1",
          type: "GMINA",
          role: "WYKLUCZA",
          value: "0264011",
          operatorId: "OP_1",
        },
      ],
      operatorContacts: [
        {
          id: "C1",
          objectId: "OP_1",
          kind: "EMAIL",
          variant_no: 1,
          value: "pierwszy@rarr.example",
        },
        {
          id: "C2",
          objectId: "OP_1",
          kind: "EMAIL",
          variant_no: 2,
          value: "drugi@rarr.example",
        },
        {
          id: "C3",
          objectId: "OP_1",
          kind: "PHONE",
          variant_no: 1,
          value: "+48 17 123 45 67",
        },
        {
          id: "C4",
          objectId: "OP_1",
          kind: "PHONE",
          variant_no: 2,
          value: "+48 600 700 800",
        },
      ],
      financingRules: [
        {
          id: "F1",
          importKey: "micro-default",
          objectId: "NAB_1",
          company_size: "MICRO",
          variant_no: 1,
          refund_percent_base: 50,
          refund_percent_standard: 80,
          refund_percent_min: 50,
          refund_percent_max: 80,
          max_amount_pln: 10000,
          max_per_person_pln: 5000,
          own_contribution_form: "CASH",
          notes: "Wariant podstawowy",
        },
        {
          id: "F2",
          importKey: "ngo-default",
          objectId: "NAB_1",
          company_size: "NGO",
          variant_no: 1,
          refund_percent_max: 85,
          notes: "Wariant NGO",
        },
      ],
      documentRequirements: [
        {
          id: "D1",
          objectId: "NAB_1",
          document_type_key: "msp_application_form",
          requirement: "REQUIRED",
          auto_fill: true,
          notes: "Wymagany przy zgłoszeniu",
        },
      ],
      fileSources: [
        {
          id: "FILE_1",
          objectId: "NAB_1",
          fileType: "PDF",
          name: "Regulamin.pdf",
          url: "https://rarr.example/regulamin.pdf",
          sourcePageUrl: "https://rarr.example/nabor",
          addedAt: "2026-09-21T13:00:00.000Z",
        },
      ],
    },
    projectOperators: [
      {
        project_object_id: "PR_1",
        operator_object_id: "OP_1",
        operator_type: "GLOWNY",
      },
    ],
  };
}

test("BUR Excel export keeps complete business data and relations", () => {
  const sheets = buildBurSheets(snapshot(), geographySource);
  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    [
      "Operatorzy",
      "Projekty",
      "Nabory",
      "Finansowanie",
      "Dokumenty",
      "Pliki",
      "Pola_Obiektow",
      "Projekty_Operatorzy",
      "Nabory_Operatorzy",
      "Geografia_Slownik",
      "Geografia_Projekty",
      "Geografia_Nabory",
    ],
  );

  const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const asObjects = (name) => {
    const sheet = byName.get(name);
    assert.ok(sheet, `missing sheet ${name}`);
    return sheet.rows.map((values) =>
      Object.fromEntries(sheet.headers.map((header, index) => [header, values[index]])),
    );
  };

  const operator = asObjects("Operatorzy")[0];
  assert.equal(operator.operator_id, "OP_1");
  assert.equal(operator.email, "kontakt@rarr.example");
  assert.equal(operator.telefon, "+48 17 123 45 67");
  assert.equal(operator.adres, "ul. Testowa 1, Rzeszów");
  assert.equal(operator.ostatnia_zmiana, "2026-09-20T10:15:00.000Z");

  const project = asObjects("Projekty")[0];
  assert.equal(project.operator_id, "OP_1");
  assert.equal(project.numer_projektu, "FEPK.01.01-TEST");
  assert.equal(project.strona_projektu, "https://rarr.example/projekt");

  const projectGeography = asObjects("Geografia_Projekty")[0];
  assert.equal(projectGeography.projekt_id, "PR_1");
  assert.equal(projectGeography.operator_id, "OP_1");

  const recruitmentSheet = byName.get("Nabory");
  assert.equal(
    recruitmentSheet.headers.at(-1),
    "ostatnia_zmiana",
    "recruitment last column must be object change time",
  );
  const recruitment = asObjects("Nabory")[0];
  assert.equal(recruitment.nabor_id, "NAB_1");
  assert.equal(recruitment.operator_id, "OP_1");
  assert.equal(recruitment.projekt_id, "PR_1");
  assert.equal(recruitment.mikro_procent, 80);
  assert.equal(recruitment.mikro_procent_bazowy, 50);
  assert.equal(
    recruitment.kwalifikujace_sie_podmioty,
    "NGO prowadzące działalność na obszarze projektu.",
  );
  assert.equal(
    recruitment.warunki_pomocy_i_dofinansowania,
    "Wsparcie do 80% kosztów kwalifikowanych.",
  );
  assert.equal(
    recruitment.instrukcja_skladania_wniosku,
    "Złóż formularz elektronicznie i podpisz w systemie.",
  );
  assert.equal(recruitment.numer_kolejny, 1);
  assert.equal(recruitment.rok, 2026);
  assert.equal(recruitment.nabor_ciagly, "nie");
  assert.ok(recruitment.nabor_od);
  assert.ok(recruitment.nabor_do);
  assert.equal(recruitment.planowana_godzina_rozpoczecia, "08:30");
  assert.equal(recruitment.planowana_godzina_zakonczenia, "16:30");
  assert.equal(recruitment.planowany_start_godzina_od, "08:30");
  assert.equal(recruitment.planowany_start_godzina_do, "08:30");
  assert.equal(recruitment.planowany_koniec_godzina_od, "16:30");
  assert.equal(recruitment.planowany_koniec_godzina_do, "16:30");
  assert.equal(recruitment.planowany_start_rok_od, 2026);
  assert.equal(recruitment.planowany_start_rok_do, 2026);
  assert.equal(recruitment.planowany_start_miesiac_od, 6);
  assert.equal(recruitment.planowany_start_miesiac_do, 6);
  assert.equal(recruitment.planowany_start_tydzien_od, 4);
  assert.equal(recruitment.planowany_start_tydzien_do, 4);
  assert.equal(recruitment.planowany_koniec_tydzien_od, 4);
  assert.equal(recruitment.planowany_koniec_tydzien_do, 4);
  assert.equal(recruitment.status_zakonczenia, "ZAKONCZONY");
  assert.equal(recruitment.ostatnia_zmiana, "2026-09-21T14:22:33.000Z");

  const fundingRows = asObjects("Finansowanie");
  const funding = fundingRows.find((row) => row.finansowanie_id === "micro-default");
  const ngoFunding = fundingRows.find((row) => row.finansowanie_id === "ngo-default");
  assert.equal(funding.obiekt_id, "NAB_1");
  assert.equal(funding.refund_percent_max, 80);
  assert.equal(funding.max_per_person_pln, 5000);
  assert.equal(funding.own_contribution_form, "CASH");
  assert.equal(ngoFunding.wielkosc_firmy, "NGO");
  assert.equal(ngoFunding.refund_percent_max, 85);

  const document = asObjects("Dokumenty")[0];
  assert.equal(document.obiekt_id, "NAB_1");
  assert.equal(document.document_type_key, "msp_application_form");
  assert.equal(document.nazwa_dokumentu, "Formularz zgłoszeniowy MSP (Zał. 1)");
  assert.equal(document.requirement, "REQUIRED");
  assert.equal(document.auto_fill, true);

  const file = asObjects("Pliki")[0];
  assert.equal(file.obiekt_id, "NAB_1");
  assert.equal(file.nazwa_pliku, "Regulamin.pdf");
  assert.equal(file.url, "https://rarr.example/regulamin.pdf");

  const rawFields = asObjects("Pola_Obiektow");
  assert.ok(
    rawFields.some(
      (entry) =>
        entry.obiekt_id === "OP_1" &&
        entry.pole === "email" &&
        entry.wartosc === "kontakt@rarr.example",
    ),
  );
  assert.ok(
    rawFields.some(
      (entry) =>
        entry.obiekt_id === "NAB_1" &&
        entry.pole === "planned_start_ceil_date" &&
        entry.wartosc === "2026-06-23",
    ),
  );

  const projectRelations = asObjects("Projekty_Operatorzy");
  assert.equal(projectRelations[0].projekt_id, "PR_1");
  assert.equal(projectRelations[0].operator_id, "OP_1");

  const recruitmentRelations = asObjects("Nabory_Operatorzy");
  assert.equal(recruitmentRelations[0].nabor_id, "NAB_1");
  assert.equal(recruitmentRelations[0].operator_id, "OP_1");

  const recruitmentGeography = asObjects("Geografia_Nabory");
  assert.equal(recruitmentGeography[0].nabor_id, "NAB_1");
  assert.equal(recruitmentGeography[0].operator_id, "OP_1");
  assert.equal(recruitmentGeography[0].typ, "include");
  assert.equal(recruitmentGeography[1].operator_id, "OP_1");
  assert.equal(recruitmentGeography[1].typ, "exclude");

  const dictionary = asObjects("Geografia_Slownik");
  const wroclaw = dictionary.find((item) => item.nazwa === "m. Wrocław");
  const cityGmina = dictionary.find(
    (item) => item.poziom === "4" && item.parent_geo_id === wroclaw?.geo_id,
  );
  assert.equal(wroclaw?.geo_typ, "powiat");
  assert.ok(cityGmina);
  assert.equal(cityGmina.parent_geo_id, wroclaw?.geo_id);
});

test("XLSX builder returns a ZIP-based workbook payload", () => {
  const workbook = buildXlsxWorkbook(
    buildBurSheets(snapshot(), geographySource),
  );
  assert.equal(workbook.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(workbook.length > 1000);
});
