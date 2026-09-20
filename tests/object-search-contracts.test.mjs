import assert from "node:assert/strict";
import test from "node:test";

import {
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
  return createObjectSearchDocument(object, name, labels[type]);
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

test("invalid regex is reported instead of throwing during rendering", () => {
  const compiled = compileObjectSearch("/[abc/");
  assert.match(compiled.error ?? "", /regular expression|unterminated|invalid/i);
  assert.equal(compiled.matches(project), false);
});
