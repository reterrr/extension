import { readFileSync } from "node:fs";
import "../../src/shared/domain/schema.js";
import { buildXlsxWorkbook, excelDate } from "./xlsx.mjs";

const FUNDING_FIELD_KEYS = Object.freeze(
  Object.keys(globalThis.BurbotFunding?.fields ?? {}),
);
const DOCUMENT_FIELD_KEYS = Object.freeze(
  Object.keys(globalThis.BurbotDocuments?.fields ?? {}),
);
const DOCUMENT_CATALOG = new Map(
  (globalThis.BurbotDocuments?.catalog ?? []).map((entry) => [entry.key, entry]),
);

export const SHEET_HEADERS = Object.freeze({
  Operatorzy: [
    "operator_id", "nazwa_operatora", "rola", "NIP", "adres", "email",
    "telefon", "strona_www", "uwagi", "operatorzy_glowni_dodatkowi",
    "ostatnio_sprawdzono", "utworzono", "ostatnia_zmiana",
  ],
  Projekty: [
    "projekt_id", "nazwa_projektu", "typ_odbiorcy", "data_start", "data_koniec",
    "status_projektu", "link_do_harmonogramu", "link_do_dokumentow", "operator_id",
    "uwagi", "link_prowadzi_do_dokumentow", "Link do harmonogramu / naborów",
    "Uwaga", "operatorzy_dodatkowi", "uwagi_techniczne", "numer_projektu",
    "ostatnio_sprawdzono", "utworzono", "ostatnia_zmiana",
  ],
  Nabory: [
    "nabor_id", "nabor_nr", "operator_id", "projekt_id", "nabor_nazwa",
    "nabor_od", "nabor_do", "status", "link_nabor", "link_dokumenty",
    "mikro_procent", "mikro_max_na_firme", "mikro_max_na_uczestnika",
    "mala_procent", "mala_max_na_firme", "mala_max_na_uczestnika",
    "srednia_procent", "srednia_max_na_firme", "srednia_max_na_uczestnika",
    "kod_dzialania", "zrodlo_danych", "uwaga",
    "link_prowadzi_do_konkretnego_naboru", "mikro_procent_bazowy",
    "mala_procent_bazowy", "srednia_procent_bazowy", "zasady_dofinansowania",
    "data_weryfikacji_finansow", "zrodlo_weryfikacji_finansow",
    "b2c_procent_bazowy", "b2c_procent_max", "b2c_wklad_wlasny_standard",
    "b2c_wklad_wlasny_min", "b2c_max_wartosc_uslug",
    "b2c_max_refundacja_standard", "b2c_max_refundacja_max", "wojewodztwo",
    "lista_powiatow", "nazwa_operatora", "nazwa_projektu",
    "numer_kolejny", "rok", "nabor_ciagly", "status_systemowy",
    "data_rozpoczecia_od", "data_rozpoczecia_do",
    "data_zakonczenia_od", "data_zakonczenia_do",
    "planowana_data_rozpoczecia", "planowana_data_zakonczenia",
    "planowany_start_rok", "planowany_start_miesiac", "planowany_start_kwartal",
    "planowany_koniec_rok", "planowany_koniec_miesiac", "planowany_koniec_kwartal",
    "status_zakonczenia", "powod_statusu", "ostatnio_sprawdzono", "utworzono",
    "ostatnia_zmiana",
  ],
  Finansowanie: [
    "finansowanie_id", "obiekt_id", "typ_obiektu", "nazwa_obiektu",
    "wielkosc_firmy", "wariant_nr", ...FUNDING_FIELD_KEYS,
    "ostatnia_zmiana_obiektu",
  ],
  Dokumenty: [
    "dokument_id", "obiekt_id", "typ_obiektu", "nazwa_obiektu",
    "document_type_key", "nazwa_dokumentu", "wewnetrzny",
    ...DOCUMENT_FIELD_KEYS, "ostatnia_zmiana_obiektu",
  ],
  Pliki: [
    "source_id", "obiekt_id", "typ_obiektu", "nazwa_obiektu", "file_type",
    "nazwa_pliku", "url", "source_page_url", "added_at",
    "ostatnia_zmiana_obiektu",
  ],
  Pola_Obiektow: [
    "obiekt_id", "typ_obiektu", "nazwa_obiektu", "pole", "wartosc",
    "utworzono", "ostatnia_zmiana",
  ],
  Projekty_Operatorzy: ["id", "projekt_id", "operator_id", "typ"],
  Geografia_Slownik: ["geo_id", "parent_geo_id", "poziom", "geo_typ", "nazwa", "canonical_geo_id"],
  Geografia_Projekty: ["geo_projekt_id", "projekt_id", "geo_id"],
  Geografia_Nabory: ["id", "nabor_id", "miejscowosc_id", "typ"],
});

