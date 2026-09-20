import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeographySearchIndex,
  compileObjectSearch,
  createObjectSearchDocument,
} from "../src/shared/search/objectSearch.js";

function document({
  id,
  type,
  name,
  number = "",
  nip = "",
  status = "",
  geography = {},
}) {
  const object = {
    id,
    type,
    values: {
      name,
      number: type === "project" ? number : undefined,
      external_number: type === "recruitment" ? number : undefined,
      nip: type === "operator" ? nip : undefined,
      status,
    },
  };
  const labels = {
    project: "Projekt",
    operator: "Operator",
    recruitment: "Nabór",
  };
  return createObjectSearchDocument(object, name, labels[type], geography);
}

const project = document({
  id: "PRJ_SILESIA",
  type: "project",
  name: "Zielony Śląsk – szkolenia i studia podyplomowe",
  number: "FESL.10.17",
  status: "AKTYWNY",
});

const operator = document({
  id: "OP_WUP",
  type: "operator",
  name: "Wojewódzki Urząd Pracy w Katowicach",
  nip: "6342294455",
});

const recruitment = document({
  id: "REC_2026_01",
  type: "recruitment",
  name: "Nabór kompetencje cyfrowe 2026",
  number: "1/2026",
  status: "PLANOWANY",
});

const geographyProject = document({
  id: "PRJ_GEO_ONLY",
  type: "project",
  name: "Akademia kompetencji przedsiębiorców",
  number: "FEPK.07.09",
  status: "AKTYWNY",
  geography: {
    geo:
      "Podkarpackie Rzeszów rzeszowski podkarpackie|powiat|rzeszowski 1863011",
    wojewodztwo: "Podkarpackie podkarpackie",
    podregion: "Rzeszowski rzeszowski",
    powiat: "Rzeszowski podkarpackie|powiat|rzeszowski",
    gmina: "Trzebownisko rzeszowski podkarpackie 1816132",
    miasto: "Rzeszów podkarpackie|miasto|Rzeszów",
  },
});

function matches(query, candidate) {
  const compiled = compileObjectSearch(query);
  assert.equal(compiled.error, null, query);
  return compiled.matches(candidate);
}

test("plain search is case and diacritic insensitive", () => {
  assert.equal(matches("slask", project), true);
  assert.equal(matches("WOJEWODZKI", operator), true);
});

test("wildcards work anywhere in a term", () => {
  assert.equal(matches("zielony*studia", project), true);
  assert.equal(matches("number:FESL.*", project), true);
  assert.equal(matches("nip:6342??????", operator), true);
});

test("raw regex queries are supported", () => {
  assert.equal(matches("/zielony.*podyplomowe/i", project), true);
  assert.equal(matches("name:/kompetencje\\s+cyfrowe/i", recruitment), true);
  assert.equal(matches("number:/^1\\/2026$/", recruitment), true);
});

test("type filters support English and Polish aliases", () => {
  assert.equal(matches("type:project", project), true);
  assert.equal(matches("type:projekty", project), true);
  assert.equal(matches("type:operatorzy", operator), true);
  assert.equal(matches("type:nabory", recruitment), true);
  assert.equal(matches("type:nabory", project), false);
});

test("multiple terms use AND semantics and support field filters", () => {
  assert.equal(matches("type:projekty slask status:aktywny", project), true);
  assert.equal(matches("type:projekty slask status:planowany", project), false);
  assert.equal(matches('type:nabory name:"kompetencje cyfrowe"', recruitment), true);
});

test("negative terms exclude matching objects", () => {
  assert.equal(matches("slask -status:zakończony", project), true);
  assert.equal(matches("slask -status:aktywny", project), false);
  assert.equal(matches("-type:operator", project), true);
  assert.equal(matches("-type:operator", operator), false);
});

test("woj filter is inferred from city and powiat geography rows", () => {
  const catalog = [
    {
      type: "MIASTO_NA_PRAWACH_POWIATU",
      value: "śląskie|miasto|Bytom",
      label: "Bytom",
      context: "śląskie",
      search: "SLASKIE_BYTOM śląskie|miasto|Bytom Bytom śląskie",
    },
    {
      type: "MIASTO_NA_PRAWACH_POWIATU",
      value: "śląskie|miasto|Katowice",
      label: "Katowice",
      context: "śląskie",
      search: "SLASKIE_KATOWICE śląskie|miasto|Katowice Katowice śląskie",
    },
    {
      type: "POWIAT",
      value: "śląskie|powiat|będziński",
      label: "będziński",
      context: "śląskie",
      search: "SLASKIE_BEDZINSKI śląskie|powiat|będziński będziński śląskie",
    },
  ];
  const rows = [
    {
      objectId: "PR_SLA_001",
      type: "MIASTO_NA_PRAWACH_POWIATU",
      value: "śląskie|miasto|Bytom",
    },
    {
      objectId: "PR_SLA_001",
      type: "MIASTO_NA_PRAWACH_POWIATU",
      value: "śląskie|miasto|Katowice",
    },
    {
      objectId: "PR_SLA_001",
      type: "POWIAT",
      value: "śląskie|powiat|będziński",
    },
  ];

  const geography = buildGeographySearchIndex(rows, catalog).get("PR_SLA_001");
  assert.ok(geography);
  assert.match(geography.wojewodztwo, /śląskie/i);

  const candidate = document({
    id: "PR_SLA_001",
    type: "project",
    name: "Pełny rozwój",
    status: "AKTYWNY",
    geography,
  });
  assert.equal(
    matches(
      "type:projekty woj:śląskie geo:/Bytom|Chorzów|Dąbrowa Górnicza|Gliwice|Katowice/i",
      candidate,
    ),
    true,
  );
});

test("geography participates in plain, field, wildcard and regex search", () => {
  assert.equal(matches("podkarpackie", geographyProject), true);
  assert.equal(matches("geo:rzeszow", geographyProject), true);
  assert.equal(matches("woj:podkarpackie", geographyProject), true);
  assert.equal(matches("powiat:rzesz*", geographyProject), true);
  assert.equal(matches("gmina:trzebow?isko", geographyProject), true);
  assert.equal(matches("miasto:/rzesz[oó]w/i", geographyProject), true);
  assert.equal(
    matches("type:projekty woj:podkarpackie -gmina:krakow", geographyProject),
    true,
  );
  assert.equal(matches("woj:slaskie", geographyProject), false);
});

test("invalid regex is reported instead of throwing during rendering", () => {
  const compiled = compileObjectSearch("/[abc/");
  assert.match(compiled.error ?? "", /regular expression|unterminated|invalid/i);
  assert.equal(compiled.matches(project), false);
});
