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
          values: {
            name: "RARR",
            role: "OPERATOR",
            nip: "1234567890",
            address: "ul. Testowa 1, Rzeszów",
            website: "https://rarr.example",
            notes: "Operator testowy",
          },
        },
        {
          id: "PR_1",
          importKey: "PR_1",
          type: "project",
          label: "Projekt",
          values: {
            name: "Projekt",
            operator_id: "OP_1",
            type: "B2B",
            status: "OGLOSZONY",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            announcements_site_url: "https://rarr.example/nabory",
            documents_url: "https://rarr.example/dokumenty",
            documents_link_direct: true,
            notes: "Uwagi projektu",
            schedule_note: "Uwaga do harmonogramu",
            technical_notes: "Uwagi techniczne",
          },
        },
        {
          id: "NAB_1",
          importKey: "NAB_1",
          type: "recruitment",
          label: "Nabór 1",
          values: {
            external_number: "Nabór 1",
            source_number: "1",
            project_id: "PR_1",
            operator_id: "OP_1",
            status: "AKTYWNY",
            dataRozpoczeciaOd: "2026-09-01",
            dataZakonczeniaDo: "2026-09-30",
            urlOgloszenia: "https://rarr.example/nabor",
            data_source_url: "https://rarr.example/nabor",
            direct_recruitment_link: true,
            action_code: "FEPK.07.09",
            funding_verified_at: "2026-09-21",
          },
        },
      ],
      rules: [],
      geographies: [
        {
          id: "GPR_1",
          objectId: "PR_1",
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
        },
        {
          id: "GNAB_2",
          objectId: "NAB_1",
          type: "GMINA",
          role: "WYKLUCZA",
          value: "0264011",
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
          objectId: "NAB_1",
          company_size: "MICRO",
          variant_no: 1,
          refund_percent_base: 50,
          refund_percent_standard: 80,
          max_amount_pln: 10000,
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

test("BUR Excel export keeps workbook sheet contract and relations", () => {
  const sheets = buildBurSheets(snapshot(), geographySource);
  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    [
      "Operatorzy",
      "Projekty",
      "Nabory",
      "Projekty_Operatorzy",
      "Geografia_Slownik",
      "Geografia_Projekty",
      "Geografia_Nabory",
    ],
  );
  assert.deepEqual(sheets[0].headers, SHEET_HEADERS.Operatorzy);
  assert.equal(sheets[0].rows[0][0], "OP_1");
  assert.equal(sheets[0].rows[0][2], "operator");
  assert.equal(sheets[0].rows[0][4], "ul. Testowa 1, Rzeszów");
  assert.equal(
    sheets[0].rows[0][5],
    "pierwszy@rarr.example; drugi@rarr.example",
  );
  assert.equal(
    sheets[0].rows[0][6],
    "+48 17 123 45 67; +48 600 700 800",
  );
  assert.equal(sheets[1].rows[0][8], "OP_1");
  assert.equal(sheets[1].rows[0][7], "https://rarr.example/dokumenty");
  assert.equal(sheets[1].rows[0][9], "Uwagi projektu");
  assert.equal(sheets[1].rows[0][10], "tak");
  assert.equal(sheets[1].rows[0][12], "Uwaga do harmonogramu");
  assert.equal(sheets[1].rows[0][14], "Uwagi techniczne");
  assert.equal(sheets[2].rows[0][0], "NAB_1");
  assert.equal(sheets[2].rows[0][2], "OP_1");
  assert.equal(sheets[2].rows[0][3], "PR_1");
  assert.equal(sheets[2].rows[0][7], "ogłoszony");
  assert.equal(sheets[2].rows[0][10], 80);
  assert.equal(sheets[2].rows[0][23], 50);
  assert.equal(sheets[5].rows[0][1], "PR_1");
  assert.equal(sheets[6].rows[0][1], "NAB_1");
  assert.equal(sheets[6].rows[0][3], "include");
  assert.equal(sheets[6].rows[1][3], "exclude");

  const dictionary = sheets[4].rows.map((values) =>
    Object.fromEntries(SHEET_HEADERS.Geografia_Slownik.map((header, i) => [header, values[i]])),
  );
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