const PROJECT_STATUS = { PLANOWANY: "planowany", AKTYWNY: "aktywny", ZAWIESZONY: "zawieszony", ZAKONCZONY: "zakończony" };
const RECRUITMENT_STATUS = {
  OGLOSZONY: "ogłoszony",
  PLANOWANY: "planowany",
  AKTYWNY: "aktywny",
  ZAWIESZONY: "zawieszony",
  ZAMKNIETY: "zamknięty",
  ZAKONCZONY: "zamknięty",
  ANULOWANY: "anulowany",
};
const PODREGION_WOJ = new Map([
  ...["jeleniogórski", "legnicko-głogowski", "wałbrzyski", "wrocławski", "miasto Wrocław"].map((x) => [x, "dolnośląskie"]),
  ...["bydgosko-toruński", "grudziądzki", "inowrocławski", "świecki", "włocławski"].map((x) => [x, "kujawsko-pomorskie"]),
  ...["bialski", "chełmsko-zamojski", "lubelski", "puławski"].map((x) => [x, "lubelskie"]),
  ...["gorzowski", "zielonogórski"].map((x) => [x, "lubuskie"]),
  ...["łódzki", "miasto Łódź", "piotrkowski", "sieradzki", "skierniewicki"].map((x) => [x, "łódzkie"]),
  ...["krakowski", "miasto Kraków", "nowosądecki", "nowotarski", "oświęcimski", "tarnowski"].map((x) => [x, "małopolskie"]),
  ...["ciechanowski", "ostrołęcki", "radomski", "płocki", "siedlecki", "żyrardowski", "miasto Warszawa", "warszawski wschodni", "warszawski zachodni"].map((x) => [x, "mazowieckie"]),
  ...["nyski", "opolski"].map((x) => [x, "opolskie"]),
  ...["krośnieński", "przemyski", "rzeszowski", "tarnobrzeski"].map((x) => [x, "podkarpackie"]),
  ...["białostocki", "łomżyński", "suwalski"].map((x) => [x, "podlaskie"]),
  ...["chojnicki", "gdański", "starogardzki", "słupski", "trójmiejski"].map((x) => [x, "pomorskie"]),
  ...["bielski", "bytomski", "częstochowski", "gliwicki", "katowicki", "rybnicki", "sosnowiecki", "tyski"].map((x) => [x, "śląskie"]),
  ...["kielecki", "sandomiersko-jędrzejowski"].map((x) => [x, "świętokrzyskie"]),
  ...["elbląski", "ełcki", "olsztyński"].map((x) => [x, "warmińsko-mazurskie"]),
  ...["kaliski", "koniński", "leszczyński", "pilski", "poznański", "miasto Poznań"].map((x) => [x, "wielkopolskie"]),
  ...["koszaliński", "miasto Szczecin", "szczecinecko-pyrzycki", "szczeciński"].map((x) => [x, "zachodniopomorskie"]),
]);

