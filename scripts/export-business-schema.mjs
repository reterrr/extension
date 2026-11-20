import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import "../src/shared/domain/schema.js";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/shared/domain/geographyRuntime.ts", import.meta.url),
    ),
  ],
  platform: "node",
  format: "esm",
  bundle: true,
  write: false,
});
const { geographyRuntime } = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].text).toString("base64")
);

const mapFields = (fields) =>
  Object.getOwnPropertyNames(fields).map((key) => ({
    key,
    persistentKey: key,
    nullable: !fields[key].required,
    cardinality: "one",
    ...fields[key],
  }));
const entity = (localType, key, definition) => ({
  localType,
  key,
  label: definition.label,
  primaryLabelField: definition.primary ?? null,
  fields: mapFields(definition.fields),
});
const { project, recruitment, operator, nabor } = globalThis.BurbotSchema;
const fields = {
  ...recruitment.fields,
  legacy_operator_name: { ...nabor.fields.operator, legacy: true },
  legacy_amount: { ...nabor.fields.amount, legacy: true },
  legacy_deadline: { ...nabor.fields.deadline, legacy: true },
};
// Preserve the non-enumerable refund fields for legacy selectors.
for (const key of Object.getOwnPropertyNames(recruitment.fields))
  fields[key] = recruitment.fields[key];

const reference = (label, references) => ({
  label,
  references,
  type: "reference",
});
const text = (label) => ({ label, type: "string" });
const choice = (label, options) => ({ label, type: "enum", options });
const parentTypes = ["project", "recruitment"];
function nested(localType, key, label, parents, fields) {
  return {
    ...entity(localType, key, {
      label,
      fields: {
        ...Object.fromEntries(
          Object.getOwnPropertyNames(fields).map((name) => [
            name,
            fields[name],
          ]),
        ),
        ...Object.fromEntries(
          parents.map((parent) => [
            parent + "_owner",
            reference(parent, parent),
          ]),
        ),
      },
    }),
    parents,
  };
}

const manifest = {
  format: 1,
  key: "burbot",
  name: "Burbot PSF/BUR",
  entities: [
    entity("project", "Project", project),
    entity("recruitment", "Recruitment", { ...recruitment, fields }),
    entity("operator", "Operator", operator),
    nested(
      "operator_assignment",
      "OperatorAssignment",
      "Przypisanie operatora",
      parentTypes,
      {
        operatorId: reference("Operator", "operator"),
        operatorType: choice("Rola operatora", {
          GLOWNY: "Główny",
          DODATKOWY: "Dodatkowy",
        }),
      },
    ),
    nested(
      "operator_contact",
      "OperatorContact",
      "Kontakt operatora",
      ["operator"],
      {
        kind: choice(
          "Rodzaj kontaktu",
          globalThis.BurbotOperatorContacts.kinds,
        ),
        value: text("Dane kontaktowe"),
        variant_no: { label: "Numer", type: "integer", min: 1 },
      },
    ),
    nested(
      "geography",
      "Geography",
      "Geografia",
      ["operator", ...parentTypes],
      {
        type: choice("Typ obszaru", geographyRuntime.types),
        role: choice("Rola", geographyRuntime.roles),
        value: text("Obszar"),
        operatorId: reference("Zakres operatora", "operator"),
      },
    ),
    nested("funding", "FundingVariant", "Wariant finansowania", parentTypes, {
      ...Object.fromEntries(
        mapFields(globalThis.BurbotFunding.fields).map(({ key, ...field }) => [
          key,
          field,
        ]),
      ),
      company_size: choice("Wielkość firmy", globalThis.BurbotFunding.sizes),
      variant_no: { label: "Numer wariantu", type: "integer", min: 1 },
      service_category_id: reference("Kategoria usługi", "service_category"),
    }),
    nested(
      "service_category",
      "ServiceCategory",
      "Kategoria usługi",
      parentTypes,
      {
        label: text("Nazwa"),
      },
    ),
    nested("file_source", "DocumentFile", "Plik", parentTypes, {
      name: text("Nazwa pliku"),
      display_name: text("Nazwa dokumentu"),
      fileType: text("Format pliku"),
      url: { label: "URL pliku", type: "url" },
      source: { label: "Zarejestrowane źródło", type: "source" },
      purpose: text("Przeznaczenie"),
      has_fields: { label: "Zawiera pola", type: "boolean" },
      intended_use: text("Zastosowanie"),
      client_requirement: text("Wymagalność"),
      signature_requirement: text("Podpis"),
      condition: text("Warunek"),
      delivery_stage: text("Etap dostarczenia"),
      responsibility: choice("Odpowiedzialność", {
        FUNDPILOT: "FundPilot",
        CLIENT: "Klient",
        SHARED: "Wspólna",
      }),
      required_evidence: text("Potrzebne dowody"),
      source_url: { label: "Źródło", type: "url" },
      source_description: text("Opis źródła"),
    }),
    nested(
      "document",
      "DocumentRequirement",
      "Wymaganie dokumentowe",
      parentTypes,
      {
        ...globalThis.BurbotDocuments.fields,
        document_type_key: text("Typ dokumentu (legacy)"),
        source_file_source_ids: {
          label: "Pliki dokumentu",
          type: "reference",
          references: "file_source",
          cardinality: "many",
        },
      },
    ),
  ],
  aliases: {
    nabor: {
      entity: "recruitment",
      fields: {
        title: "external_number",
        operator: "legacy_operator_name",
        amount: "legacy_amount",
        deadline: "legacy_deadline",
        url: "announcement_url",
      },
    },
  },
  provenance: {
    fieldEvidence: "Extraction FieldObservation and SelectorEvaluation",
    importSources: "Sources Source and SourceSnapshot",
    localFileBlobs: "SQLite until explicitly registered in the server storage",
  },
};
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
