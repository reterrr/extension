import assert from "node:assert/strict";
import test from "node:test";

import {
  aiViewExportFilename,
  createAiViewExport,
} from "../src/shared/export/aiViewExport.js";

const schema = {
  project: {
    fields: {
      name: { type: "string" },
      operator_id: { type: "reference", references: "operator" },
      status: { type: "enum" },
      last_checked_at: { type: "datetime" },
    },
  },
  recruitment: {
    fields: {
      external_number: { type: "string" },
      project_id: { type: "reference", references: "project" },
      status: { type: "enum" },
      continuous: { type: "boolean" },
      urlOgloszenia: { type: "url" },
      last_checked_at: { type: "datetime" },
    },
  },
  operator: {
    fields: {
      name: { type: "string" },
      nip: { type: "nip" },
    },
  },
};

const geographyCatalog = [
  {
    type: "MIASTO_NA_PRAWACH_POWIATU",
    value: "śląskie|miasto|Katowice",
    label: "Katowice",
    context: "śląskie",
  },
];

const documentCatalog = [
  {
    key: "msp_application_form",
    name: "Formularz zgłoszeniowy MSP (Zał. 1)",
    internal: false,
  },
];

function state() {
  return {
    version: 1,
    revision: 7,
    objects: [
      {
        id: "operator-1",
        type: "operator",
        label: "Human Power Sp. z o.o.",
        values: {
          name: "Human Power Sp. z o.o.",
          nip: "1234567890",
        },
      },
      {
        id: "project-1",
        type: "project",
        sourceUrl: "https://example.test/project",
        values: {
          name: "Pełny rozwój",
          operator_id: "operator-1",
          status: "AKTYWNY",
          announcements_site_url: "https://example.test/project/recruitments",
          last_checked_at: "2026-09-20T10:00:00.000Z",
          custom_imported_value: "wartość dodatkowa",
        },
        evidence: {
          name: [{ sourceId: "source-1", charStart: 0, charEnd: 12 }],
        },
      },
      {
        id: "recruitment-1",
        type: "recruitment",
        sourceUrl: "https://example.test/recruitment/1",
        values: {
          external_number: "1/2026",
          project_id: "project-1",
          status: "AKTYWNY",
          continuous: false,
          urlOgloszenia: "https://example.test/recruitment/1/announcement",
          last_checked_at: "2026-09-20T11:00:00.000Z",
          custom_recruitment_value: "pełna wartość naboru",
        },
      },
      {
        id: "recruitment-other",
        type: "recruitment",
        values: {
          external_number: "2/2026",
          project_id: "other-project",
          status: "PLANOWANY",
        },
      },
    ],
    rules: [
      {
        id: "rule-1",
        objectId: "project-1",
        field: "name",
        pageUrl: "https://example.test/project",
        selector: "#title",
        extraction: { type: "text" },
      },
    ],
    geographies: [
      {
        id: "geo-1",
        objectId: "project-1",
        type: "MIASTO_NA_PRAWACH_POWIATU",
        role: "OBEJMUJE",
        value: "śląskie|miasto|Katowice",
      },
      {
        id: "geo-recruitment-1",
        objectId: "recruitment-1",
        type: "MIASTO_NA_PRAWACH_POWIATU",
        role: "OBEJMUJE",
        value: "śląskie|miasto|Katowice",
      },
    ],
    financingRules: [
      {
        id: "funding-1",
        objectId: "project-1",
        company_size: "SMALL",
        variant_no: 1,
        refund_percent_min: 70,
        refund_percent_avg: 75,
        refund_percent_max: 80,
      },
      {
        id: "funding-recruitment-1",
        objectId: "recruitment-1",
        company_size: "MICRO",
        variant_no: 1,
        refund_percent_min: 80,
        refund_percent_avg: 85,
        refund_percent_max: 90,
        max_amount_pln: 12000,
      },
    ],
    documentRequirements: [
      {
        id: "document-1",
        objectId: "project-1",
        document_type_key: "msp_application_form",
        requirement: "REQUIRED",
        auto_fill: true,
      },
      {
        id: "document-recruitment-1",
        objectId: "recruitment-1",
        document_type_key: "msp_application_form",
        requirement: "OPTIONAL",
        auto_fill: false,
        notes: "Dokument dla naboru",
      },
    ],
    fileSources: [
      {
        id: "file-1",
        objectId: "project-1",
        fileType: "PDF",
        name: "Regulamin.pdf",
        url: "https://example.test/regulamin.pdf",
        sourcePageUrl: "https://example.test/project",
        addedAt: "2026-09-20T10:05:00.000Z",
      },
      {
        id: "file-recruitment-1",
        objectId: "recruitment-1",
        fileType: "PDF",
        name: "Dokumentacja naboru.pdf",
        url: "https://example.test/recruitment/1/docs.pdf",
        sourcePageUrl: "https://example.test/recruitment/1",
        addedAt: "2026-09-20T11:05:00.000Z",
      },
    ],
    importSources: [
      {
        id: "source-1",
        importKey: "page",
        type: "HTML",
        snapshot: { text: "very large snapshot" },
        importedAt: "2026-09-20T10:00:00.000Z",
      },
    ],
  };
}

