import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBurSheets,
  SHEET_HEADERS,
} from "../scripts/db/bur-excel-export.mjs";
import { buildXlsxWorkbook } from "../scripts/db/xlsx.mjs";

const geographySource = `
export enum Wojewodztwo { PODKARPACKIE = "podkarpackie", }
export enum Powiat { PODKARPACKIE_RZESZOWSKI = "podkarpackie|powiat|rzeszowski", }
export enum Gmina { PODKARPACKIE_RZESZOWSKI_TRZEBOWNISKO_WIEJSKA = "1816132", }
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
            nip: "1234567890",
            website: "https://rarr.example",
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
            status: "AKTYWNY",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            announcements_site_url: "https://rarr.example/nabory",
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
  assert.equal(sheets[1].rows[0][8], "OP_1");
  assert.equal(sheets[2].rows[0][0], "NAB_1");
  assert.equal(sheets[2].rows[0][2], "OP_1");
  assert.equal(sheets[2].rows[0][3], "PR_1");
  assert.equal(sheets[2].rows[0][10], 80);
  assert.equal(sheets[2].rows[0][23], 50);
  assert.equal(sheets[5].rows[0][1], "PR_1");
  assert.equal(sheets[6].rows[0][1], "NAB_1");
  assert.equal(sheets[6].rows[0][3], "include");
});

test("XLSX builder returns a ZIP-based workbook payload", () => {
  const workbook = buildXlsxWorkbook(
    buildBurSheets(snapshot(), geographySource),
  );
  assert.equal(workbook.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(workbook.length > 1000);
});