function parseEnum(source, enumName) {
  const match = source.match(new RegExp(`export\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) return new Map();
  return new Map([...match[1].matchAll(/\s*([A-Z0-9_]+)\s*=\s*"([^"]+)"\s*,?/g)].map((m) => [m[1], m[2]]));
}

function catalogFrom(source) {
  const powiat = parseEnum(source, "Powiat");
  const cities = parseEnum(source, "MiastoNaPrawachPowiatu");
  const gmina = parseEnum(source, "Gmina");
  const parentPrefixes = [
    ...[...powiat].map(([key, value]) => ({
      key,
      value,
      type: "POWIAT",
    })),
    ...[...cities].map(([key, value]) => ({
      key: key.replace("_MIASTO_", "_"),
      value,
      type: "MIASTO_NA_PRAWACH_POWIATU",
    })),
  ].sort((a, b) => b.key.length - a.key.length);
  return {
    parentPrefixes,
    gminaByValue: new Map([...gmina].map(([key, value]) => [value, key])),
  };
}

const keyOf = (object) => String(object?.importKey || object?.id || "");
const row = (headers, values) => headers.map((header) => values[header] ?? null);
const dateCell = (value) => value ? excelDate(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : null;
const yesNo = (value) => value === null || value === undefined ? null : value ? "tak" : "nie";
const titleCase = (value) => String(value).toLocaleLowerCase("pl-PL").replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("pl-PL"));

const excelScalar = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
};

const objectName = (object) =>
  object?.values?.name ??
  object?.values?.external_number ??
  object?.values?.title ??
  object?.label ??
  keyOf(object);

function fundingFor(state, objectId, size) {
  return (state.financingRules ?? [])
    .filter((item) => String(item.objectId) === String(objectId) && String(item.company_size) === size)
    .sort((a, b) => Number(a.variant_no ?? 1) - Number(b.variant_no ?? 1))[0] ?? {};
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function slug(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 42) || "GEO";
}

function geoId(type, value) {
  const prefix = { POLSKA: "PL", WOJEWODZTWO: "WOJ", PODREGION: "POD", POWIAT: "POW", GMINA: "GMI", MIASTO_NA_PRAWACH_POWIATU: "MNP" }[type] ?? "GEO";
  return `GEO_${prefix}_${slug(value)}_${fnv1a(`${type}:${value}`)}`;
}

function gminaMeta(value, catalog) {
  const key = catalog.gminaByValue.get(String(value));
  if (!key) return null;
  const base = key.replace(/_MIEJSKO_WIEJSKA$/, "").replace(/_MIEJSKA$/, "").replace(/_WIEJSKA$/, "");
  const parent = catalog.parentPrefixes.find(({ key: prefix }) =>
    base.startsWith(`${prefix}_`),
  );
  if (!parent) return null;
  const locality = base.slice(parent.key.length + 1).replaceAll("_", " ");
  return {
    parentType: parent.type,
    parentValue: parent.value,
    name: `${key.endsWith("_MIEJSKA") ? "m. " : ""}${titleCase(locality)}`,
  };
}

function geoMeta(type, value, catalog) {
  const text = String(value ?? "");
  if (type === "POLSKA") return { name: "Polska", level: 0 };
  if (type === "WOJEWODZTWO") return { name: titleCase(text), level: 1, woj: text };
  if (type === "PODREGION") {
    const woj = PODREGION_WOJ.get(text) ?? null;
    return { name: text, level: 2, woj, parentType: woj ? "WOJEWODZTWO" : null, parentValue: woj };
  }
  if (type === "POWIAT" || type === "MIASTO_NA_PRAWACH_POWIATU") {
    const parts = text.split("|");
    const woj = parts[0] || null;
    const name = parts.at(-1) || text;
    const city = type === "MIASTO_NA_PRAWACH_POWIATU";
    return { name: city ? `m. ${titleCase(name)}` : titleCase(name), level: 3, woj, powiat: city ? `m. ${titleCase(name)}` : titleCase(name), parentType: woj ? "WOJEWODZTWO" : null, parentValue: woj };
  }
  if (type === "GMINA") {
    const gmina = gminaMeta(text, catalog);
    const woj = gmina?.parentValue?.split("|")[0] ?? null;
    return {
      name: gmina?.name ?? text,
      level: 4,
      woj,
      powiat: gmina?.parentValue?.split("|").at(-1) ?? null,
      parentType: gmina?.parentType ?? null,
      parentValue: gmina?.parentValue ?? null,
    };
  }
  return { name: text, level: 9 };
}

const geoType = (type) => ({ POLSKA: "polska", WOJEWODZTWO: "wojewodztwo", PODREGION: "podregion", POWIAT: "powiat", GMINA: "gmina", MIASTO_NA_PRAWACH_POWIATU: "powiat" }[type] ?? String(type).toLocaleLowerCase("pl-PL"));

export function readBurSnapshot(db) {
  const stored = db.prepare("SELECT state_json FROM workspace_state WHERE id = 1").get();
  const state = stored ? JSON.parse(String(stored.state_json)) : { version: 1, revision: 0, objects: [], rules: [], geographies: [], financingRules: [] };
  const projectOperators = db.prepare(`
    SELECT p.object_id AS project_object_id, o.object_id AS operator_object_id, po.operator_type
    FROM projects_operators po
    JOIN projects p ON p.id = po.project_id
    JOIN operators o ON o.id = po.operator_id
    ORDER BY po.id
  `).all();
  return { state, projectOperators };
}

export function buildBurSheets(snapshot, geographySource) {
  const { state } = snapshot;
  const objects = state.objects ?? [];
  const byId = new Map(objects.map((object) => [String(object.id), object]));
  const operators = objects.filter((object) => object.type === "operator");
  const projects = objects.filter((object) => object.type === "project");
  const recruitments = objects.filter((object) => object.type === "recruitment");
  const geographies = state.geographies ?? [];
  const catalog = catalogFrom(geographySource);

  const relations = [...(snapshot.projectOperators ?? [])];
  const relationKey = new Set(relations.map((item) => `${item.project_object_id}|${item.operator_object_id}|${item.operator_type}`));
  for (const project of projects) {
    const operatorId = project.values?.operator_id;
    if (!operatorId) continue;
    const signature = `${project.id}|${operatorId}|GLOWNY`;
    if (!relationKey.has(signature)) relations.push({ project_object_id: project.id, operator_object_id: operatorId, operator_type: "GLOWNY" });
  }

  const relationsByProject = new Map();
  const relationTypesByOperator = new Map();
  for (const relation of relations) {
    const projectId = String(relation.project_object_id);
    const operatorId = String(relation.operator_object_id);
    if (!relationsByProject.has(projectId)) relationsByProject.set(projectId, []);
    relationsByProject.get(projectId).push(relation);
    if (!relationTypesByOperator.has(operatorId)) relationTypesByOperator.set(operatorId, new Set());
    relationTypesByOperator.get(operatorId).add(String(relation.operator_type));
  }

  const contactsByObject = new Map();
  for (const contact of state.operatorContacts ?? []) {
    const objectId = String(contact.objectId);
    if (!contactsByObject.has(objectId)) contactsByObject.set(objectId, []);
    contactsByObject.get(objectId).push(contact);
  }

  const operatorRows = operators.map((object) => {
    const values = object.values ?? {};
    const types = relationTypesByOperator.get(String(object.id)) ?? new Set();
    const contacts = contactsByObject.get(String(object.id)) ?? [];
    const emails = contacts
      .filter((contact) => contact.kind === "EMAIL" && contact.value)
      .sort((a, b) => Number(a.variant_no) - Number(b.variant_no))
      .map((contact) => String(contact.value));
    const phones = contacts
      .filter((contact) => contact.kind === "PHONE" && contact.value)
      .sort((a, b) => Number(a.variant_no) - Number(b.variant_no))
      .map((contact) => String(contact.value));
    const role =
      values.role === "PARTNER"
        ? "partner"
        : values.role === "OPERATOR"
          ? "operator"
          : types.has("GLOWNY") || !types.size
            ? "operator"
            : "partner";
    return row(SHEET_HEADERS.Operatorzy, {
      operator_id: keyOf(object),
      nazwa_operatora: values.name ?? object.label,
      rola: role,
      NIP: values.nip,
      adres: values.address ?? values.adres,
      email: emails.length ? emails.join("; ") : values.email,
      telefon: phones.length
        ? phones.join("; ")
        : values.phone ?? values.telefon,
      strona_www: values.website ?? object.sourceUrl,
      uwagi: values.notes ?? object.creationNote,
      operatorzy_glowni_dodatkowi: types.has("DODATKOWY") ? "dodatkowy" : types.has("GLOWNY") ? "główny" : null,
      ostatnio_sprawdzono: values.last_checked_at,
      utworzono: object.createdAt,
      ostatnia_zmiana: object.updatedAt,
    });
  });

  const projectRows = projects.map((object) => {
    const values = object.values ?? {};
    const linked = relationsByProject.get(String(object.id)) ?? [];
    const main = linked.find((item) => String(item.operator_type) === "GLOWNY") ?? linked[0];
    const additional = linked.filter((item) => item !== main).map((item) => keyOf(byId.get(String(item.operator_object_id)))).filter(Boolean);
    const documents = values.documents_url ?? values.document_url;
    return row(SHEET_HEADERS.Projekty, {
      projekt_id: keyOf(object),
      nazwa_projektu: values.name ?? object.label,
      typ_odbiorcy: values.type,
      data_start: dateCell(values.start_date),
      data_koniec: dateCell(values.end_date),
      status_projektu: PROJECT_STATUS[values.status] ?? values.status,
      link_do_harmonogramu: values.announcements_site_url,
      link_do_dokumentow: documents ?? object.sourceUrl,
      operator_id: main ? keyOf(byId.get(String(main.operator_object_id))) : keyOf(byId.get(String(values.operator_id ?? ""))),
      uwagi: values.notes ?? object.creationNote,
      link_prowadzi_do_dokumentow: yesNo(values.documents_link_direct),
      "Link do harmonogramu / naborów": values.announcements_site_url,
      Uwaga: values.schedule_note,
      operatorzy_dodatkowi: additional.length ? additional.join("; ") : null,
      numer_projektu: values.number,
      ostatnio_sprawdzono: values.last_checked_at,
      utworzono: object.createdAt,
      ostatnia_zmiana: object.updatedAt,
    });
  });

  const geosByObject = new Map();
  for (const geo of geographies) {
    const id = String(geo.objectId);
    if (!geosByObject.has(id)) geosByObject.set(id, []);
    geosByObject.get(id).push(geo);
  }

  const recruitmentRows = recruitments.map((object) => {
    const values = object.values ?? {};
    const project = byId.get(String(values.project_id ?? ""));
    const operator = byId.get(String(values.operator_id ?? ""));
    const micro = fundingFor(state, object.id, "MICRO");
    const small = fundingFor(state, object.id, "SMALL");
    const medium = fundingFor(state, object.id, "MEDIUM");
    const b2c = fundingFor(state, object.id, "B2C");
    const included = (geosByObject.get(String(object.id)) ?? []).filter((geo) => geo.role !== "WYKLUCZA").map((geo) => geoMeta(String(geo.type), String(geo.value), catalog));
    const wojs = [...new Set(included.map((meta) => meta.woj).filter(Boolean).map(titleCase))];
    const powiats = [...new Set(included.map((meta) => meta.powiat).filter(Boolean).map(titleCase))];
    const planned = values.status === "PLANOWANY";
    const start = planned ? values.planned_start_date : (values.dataRozpoczeciaOd ?? values.dataRozpoczeciaDo);
    const end = planned ? values.planned_end_date : (values.dataZakonczeniaDo ?? values.dataZakonczeniaOd);
    return row(SHEET_HEADERS.Nabory, {
      nabor_id: keyOf(object), nabor_nr: values.source_number ?? values.sequence_number,
      operator_id: keyOf(operator), projekt_id: keyOf(project), nabor_nazwa: values.external_number ?? object.label,
      nabor_od: dateCell(start), nabor_do: dateCell(end), status: RECRUITMENT_STATUS[values.status] ?? values.status,
      link_nabor: values.urlOgloszenia, link_dokumenty: values.documents_url,
      mikro_procent: micro.refund_percent_standard, mikro_max_na_firme: micro.max_amount_pln, mikro_max_na_uczestnika: micro.max_per_person_pln,
      mala_procent: small.refund_percent_standard, mala_max_na_firme: small.max_amount_pln, mala_max_na_uczestnika: small.max_per_person_pln,
      srednia_procent: medium.refund_percent_standard, srednia_max_na_firme: medium.max_amount_pln, srednia_max_na_uczestnika: medium.max_per_person_pln,
      kod_dzialania: values.action_code, zrodlo_danych: values.data_source_url, uwaga: values.notes,
      link_prowadzi_do_konkretnego_naboru: yesNo(values.direct_recruitment_link),
      mikro_procent_bazowy: micro.refund_percent_base, mala_procent_bazowy: small.refund_percent_base, srednia_procent_bazowy: medium.refund_percent_base,
      zasady_dofinansowania: values.funding_rules, data_weryfikacji_finansow: dateCell(values.funding_verified_at), zrodlo_weryfikacji_finansow: values.funding_verification_url,
      b2c_procent_bazowy: b2c.refund_percent_base, b2c_procent_max: b2c.refund_percent_max,
      b2c_wklad_wlasny_standard: b2c.own_contribution_percent_standard, b2c_wklad_wlasny_min: b2c.own_contribution_percent_min,
      b2c_max_wartosc_uslug: b2c.max_service_value_pln, b2c_max_refundacja_standard: b2c.max_refund_standard_pln, b2c_max_refundacja_max: b2c.max_refund_max_pln,
      wojewodztwo: wojs.join(", "), lista_powiatow: powiats.join(", "),
      nazwa_operatora: operator?.values?.name ?? operator?.label, nazwa_projektu: project?.values?.name ?? project?.label,
      numer_kolejny: values.sequence_number,
      rok: values.year,
      nabor_ciagly: yesNo(values.continuous),
      status_systemowy: values.status,
      data_rozpoczecia_od: dateCell(values.dataRozpoczeciaOd),
      data_rozpoczecia_do: dateCell(values.dataRozpoczeciaDo),
      data_zakonczenia_od: dateCell(values.dataZakonczeniaOd),
      data_zakonczenia_do: dateCell(values.dataZakonczeniaDo),
      planowana_data_rozpoczecia: dateCell(values.planned_start_date),
      planowana_data_zakonczenia: dateCell(values.planned_end_date),
      planowany_start_rok: values.planowanyStartRok,
      planowany_start_miesiac: values.planowanyStartMiesiac,
      planowany_start_kwartal: values.planowanyStartKwartal,
      planowany_koniec_rok: values.planowanyKoniecRok,
      planowany_koniec_miesiac: values.planowanyKoniecMiesiac,
      planowany_koniec_kwartal: values.planowanyKoniecKwartal,
      status_zakonczenia: values.statusZakonczenia,
      powod_statusu: values.powodStatusu,
      ostatnio_sprawdzono: values.last_checked_at,
      utworzono: object.createdAt,
      ostatnia_zmiana: object.updatedAt,
    });
  });

  const financingRows = (state.financingRules ?? []).map((item, index) => {
    const object = byId.get(String(item.objectId ?? ""));
    const values = {
      finansowanie_id: item.importKey ?? item.id ?? `FIN_${String(index + 1).padStart(6, "0")}`,
      obiekt_id: keyOf(object),
      typ_obiektu: object?.type,
      nazwa_obiektu: objectName(object),
      wielkosc_firmy: item.company_size,
      wariant_nr: item.variant_no,
      ostatnia_zmiana_obiektu: object?.updatedAt,
    };
    for (const field of FUNDING_FIELD_KEYS) values[field] = excelScalar(item[field]);
    return row(SHEET_HEADERS.Finansowanie, values);
  });

  const documentRows = (state.documentRequirements ?? []).map((item, index) => {
    const object = byId.get(String(item.objectId ?? ""));
    const catalog = DOCUMENT_CATALOG.get(item.document_type_key);
    const values = {
      dokument_id: item.id ?? `DOC_${String(index + 1).padStart(6, "0")}`,
      obiekt_id: keyOf(object),
      typ_obiektu: object?.type,
      nazwa_obiektu: objectName(object),
      document_type_key: item.document_type_key,
      nazwa_dokumentu: catalog?.name,
      wewnetrzny: yesNo(catalog?.internal ?? false),
      ostatnia_zmiana_obiektu: object?.updatedAt,
    };
    for (const field of DOCUMENT_FIELD_KEYS) values[field] = excelScalar(item[field]);
    return row(SHEET_HEADERS.Dokumenty, values);
  });

  const fileRows = (state.fileSources ?? []).map((item) => {
    const object = byId.get(String(item.objectId ?? ""));
    return row(SHEET_HEADERS.Pliki, {
      source_id: item.id,
      obiekt_id: keyOf(object),
      typ_obiektu: object?.type,
      nazwa_obiektu: objectName(object),
      file_type: item.fileType,
      nazwa_pliku: item.name,
      url: item.url,
      source_page_url: item.sourcePageUrl,
      added_at: item.addedAt,
      ostatnia_zmiana_obiektu: object?.updatedAt,
    });
  });

  const objectFieldRows = [];
  for (const object of objects) {
    for (const [field, value] of Object.entries(object.values ?? {})) {
      const referenced = typeof value === "string" ? byId.get(String(value)) : undefined;
      objectFieldRows.push(
        row(SHEET_HEADERS.Pola_Obiektow, {
          obiekt_id: keyOf(object),
          typ_obiektu: object.type,
          nazwa_obiektu: objectName(object),
          pole: field,
          wartosc: referenced ? keyOf(referenced) : excelScalar(value),
          utworzono: object.createdAt,
          ostatnia_zmiana: object.updatedAt,
        }),
      );
    }
  }

  const projectOperatorRows = relations.map((relation, index) => row(SHEET_HEADERS.Projekty_Operatorzy, {
    id: `PO_${String(index + 1).padStart(6, "0")}`,
    projekt_id: keyOf(byId.get(String(relation.project_object_id))),
    operator_id: keyOf(byId.get(String(relation.operator_object_id))),
    typ: String(relation.operator_type) === "GLOWNY" ? "operator" : "partner",
  }));

  const dictionary = new Map();
  const ensureGeo = (type, value) => {
    const signature = `${type}:${value}`;
    if (dictionary.has(signature)) return dictionary.get(signature).geo_id;
    const meta = geoMeta(type, value, catalog);
    const parent = meta.parentType && meta.parentValue ? ensureGeo(meta.parentType, meta.parentValue) : null;
    const record = { geo_id: geoId(type, value), parent_geo_id: parent, poziom: String(meta.level), geo_typ: geoType(type), nazwa: meta.name, canonical_geo_id: geoId(type, value) };
    dictionary.set(signature, record);
    return record.geo_id;
  };
  for (const geo of geographies) ensureGeo(String(geo.type), String(geo.value));

  const projectIds = new Set(projects.map((object) => String(object.id)));
  const recruitmentIds = new Set(recruitments.map((object) => String(object.id)));
  const projectGeoRows = [];
  const recruitmentGeoRows = [];
  let gp = 0;
  let gn = 0;
  for (const geo of geographies) {
    const mapped = ensureGeo(String(geo.type), String(geo.value));
    if (projectIds.has(String(geo.objectId)) && geo.role !== "WYKLUCZA") {
      gp += 1;
      projectGeoRows.push(row(SHEET_HEADERS.Geografia_Projekty, { geo_projekt_id: geo.id || `GPR_${String(gp).padStart(6, "0")}`, projekt_id: keyOf(byId.get(String(geo.objectId))), geo_id: mapped }));
    }
    if (recruitmentIds.has(String(geo.objectId))) {
      gn += 1;
      recruitmentGeoRows.push(row(SHEET_HEADERS.Geografia_Nabory, { id: geo.id || `GNAB_${String(gn).padStart(6, "0")}`, nabor_id: keyOf(byId.get(String(geo.objectId))), miejscowosc_id: mapped, typ: geo.role === "WYKLUCZA" ? "exclude" : "include" }));
    }
  }

  return [
    { name: "Operatorzy", headers: SHEET_HEADERS.Operatorzy, rows: operatorRows },
    { name: "Projekty", headers: SHEET_HEADERS.Projekty, rows: projectRows },
    { name: "Nabory", headers: SHEET_HEADERS.Nabory, rows: recruitmentRows },
    { name: "Finansowanie", headers: SHEET_HEADERS.Finansowanie, rows: financingRows },
    { name: "Dokumenty", headers: SHEET_HEADERS.Dokumenty, rows: documentRows },
    { name: "Pliki", headers: SHEET_HEADERS.Pliki, rows: fileRows },
    { name: "Pola_Obiektow", headers: SHEET_HEADERS.Pola_Obiektow, rows: objectFieldRows },
    { name: "Projekty_Operatorzy", headers: SHEET_HEADERS.Projekty_Operatorzy, rows: projectOperatorRows },
    { name: "Geografia_Slownik", headers: SHEET_HEADERS.Geografia_Slownik, rows: [...dictionary.values()].sort((a, b) => Number(a.poziom) - Number(b.poziom) || a.nazwa.localeCompare(b.nazwa, "pl")).map((item) => row(SHEET_HEADERS.Geografia_Slownik, item)) },
    { name: "Geografia_Projekty", headers: SHEET_HEADERS.Geografia_Projekty, rows: projectGeoRows },
    { name: "Geografia_Nabory", headers: SHEET_HEADERS.Geografia_Nabory, rows: recruitmentGeoRows },
  ];
}

export function buildBurExcelWorkbook(db, geographySourcePath) {
  return buildXlsxWorkbook(buildBurSheets(readBurSnapshot(db), readFileSync(geographySourcePath, "utf8")));
}