test("AI View export keeps all business values and resolves references", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1"],
      query: "type:projekty woj:śląskie",
      type: "project",
      createdAt: "2026-09-20T10:00:00.000Z",
    },
    schema,
    geographyCatalog,
    documentCatalog,
    exportedAt: "2026-09-20T12:00:00.000Z",
  });

  assert.equal(payload.format, "burbot-ai-view");
  assert.equal(payload.version, 1);
  assert.equal(payload.view.object_count, 1);
  assert.equal(payload.objects[0].name, "Pełny rozwój");
  assert.equal(payload.objects[0].values.status, "AKTYWNY");
  assert.equal(
    payload.objects[0].values.custom_imported_value,
    "wartość dodatkowa",
  );
  assert.deepEqual(payload.objects[0].values.operator_id, {
    id: "operator-1",
    name: "Human Power Sp. z o.o.",
    type: "operator",
  });
});

test("AI View export includes readable related business data", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1"],
      query: "",
      type: "all",
      createdAt: "2026-09-20T10:00:00.000Z",
    },
    schema,
    geographyCatalog,
    documentCatalog,
    exportedAt: "2026-09-20T12:00:00.000Z",
  });
  const project = payload.objects[0];

  assert.deepEqual(project.geography[0], {
    type: "MIASTO_NA_PRAWACH_POWIATU",
    role: "OBEJMUJE",
    label: "Katowice",
    context: "śląskie",
    value: "śląskie|miasto|Katowice",
  });
  assert.equal(project.financing[0].company_size, "SMALL");
  assert.equal(project.financing[0].refund_percent_avg, 75);
  assert.equal(project.financing[0].id, undefined);
  assert.equal(
    project.documents[0].name,
    "Formularz zgłoszeniowy MSP (Zał. 1)",
  );
  assert.equal(project.documents[0].requirement, "REQUIRED");
  assert.equal(project.files[0].name, "Regulamin.pdf");
  assert.equal(project.files[0].url, "https://example.test/regulamin.pdf");
});

test("project export includes every related recruitment with full business data", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1"],
      query: "type:projekty",
      type: "project",
    },
    schema,
    geographyCatalog,
    documentCatalog,
    exportedAt: "2026-09-20T12:00:00.000Z",
  });

  const project = payload.objects[0];
  assert.equal(payload.view.related_recruitment_count, 1);
  assert.equal(project.recruitments.length, 1);

  const recruitment = project.recruitments[0];
  assert.equal(recruitment.id, "recruitment-1");
  assert.equal(recruitment.name, "1/2026");
  assert.equal(recruitment.values.status, "AKTYWNY");
  assert.equal(recruitment.values.continuous, false);
  assert.equal(
    recruitment.values.custom_recruitment_value,
    "pełna wartość naboru",
  );
  assert.deepEqual(recruitment.values.project_id, {
    id: "project-1",
    name: "Pełny rozwój",
    type: "project",
  });
  assert.equal(recruitment.geography[0].label, "Katowice");
  assert.equal(recruitment.financing[0].refund_percent_avg, 85);
  assert.equal(recruitment.financing[0].max_amount_pln, 12000);
  assert.equal(recruitment.documents[0].requirement, "OPTIONAL");
  assert.equal(recruitment.documents[0].notes, "Dokument dla naboru");
  assert.equal(recruitment.files[0].name, "Dokumentacja naboru.pdf");

  assert.equal(
    project.recruitments.some((row) => row.id === "recruitment-other"),
    false,
  );
});

test("AI View export provides a deduplicated link index for projects and recruitments", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1"],
      query: "",
      type: "project",
    },
    schema,
    geographyCatalog,
    documentCatalog,
  });

  const project = payload.objects[0];
  const projectUrls = new Set(project.links.map((entry) => entry.url));
  assert.ok(projectUrls.has("https://example.test/project"));
  assert.ok(projectUrls.has("https://example.test/project/recruitments"));
  assert.ok(projectUrls.has("https://example.test/regulamin.pdf"));

  const recruitment = project.recruitments[0];
  const recruitmentUrls = new Set(recruitment.links.map((entry) => entry.url));
  assert.ok(recruitmentUrls.has("https://example.test/recruitment/1"));
  assert.ok(
    recruitmentUrls.has(
      "https://example.test/recruitment/1/announcement",
    ),
  );
  assert.ok(
    recruitmentUrls.has("https://example.test/recruitment/1/docs.pdf"),
  );

  const sourceLink = recruitment.links.find(
    (entry) => entry.url === "https://example.test/recruitment/1",
  );
  assert.ok(sourceLink.from.includes("source_url"));
  assert.ok(
    sourceLink.from.includes("file_source:Dokumentacja naboru.pdf"),
  );
});

test("AI View export excludes extraction and evidence internals", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1"],
      query: "",
      type: "all",
    },
    schema,
    geographyCatalog,
    documentCatalog,
  });

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("selector"), false);
  assert.equal(serialized.includes("very large snapshot"), false);
  assert.equal(serialized.includes("charStart"), false);
  assert.equal(payload.objects[0].evidence, undefined);
  assert.equal(payload.objects[0].rules, undefined);
});

test("AI View export follows View object order", () => {
  const payload = createAiViewExport({
    state: state(),
    view: {
      version: 1,
      objectIds: ["project-1", "operator-1"],
      query: "",
      type: "all",
    },
    schema,
    geographyCatalog,
    documentCatalog,
  });

  assert.deepEqual(
    payload.objects.map((object) => object.id),
    ["project-1", "operator-1"],
  );
});

test("AI View export filename is deterministic and filesystem friendly", () => {
  assert.equal(
    aiViewExportFilename("2026-09-20T12:34:56.789Z"),
    "burbot-view-ai-2026-09-20T12-34-56-789Z.json",
  );
});
