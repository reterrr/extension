import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let outputDir;
let remoteFile;
let fileDownloads;
let fileInheritance;
let fileMetadata;
let stateMigrations;
let roundImportZip;
let fundPilotExportZip;

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "burbot-file-source-"));
  await build({
    absWorkingDir: root,
    entryPoints: {
      remoteFile: "src/shared/sources/remoteFile.ts",
      fileDownloads: "src/shared/fileDownloads.ts",
      fileInheritance: "src/shared/fileInheritance.ts",
      fileMetadata: "src/shared/fileMetadata.ts",
      stateMigrations: "src/shared/domain/stateMigrations.ts",
      roundImportZip: "src/shared/export/roundImportZip.ts",
      fundPilotExportZip: "src/shared/export/fundPilotExportZip.ts",
    },
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  remoteFile = await import(
    pathToFileURL(join(outputDir, "remoteFile.js")).href
  );
  fileDownloads = await import(
    pathToFileURL(join(outputDir, "fileDownloads.js")).href
  );
  fileInheritance = await import(
    pathToFileURL(join(outputDir, "fileInheritance.js")).href
  );
  fileMetadata = await import(
    pathToFileURL(join(outputDir, "fileMetadata.js")).href
  );
  stateMigrations = await import(
    pathToFileURL(join(outputDir, "stateMigrations.js")).href
  );
  roundImportZip = await import(
    pathToFileURL(join(outputDir, "roundImportZip.js")).href
  );
  fundPilotExportZip = await import(
    pathToFileURL(join(outputDir, "fundPilotExportZip.js")).href
  );
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("remote PDF source keeps the canonical HTTP URL", () => {
  const file = remoteFile.createRemotePdfSourceCandidate(
    "https://projekt.test/files/regulamin.pdf?version=2#page=4",
    "https://projekt.test/nabor",
  );

  assert.deepEqual(file, {
    fileType: "PDF",
    url: "https://projekt.test/files/regulamin.pdf?version=2#page=4",
    sourcePageUrl: "https://projekt.test/nabor",
    name: "regulamin.pdf",
  });
});

test("file name always comes from the actual PDF filename, not link text", () => {
  const file = remoteFile.createRemotePdfSourceCandidate(
    "../docs/regulamin.pdf",
    "https://projekt.test/nabory/3/",
    " Regulamin naboru ",
  );

  assert.equal(file.url, "https://projekt.test/nabory/docs/regulamin.pdf");
  assert.equal(file.name, "regulamin.pdf");
  assert.equal(file.sourcePageUrl, "https://projekt.test/nabory/3/");
});

test("local filesystem and blob URLs are never accepted as sources", () => {
  for (const url of [
    "file:///home/yhwach/Downloads/regulamin.pdf",
    "blob:https://projekt.test/1234",
  ]) {
    assert.throws(
      () =>
        remoteFile.createRemotePdfSourceCandidate(
          url,
          "https://projekt.test/nabor",
        ),
      /HTTP\(S\)/,
    );
  }
});

test("non-PDF links are rejected", () => {
  assert.throws(
    () =>
      remoteFile.createRemotePdfSourceCandidate(
        "https://projekt.test/regulamin.html",
        "https://projekt.test/nabor",
      ),
    /PDF/,
  );
  assert.equal(
    remoteFile.isRemotePdfUrl("https://projekt.test/regulamin.pdf?download=1"),
    true,
  );
  assert.equal(remoteFile.isRemotePdfUrl("file:///tmp/regulamin.pdf"), false);
});


test("all configured file extensions are accepted", () => {
  const expected = {
    doc: "DOC",
    docx: "DOCX",
    pdf: "PDF",
    xlsx: "XLSX",
    png: "PNG",
    jpg: "JPG",
    jpeg: "JPEG",
    zip: "ZIP",
    rar: "RAR",
    "7z": "7Z",
    tar: "TAR",
    gz: "GZ",
    tgz: "TGZ",
  };

  for (const [extension, fileType] of Object.entries(expected)) {
    const file = remoteFile.createRemoteFileSourceCandidate(
      `https://projekt.test/files/sample.${extension}?download=1`,
      "https://projekt.test/nabor",
    );
    assert.equal(file.fileType, fileType);
    assert.equal(file.name, `sample.${extension}`);
    assert.equal(remoteFile.isRemoteSupportedFileUrl(file.url), true);
  }
});

test("explicit unsupported remote extensions are still rejected", () => {
  for (const extension of ["html", "xls", "gif", "webp", "csv"]) {
    assert.throws(
      () =>
        remoteFile.createRemoteFileSourceCandidate(
          `https://projekt.test/files/sample.${extension}`,
          "https://projekt.test/nabor",
        ),
      /supported document\/file link/,
    );
  }
});

test("extensionless download endpoints remain attachable even without a type hint", () => {
  const file = remoteFile.createRemoteFileSourceCandidate(
    "https://projekt.test/download/opaque-token",
    "https://projekt.test/nabor",
    "Dokument do pobrania",
  );
  assert.equal(file.fileType, "OTHER");
  assert.equal(file.name, "Dokument do pobrania");
});

test("opaque download links use page context instead of requiring a filename extension", () => {
  const file = remoteFile.createRemoteFileSourceCandidate(
    "https://ocrg.opolskie.pl/download/enB03whdGjCXJNvZPcHYig",
    "https://ocrg.opolskie.pl/projekt/example/",
    "Regulamin rekrutacji i udzielania wsparcia",
    "PDF",
  );

  assert.equal(file.fileType, "PDF");
  assert.equal(
    file.url,
    "https://ocrg.opolskie.pl/download/enB03whdGjCXJNvZPcHYig",
  );
  assert.equal(file.name, "Regulamin rekrutacji i udzielania wsparcia.pdf");
});

test("loose attachment hints recognize file types from classes and icon paths", () => {
  assert.equal(
    remoteFile.sourceFileTypeFromHint("pdf attachment /images/ext/pdf_icon.gif"),
    "PDF",
  );
  assert.equal(
    remoteFile.sourceFileTypeFromHint("download-attachment docx"),
    "DOCX",
  );
});

test("common archive links can be attached and classified as file sources", () => {
  for (const [name, type] of [
    ["pakiet.zip", "ZIP"],
    ["dokumenty.rar", "RAR"],
    ["zalaczniki.7z", "7Z"],
    ["backup.tar", "TAR"],
    ["backup.tar.gz", "GZ"],
    ["backup.tgz", "TGZ"],
  ]) {
    const file = remoteFile.createRemoteFileSourceCandidate(
      `https://projekt.test/files/${name}`,
      "https://projekt.test/nabor",
    );
    assert.equal(file.fileType, type);
    assert.equal(file.name, name);
  }
});

test("PDF compatibility helpers remain PDF-only", () => {
  assert.equal(
    remoteFile.isRemotePdfUrl("https://projekt.test/regulamin.pdf?download=1"),
    true,
  );
  assert.equal(
    remoteFile.isRemotePdfUrl("https://projekt.test/formularz.docx"),
    false,
  );
  assert.throws(
    () =>
      remoteFile.createRemotePdfSourceCandidate(
        "https://projekt.test/formularz.docx",
        "https://projekt.test/nabor",
      ),
    /PDF/,
  );
});


test("project download plan puts all project files in one project folder", () => {
  const plan = fileDownloads.buildProjectDownloadPlan(
    "Wsparcie śląskich przedsiębiorców / PSF",
    [
      { name: "regulamin.pdf", url: "https://example.test/regulamin.pdf" },
      { name: "formularz.docx", url: "https://example.test/formularz.docx" },
    ],
    false,
  );

  assert.equal(
    plan.folderName,
    "Wsparcie śląskich przedsiębiorców - PSF",
  );
  assert.deepEqual(
    plan.files.map((file) => file.relativePath),
    [
      "Wsparcie śląskich przedsiębiorców - PSF/regulamin.pdf",
      "Wsparcie śląskich przedsiębiorców - PSF/formularz.docx",
    ],
  );
});

test("recruitment download plan puts all files in one recruitment/project folder", () => {
  const plan = fileDownloads.buildRecruitmentDownloadPlan(
    "Nabór IX/2026",
    "Generator Kompetencji 3.0",
    [
      { name: "regulamin.pdf", url: "https://example.test/regulamin.pdf" },
      { name: "formularz.docx", url: "https://example.test/formularz.docx" },
    ],
    false,
  );

  assert.equal(plan.folderName, "Nabór IX - 2026 - Generator Kompetencji 3.0");
  assert.deepEqual(
    plan.files.map((file) => file.relativePath),
    [
      "Nabór IX - 2026 - Generator Kompetencji 3.0/regulamin.pdf",
      "Nabór IX - 2026 - Generator Kompetencji 3.0/formularz.docx",
    ],
  );
});

test("download plan uniquifies duplicate filenames", () => {
  const plan = fileDownloads.buildRecruitmentDownloadPlan(
    "Nabór",
    "Projekt",
    [
      { name: "załącznik.pdf", url: "https://example.test/a" },
      { name: "załącznik.pdf", url: "https://example.test/b" },
      { name: "ZAŁĄCZNIK.PDF", url: "https://example.test/c" },
    ],
    false,
  );

  assert.deepEqual(
    plan.files.map((file) => file.relativePath),
    [
      "Nabór - Projekt/załącznik.pdf",
      "Nabór - Projekt/załącznik (2).pdf",
      "Nabór - Projekt/ZAŁĄCZNIK (3).PDF",
    ],
  );
});

test("Windows download folder uses a filesystem-safe separator", () => {
  const folder = fileDownloads.recruitmentDownloadFolderName(
    "Nabór: IX",
    "Projekt/A",
    true,
  );
  assert.equal(folder, "Nabór - IX - Projekt - A");
});


test("download path sanitizer removes Firefox-rejected invisible characters", () => {
  const plan = fileDownloads.buildRecruitmentDownloadPlan(
    "Nabór\u00a0IX",
    "Projekt\u202fŚląski\u200b",
    [
      {
        name: "formularz\u00a0wersja%20finalna.pdf",
        url: "https://example.test/file.pdf",
      },
    ],
    false,
  );

  assert.equal(plan.folderName, "Nabór IX - Projekt Śląski");
  assert.equal(
    plan.files[0].relativePath,
    "Nabór IX - Projekt Śląski/formularz wersja - 20finalna.pdf",
  );
});




test("FundPilot recruitment export keeps the complete portable business dataset and package files", () => {
  const state = {
    version: 1,
    revision: 17,
    objects: [
      {
        id: "OP_1",
        importKey: "OP_1",
        type: "operator",
        label: "Operator Test",
        createdAt: "2026-01-01T08:00:00.000Z",
        updatedAt: "2026-10-14T12:00:00.000Z",
        values: {
          name: "Operator Test",
          role: "OPERATOR",
          nip: "1234567890",
          email: "kontakt@example.test",
          last_checked_at: "2026-10-14T11:55:00.000Z",
        },
      },
      {
        id: "PR_1",
        importKey: "PR_1",
        type: "project",
        label: "Projekt Test",
        createdAt: "2026-01-02T08:00:00.000Z",
        updatedAt: "2026-10-14T12:10:00.000Z",
        values: {
          name: "Projekt Test",
          type: "B2B",
          status: "AKTYWNY",
          number: "FEPK.TEST",
          project_url: "https://example.test/project",
          eligible_entities: "MŚP z obszaru projektu.",
          funding_conditions: "Projektowo refundacja do 80%.",
          application_instructions: "Zgłoszenie przez system operatora.",
          funding_rules: "Reguły wspólne dla projektu.",
        },
      },
      {
        id: "NAB_1",
        importKey: "NAB_1",
        type: "recruitment",
        label: "Nabór 1/2026",
        createdAt: "2026-10-01T08:00:00.000Z",
        updatedAt: "2026-10-14T13:00:00.000Z",
        values: {
          external_number: "Nabór 1/2026",
          project_id: "PR_1",
          source_number: "BUR-I/1/2026",
          status: "AKTYWNY",
          continuous: false,
          dataRozpoczeciaOd: "2026-10-10",
          godzinaRozpoczecia: "08:00",
          dataZakonczeniaDo: "2026-10-31",
          godzinaZakonczenia: "16:00",
          eligible_entities: "Mikro i małe firmy.",
          funding_conditions: "Pomoc de minimis.",
          application_instructions: "Wyślij podpisany formularz.",
          notes: "Pełne dane naboru.",
          last_checked_at: "2026-10-14T12:59:00.000Z",
        },
      },
      {
        id: "NAB_2",
        importKey: "NAB_2",
        type: "recruitment",
        label: "Nabór 2/2026",
        values: {
          external_number: "Nabór 2/2026",
          project_id: "PR_1",
          status: "PLANOWANY",
        },
      },
    ],
    rules: [],
    operatorAssignments: [
      {
        id: "ASSIGN_PR",
        objectId: "PR_1",
        operatorId: "OP_1",
        operatorType: "GLOWNY",
      },
      {
        id: "ASSIGN_NAB",
        objectId: "NAB_1",
        operatorId: "OP_1",
        operatorType: "GLOWNY",
      },
      {
        id: "ASSIGN_NAB_2",
        objectId: "NAB_2",
        operatorId: "OP_1",
        operatorType: "GLOWNY",
      },
    ],
    operatorContacts: [
      {
        id: "CONTACT_1",
        objectId: "OP_1",
        kind: "PHONE",
        variant_no: 1,
        value: "+48 17 123 45 67",
      },
    ],
    serviceCategories: [
      {
        id: "SERVICE_1",
        objectId: "PR_1",
        label: "Szkolenia",
      },
    ],
    financingRules: [
      {
        id: "FUND_PROJECT",
        objectId: "PR_1",
        company_size: "MICRO",
        variant_no: 1,
        refund_percent_base: 50,
        refund_percent_max: 80,
        max_amount_pln: 20000,
        notes: "Wariant projektu",
      },
      {
        id: "FUND_NAB",
        objectId: "NAB_1",
        company_size: "MICRO",
        variant_no: 1,
        service_category_id: "SERVICE_1",
        refund_percent_base: 60,
        refund_percent_standard: 70,
        refund_percent_max: 85,
        own_contribution_percent_min: 15,
        max_amount_pln: 15000,
        max_per_person_pln: 5000,
        notes: "Wariant naboru",
      },
    ],
    geographies: [
      {
        id: "GEO_1",
        objectId: "NAB_1",
        operatorId: "OP_1",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "podkarpackie",
      },
    ],
    fileSources: [
      {
        id: "FILE_PROJECT",
        objectId: "PR_1",
        fileType: "PDF",
        url: "https://example.test/project/regulamin.pdf",
        sourcePageUrl: "https://example.test/project",
        name: "regulamin-projektu.pdf",
        addedAt: "2026-10-01T10:00:00.000Z",
        display_name: "Regulamin projektu",
        purpose: "Regulamin",
        has_fields: false,
        intended_use: "Zasady projektu",
        client_requirement: "Informacyjny",
        signature_requirement: "Nie jest wymagany",
      },
      {
        id: "FILE_NAB",
        objectId: "NAB_1",
        fileType: "DOCX",
        url: "https://example.test/nabor/formularz.docx",
        sourcePageUrl: "https://example.test/nabor",
        name: "formularz.docx",
        addedAt: "2026-10-01T11:00:00.000Z",
        display_name: "Formularz zgłoszeniowy",
        purpose: "Formularz do uzupełnienia",
        has_fields: true,
        intended_use: "Zgłoszenie do naboru",
        client_requirement: "Obowiązkowy",
        signature_requirement: "Wymagany podpisany plik",
      },
    ],
    documentRequirements: [
      {
        id: "DOC_PROJECT",
        importKey: "DOC_PROJECT",
        objectId: "PR_1",
        label: "Regulamin projektu",
        purpose: "Materiał informacyjny.",
        requirement: "INFORMATIONAL",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        source_file_source_ids: ["FILE_PROJECT"],
        signature_requirement: "NOT_REQUIRED",
      },
      {
        id: "DOC_NAB",
        importKey: "DOC_NAB",
        objectId: "NAB_1",
        label: "Formularz zgłoszeniowy",
        purpose: "Formularz składany przy zgłoszeniu.",
        requirement: "REQUIRED",
        fulfillment_mode: "OPERATOR_TEMPLATE",
        original_file_source_id: "FILE_NAB",
        source_file_source_ids: ["FILE_NAB"],
        signature_requirement: "REQUIRED_FILE",
      },
      {
        id: "DOC_NO_TEMPLATE",
        importKey: "DOC_NO_TEMPLATE",
        objectId: "NAB_1",
        label: "Karta Usługi BUR",
        purpose: "Potwierdza wybraną usługę.",
        requirement: "REQUIRED",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Wydruk Karty Usługi z BUR.",
        signature_requirement: "NOT_REQUIRED",
      },
    ],
  };

  const plan = fundPilotExportZip.buildFundPilotExportPackagePlan(
    state,
    state.objects.find((object) => object.id === "NAB_1"),
    "2026-10-14T17:00:00.000Z",
  );
  const exported = plan.document;

  assert.equal(exported.format, "FundPilotExportV1");
  assert.equal(exported.root_object.key, "NAB_1");
  assert.equal(exported.root_object.type, "recruitment");
  assert.equal(exported.system.workspace_revision, 17);

  const keys = exported.data.objects.map((object) => object.key);
  assert.deepEqual(keys, ["OP_1", "PR_1", "NAB_1"]);
  assert.equal(keys.includes("NAB_2"), false);

  const project = exported.data.objects.find((object) => object.key === "PR_1");
  const recruitment = exported.data.objects.find((object) => object.key === "NAB_1");
  const operator = exported.data.objects.find((object) => object.key === "OP_1");

  assert.equal(project.data.eligible_entities, "MŚP z obszaru projektu.");
  assert.equal(project.data.funding_conditions, "Projektowo refundacja do 80%.");
  assert.equal(
    project.data.application_instructions,
    "Zgłoszenie przez system operatora.",
  );
  assert.deepEqual(project.services, [
    { key: "SERVICE_1", label: "Szkolenia" },
  ]);
  assert.equal(project.financing[0].data.refund_percent_base, 50);
  assert.equal(project.financing[0].data.refund_percent_max, 80);

  assert.equal(recruitment.data.status, "AKTYWNY");
  assert.equal(recruitment.data.dataRozpoczeciaOd, "2026-10-10");
  assert.equal(recruitment.data.godzinaZakonczenia, "16:00");
  assert.equal(recruitment.data.eligible_entities, "Mikro i małe firmy.");
  assert.equal(recruitment.financing[0].data.refund_percent_base, 60);
  assert.equal(recruitment.financing[0].data.refund_percent_standard, 70);
  assert.equal(recruitment.financing[0].data.refund_percent_max, 85);
  assert.equal(recruitment.financing[0].data.max_per_person_pln, 5000);
  assert.equal(recruitment.financing[0].service, "SERVICE_1");
  assert.equal(recruitment.geography[0].value, "podkarpackie");
  assert.equal(recruitment.geography[0].operator.$ref, "OP_1");

  const withoutTemplate = recruitment.files.find(
    (file) => file.key === "DOC_NO_TEMPLATE",
  );
  assert.equal(withoutTemplate.without_template, true);
  assert.equal(withoutTemplate.metadata.delivery_stage, "ZGLOSZENIE");
  assert.equal(withoutTemplate.metadata.responsibility, "CLIENT");
  assert.equal(
    withoutTemplate.metadata.required_evidence,
    "Wydruk Karty Usługi z BUR.",
  );

  assert.equal(operator.contacts[0].value, "+48 17 123 45 67");

  assert.equal(exported.package_files.length, 2);
  assert.deepEqual(
    exported.package_files.map((file) => file.path).sort(),
    ["files/formularz.docx", "files/regulamin-projektu.pdf"],
  );
  assert.ok(
    exported.package_files.some((file) =>
      file.references.some(
        (reference) =>
          reference.object === "PR_1" && reference.file === "DOC_PROJECT",
      ),
    ),
  );
  assert.ok(
    exported.package_files.some((file) =>
      file.references.some(
        (reference) =>
          reference.object === "NAB_1" && reference.file === "DOC_NAB",
      ),
    ),
  );

  const systemRecruitment = exported.system.objects.find(
    (object) => object.key === "NAB_1",
  );
  assert.equal(systemRecruitment.updated_at, "2026-10-14T13:00:00.000Z");
  assert.equal(systemRecruitment.last_checked_at, "2026-10-14T12:59:00.000Z");
  assert.equal(plan.files.length, 2);
  assert.match(plan.zipFileName, /^FundPilot - Nabór 1 - 2026\.zip$/);
});

test("FundPilot project export expands to all project recruitments", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project-id",
        importKey: "PR",
        type: "project",
        values: { name: "Projekt", status: "AKTYWNY", type: "B2B" },
      },
      {
        id: "N1",
        importKey: "N1",
        type: "recruitment",
        values: {
          external_number: "Nabór 1",
          project_id: "PR",
          status: "AKTYWNY",
        },
      },
      {
        id: "N2",
        importKey: "N2",
        type: "recruitment",
        values: {
          external_number: "Nabór 2",
          project_id: "PR",
          status: "PLANOWANY",
        },
      },
    ],
    rules: [],
    fileSources: [],
  };

  const plan = fundPilotExportZip.buildFundPilotExportPackagePlan(
    state,
    state.objects[0],
    "2026-10-14T17:05:00.000Z",
  );

  assert.deepEqual(
    plan.document.data.objects.map((object) => object.key),
    ["PR", "N1", "N2"],
  );
  assert.deepEqual(plan.document.package_files, []);
  assert.deepEqual(plan.files, []);
});

test("FundPilot package accepts archive attachments and maps them into files/", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "NAB",
        importKey: "NAB",
        type: "recruitment",
        values: {
          external_number: "Nabór z archiwum",
          status: "AKTYWNY",
        },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "ARCHIVE",
        importKey: "ARCHIVE",
        objectId: "NAB",
        fileType: "ZIP",
        url: "https://example.test/files/dokumenty.zip",
        sourcePageUrl: "https://example.test/nabor",
        name: "dokumenty.zip",
        addedAt: "2026-10-14T10:00:00.000Z",
        display_name: "Pakiet dokumentów",
        purpose: "Inny dokument",
        has_fields: false,
        client_requirement: "Informacyjny",
        signature_requirement: "Nie jest wymagany",
      },
    ],
  };

  const plan = fundPilotExportZip.buildFundPilotExportPackagePlan(
    state,
    state.objects[0],
    "2026-10-14T17:10:00.000Z",
  );

  assert.equal(plan.document.package_files.length, 1);
  assert.equal(plan.document.package_files[0].file_type, "ZIP");
  assert.equal(plan.document.package_files[0].path, "files/dokumenty.zip");
  assert.equal(plan.document.data.objects[0].files[0].source, plan.document.package_files[0].source);
});

test("FundPilot ZIP writer creates fundpilot.json plus declared package files", () => {
  const encoder = new TextEncoder();
  const zip = fundPilotExportZip.buildFundPilotStoreZip(
    [
      {
        path: "fundpilot.json",
        data: encoder.encode('{"format":"FundPilotExportV1"}'),
      },
      {
        path: "files/dokumenty.zip",
        data: new Uint8Array([1, 2, 3]),
      },
    ],
    new Date("2026-10-14T17:15:00.000Z"),
  );

  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const paths = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    paths.push(
      decoder.decode(zip.subarray(nameStart, nameStart + nameLength)),
    );
    offset = nameStart + nameLength + extraLength + size;
  }

  assert.deepEqual(paths, ["fundpilot.json", "files/dokumenty.zip"]);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
});

test("recruitment RoundImport ZIP plan matches the strict V5 manifest contract", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project-1",
        type: "project",
        label: "Generator Kompetencji 3.0",
        values: {
          name: "Generator Kompetencji 3.0",
          number: "FEPK.07.09-IP.01-0001/24",
        },
      },
      {
        id: "recruitment-1",
        type: "recruitment",
        label: "Nabór 3/2026",
        values: {
          external_number: "Nabór 3/2026",
          source_number: "BUR-I/3/2026",
          project_id: "project-1",
          action_code: "FEPK.07.09",
          status: "AKTYWNY",
          dataRozpoczeciaOd: "2026-10-10",
          dataZakonczeniaDo: "2026-10-20",
          eligible_entities: "MŚP i organizacje pozarządowe.",
          funding_conditions: "Pomoc de minimis; refundacja do 80%.",
          application_instructions: "Złóż formularz w systemie operatora.",
          urlOgloszenia: "https://example.test/nabor/3-2026",
          notes: "Import testowy.",
        },
      },
    ],
    rules: [],
    geographies: [
      {
        id: "g1",
        objectId: "recruitment-1",
        type: "WOJEWODZTWO",
        role: "OBEJMUJE",
        value: "podkarpackie",
      },
      {
        id: "g2",
        objectId: "recruitment-1",
        type: "GMINA",
        role: "WYKLUCZA",
        value: "1816132",
      },
      {
        id: "g3",
        objectId: "recruitment-1",
        type: "POWIAT",
        role: "OBEJMUJE",
        value: "podkarpackie|powiat|rzeszowski",
      },
    ],
    financingRules: [
      {
        id: "fund-1",
        objectId: "recruitment-1",
        company_size: "MICRO",
        variant_no: 1,
        refund_percent_max: 80,
        max_amount_pln: 10000,
        max_per_person_pln: 5000,
        own_contribution_form: "CASH",
      },
      {
        id: "fund-2",
        objectId: "recruitment-1",
        company_size: "NGO",
        variant_no: 1,
        refund_percent_standard: 85,
        notes: "Preferencja dla NGO",
      },
    ],
    fileSources: [
      {
        id: "rules",
        objectId: "recruitment-1",
        fileType: "PDF",
        url: "https://example.test/regulamin.pdf",
        sourcePageUrl: "https://example.test/nabor/3-2026",
        name: "regulamin_naboru.pdf",
        addedAt: "2026-10-01T12:00:00Z",
        display_name: "Regulamin naboru",
        purpose: "Regulamin",
        has_fields: false,
        intended_use: "Zasady udziału w naborze.",
        client_requirement: "Informacyjny",
        signature_requirement: "Nie jest wymagany",
      },
      {
        id: "form",
        objectId: "recruitment-1",
        fileType: "DOCX",
        url: "https://example.test/formularz.docx",
        sourcePageUrl: "https://example.test/nabor/3-2026",
        name: "formularz_zgloszeniowy.docx",
        addedAt: "2026-10-01T12:00:00Z",
        display_name: "Formularz zgłoszeniowy",
        purpose: "Formularz do uzupełnienia",
        has_fields: false,
        intended_use: "Formularz składany przy zgłoszeniu.",
        client_requirement: "Obowiązkowy",
        signature_requirement: "Wymagany podpisany plik",
      },
    ],
  };

  const recruitment = state.objects[1];
  const plan = roundImportZip.buildRoundImportPackagePlan(state, recruitment);
  const manifest = plan.manifest;

  assert.deepEqual(Object.keys(manifest), ["format", "name", "files", "workspace"]);
  assert.equal(manifest.format, "RoundImportManifestV1");
  assert.equal(manifest.name, "Nabór 3/2026");
  assert.deepEqual(manifest.files, [
    {
      id: "FILE_001",
      path: "files/regulamin_naboru.pdf",
      purpose: "regulations",
      requiresCompletion: false,
    },
    {
      id: "FILE_002",
      path: "files/formularz_zgloszeniowy.docx",
      purpose: "form",
      requiresCompletion: true,
    },
  ]);
  assert.equal("name" in manifest.files[0], false);
  assert.equal("description" in manifest.files[0], false);

  assert.deepEqual(manifest.workspace.schedule, {
    opensOn: "2026-10-10",
    closesOn: "2026-10-20",
    closeMode: "dated",
  });
  assert.equal(manifest.workspace.notes, "Import testowy.");
  assert.equal(
    manifest.workspace.conditions.officialRoundIdentifier,
    "BUR-I/3/2026",
  );
  assert.equal(
    manifest.workspace.conditions.officialIdentifierStatus,
    "provided",
  );
  assert.equal(
    manifest.workspace.conditions.officialIdentifierEvidenceUrl,
    "https://example.test/nabor/3-2026",
  );
  assert.equal(
    manifest.workspace.conditions.projectName,
    "Generator Kompetencji 3.0",
  );
  assert.equal(manifest.workspace.conditions.programCode, "FEPK.07.09");
  assert.equal(manifest.workspace.conditions.operatorStatus, "active");
  assert.deepEqual(manifest.workspace.conditions.includedTerytCodes, ["18"]);
  assert.deepEqual(manifest.workspace.conditions.excludedTerytCodes, ["1816132"]);
  assert.deepEqual(
    manifest.workspace.conditions.eligibleBusinessCategories,
    ["mikro", "ngo"],
  );
  assert.equal(manifest.workspace.conditions.aidBasis, "de_minimis");
  assert.equal(manifest.workspace.conditions.fundingVariants.length, 2);
  assert.equal(
    manifest.workspace.conditions.fundingVariants[0].mspSize,
    "mikro",
  );
  assert.equal(
    manifest.workspace.conditions.fundingVariants[0].refundPct,
    80,
  );
  assert.equal(
    manifest.workspace.conditions.fundingVariants[0].ownContributionForm,
    "monetary",
  );
  assert.equal(
    manifest.workspace.conditions.fundingVariants[1].mspSize,
    null,
  );
  assert.equal(
    manifest.workspace.conditions.fundingVariants[1].refundPct,
    85,
  );
  assert.deepEqual(manifest.workspace.conditions.sourceFileIds, [
    "FILE_001",
    "FILE_002",
  ]);

  assert.equal(manifest.workspace.documents.length, 2);
  assert.deepEqual(manifest.workspace.documents[1], {
    key: "FILE_002",
    label: "Formularz zgłoszeniowy",
    purpose: "Formularz składany przy zgłoszeniu.",
    requirement: "required",
    fulfillmentMode: "operator_template",
    originalFileId: "FILE_002",
    signatureRequirement: "required_file",
    sourceUrl: "https://example.test/nabor/3-2026",
  });
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /Pominięto 1 wpisów geografii/);
});


test("RoundImport exports configured documents including requirements without operator templates", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project",
        type: "project",
        values: { name: "Projekt" },
      },
      {
        id: "round",
        type: "recruitment",
        values: {
          external_number: "Nabór 1/2026",
          project_id: "project",
          status: "AKTYWNY",
        },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "rules",
        objectId: "round",
        fileType: "PDF",
        url: "https://example.test/regulamin.pdf",
        sourcePageUrl: "https://example.test/nabor",
        name: "regulamin.pdf",
        addedAt: "2026-10-01T12:00:00Z",
      },
      {
        id: "form",
        objectId: "round",
        fileType: "DOCX",
        url: "https://example.test/formularz.docx",
        sourcePageUrl: "https://example.test/nabor",
        name: "formularz.docx",
        addedAt: "2026-10-01T12:00:00Z",
      },
    ],
    documentRequirements: [
      {
        id: "doc-rules",
        objectId: "round",
        importKey: "DOC_RULES",
        label: "Regulamin naboru",
        purpose: "Materiał informacyjny.",
        requirement: "INFORMATIONAL",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        signature_requirement: "NOT_REQUIRED",
        source_file_source_ids: ["rules"],
      },
      {
        id: "doc-form",
        objectId: "round",
        importKey: "DOC_FORM",
        label: "Formularz zgłoszeniowy",
        purpose: "Formularz składany przy zgłoszeniu.",
        requirement: "CONDITIONAL",
        condition: "Gdy podmiot składa zgłoszenie w tej ścieżce.",
        fulfillment_mode: "OPERATOR_TEMPLATE",
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Wypełniony i podpisany formularz operatora.",
        original_file_source_id: "form",
        source_file_source_ids: ["rules", "form"],
        source_url: "https://example.test/nabor",
        source_description: "Wymóg z regulaminu.",
        version_label: "1.0",
        signature_requirement: "REQUIRED_FILE",
      },
      {
        id: "doc-bank",
        objectId: "round",
        importKey: "DOC_BANK",
        label: "Potwierdzenie rachunku bankowego",
        purpose: "Potwierdza rachunek wnioskodawcy.",
        requirement: "REQUIRED",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence:
          "Zaświadczenie o prowadzeniu rachunku lub kopia umowy rachunku.",
        source_file_source_ids: ["rules"],
        signature_requirement: "UNKNOWN",
      },
    ],
  };

  const plan = roundImportZip.buildRoundImportPackagePlan(
    state,
    state.objects[1],
  );
  assert.equal(plan.manifest.workspace.documents.length, 3);

  const [rules, form, bank] = plan.manifest.workspace.documents;
  assert.deepEqual(rules, {
    key: "DOC_RULES",
    label: "Regulamin naboru",
    purpose: "Materiał informacyjny.",
    requirement: "informational",
    fulfillmentMode: "without_operator_template",
    originalFileId: null,
    signatureRequirement: "not_required",
  });
  assert.equal(form.fulfillmentMode, "operator_template");
  assert.equal(form.originalFileId, "FILE_002");
  assert.equal(Object.prototype.hasOwnProperty.call(form, "sourceFileIds"), false);
  assert.equal(form.condition, "Gdy podmiot składa zgłoszenie w tej ścieżce.");
  assert.equal(Object.prototype.hasOwnProperty.call(form, "deliveryStage"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(form, "responsibility"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(form, "requiredEvidence"), false);
  assert.equal(form.signatureRequirement, "required_file");
  assert.equal(Object.prototype.hasOwnProperty.call(form, "versionLabel"), false);

  assert.equal(bank.fulfillmentMode, "without_operator_template");
  assert.equal(bank.originalFileId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(bank, "sourceFileIds"), false);
  assert.equal(
    bank.requiredEvidence,
    "Zaświadczenie o prowadzeniu rachunku lub kopia umowy rachunku.",
  );
});

test("RoundImport exports runtime project services and funding service assignments", () => {
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project",
        type: "project",
        values: { name: "Projekt" },
      },
      {
        id: "round",
        type: "recruitment",
        values: {
          external_number: "Nabór usługowy",
          project_id: "project",
          status: "AKTYWNY",
        },
      },
    ],
    rules: [],
    fileSources: [],
    serviceCategories: [
      {
        id: serviceId,
        objectId: "project",
        label: "Szkolenia",
      },
    ],
    financingRules: [
      {
        id: "funding-1",
        objectId: "round",
        company_size: "MICRO",
        variant_no: 1,
        service_category_id: serviceId,
        refund_percent_max: 80,
      },
    ],
  };

  const plan = roundImportZip.buildRoundImportPackagePlan(
    state,
    state.objects[1],
  );
  assert.deepEqual(plan.manifest.workspace.serviceCategories, [
    { id: serviceId, label: "Szkolenia" },
  ]);
  assert.equal(
    plan.manifest.workspace.conditions.fundingVariants[0].serviceCategoryId,
    serviceId,
  );
});

test("RoundImport plan can export a data-only recruitment with no attachments", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project",
        type: "project",
        values: { name: "Projekt" },
      },
      {
        id: "round",
        type: "recruitment",
        values: {
          external_number: "Nabór bez plików",
          project_id: "project",
          status: "PLANOWANY",
        },
      },
    ],
    rules: [],
    fileSources: [],
  };

  const plan = roundImportZip.buildRoundImportPackagePlan(
    state,
    state.objects[1],
  );
  assert.deepEqual(plan.manifest.files, []);
  assert.deepEqual(plan.manifest.workspace.documents, []);
  assert.equal(plan.manifest.name, "Nabór bez plików");
});

test("RoundImport ZIP writer creates import.json and exact declared file paths", () => {
  const encoder = new TextEncoder();
  const zip = roundImportZip.buildStoreZip(
    [
      {
        path: "import.json",
        data: encoder.encode('{"format":"RoundImportManifestV1"}'),
      },
      {
        path: "files/regulamin.pdf",
        data: new Uint8Array([1, 2, 3, 4]),
      },
    ],
    new Date("2026-10-06T12:00:00Z"),
  );

  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const paths = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    paths.push(
      decoder.decode(zip.subarray(nameStart, nameStart + nameLength)),
    );
    offset = nameStart + nameLength + extraLength + size;
  }

  assert.deepEqual(paths, ["import.json", "files/regulamin.pdf"]);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
});

test("RoundImport export rejects archive attachments unsupported by V5", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project",
        type: "project",
        values: { name: "Projekt" },
      },
      {
        id: "round",
        type: "recruitment",
        values: {
          external_number: "Nabór",
          project_id: "project",
        },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "archive",
        objectId: "round",
        fileType: "ZIP",
        url: "https://example.test/pakiet.zip",
        sourcePageUrl: "https://example.test",
        name: "pakiet.zip",
        addedAt: "2026-10-01T12:00:00Z",
      },
    ],
  };

  assert.throws(
    () =>
      roundImportZip.buildRoundImportPackagePlan(
        state,
        state.objects[1],
      ),
    /obsługuje tylko PDF, DOC, DOCX, XLSX, JPG, JPEG i PNG/,
  );
});

test("project documents are inherited as independent recruitment copies", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project-1",
        type: "project",
        label: "Projekt",
        values: { name: "Projekt", project_number: "P1" },
      },
      {
        id: "recruitment-1",
        type: "recruitment",
        label: "Nabór",
        values: { external_number: "N1", project_id: "project-1" },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "project-file-1",
        objectId: "project-1",
        fileType: "PDF",
        url: "https://example.test/regulamin.pdf",
        name: "regulamin.pdf",
        sourcePageUrl: "https://example.test/project",
        addedAt: "2026-09-01T10:00:00.000Z",
        display_name: "Regulamin projektu",
        purpose: "Regulamin / zasady",
        has_fields: false,
        intended_use: "Warunki udziału",
        client_requirement: "Informacyjny",
        signature_requirement: "Nie jest wymagany",
        sourceImportKey: "project-pdf-import",
        sourcePageImportKey: "project-page-import",
      },
      {
        id: "project-file-2",
        objectId: "project-1",
        fileType: "DOCX",
        url: "https://example.test/formularz.docx",
        name: "formularz.docx",
        sourcePageUrl: "https://example.test/project",
        addedAt: "2026-09-01T10:00:00.000Z",
        display_name: "Formularz",
      },
    ],
    documentRequirements: [
      {
        id: "project-doc-rules",
        objectId: "project-1",
        importKey: "DOC_RULES",
        label: "Regulamin projektu",
        purpose: "Materiał informacyjny",
        requirement: "INFORMATIONAL",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        source_file_source_ids: ["project-file-1"],
        signature_requirement: "NOT_REQUIRED",
      },
      {
        id: "project-doc-form",
        objectId: "project-1",
        importKey: "DOC_FORM",
        label: "Formularz",
        purpose: "Wniosek",
        requirement: "REQUIRED",
        fulfillment_mode: "OPERATOR_TEMPLATE",
        original_file_source_id: "project-file-2",
        source_file_source_ids: ["project-file-2"],
        responsibility: "CLIENT",
        signature_requirement: "REQUIRED_FILE",
      },
      {
        id: "project-doc-bank",
        objectId: "project-1",
        importKey: "DOC_BANK",
        label: "Potwierdzenie rachunku bankowego",
        purpose: "Potwierdzenie rachunku",
        requirement: "REQUIRED",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        source_file_source_ids: [],
        responsibility: "CLIENT",
        signature_requirement: "UNKNOWN",
      },
    ],
  };

  let sequence = 0;
  const result = fileInheritance.inheritProjectFilesAsCopies(
    state,
    "recruitment-1",
    () => `copy-${++sequence}`,
    "2026-09-28T16:00:00.000Z",
  );

  assert.equal(result.copied.length, 2);
  assert.equal(result.copiedRequirements.length, 3);

  const inheritanceStatus = fileInheritance.projectFileInheritanceStatus(
    state,
    state.objects.find((object) => object.id === "recruitment-1"),
  );
  assert.equal(
    inheritanceStatus.projectDocumentCount,
    3,
    "two file-backed requirements plus one no-template requirement are three documents, not five rows",
  );
  assert.equal(inheritanceStatus.pendingDocumentCount, 0);
  assert.equal(inheritanceStatus.inheritedDocumentCount, 3);

  const copiedFiles = state.fileSources.filter(
    (file) => file.objectId === "recruitment-1",
  );
  const copiedRequirements = state.documentRequirements.filter(
    (row) => row.objectId === "recruitment-1",
  );
  assert.equal(copiedFiles.length, 2);
  assert.equal(copiedRequirements.length, 3);

  const rulesCopy = copiedRequirements.find(
    (row) => row.copiedFromDocumentRequirementId === "project-doc-rules",
  );
  const formCopy = copiedRequirements.find(
    (row) => row.copiedFromDocumentRequirementId === "project-doc-form",
  );
  const bankCopy = copiedRequirements.find(
    (row) => row.copiedFromDocumentRequirementId === "project-doc-bank",
  );
  assert.ok(rulesCopy);
  assert.ok(formCopy);
  assert.ok(bankCopy);

  assert.equal(rulesCopy.copiedFromProjectId, "project-1");
  assert.equal(bankCopy.fulfillment_mode, "WITHOUT_OPERATOR_TEMPLATE");
  assert.equal(bankCopy.original_file_source_id, undefined);

  const copiedFormFile = copiedFiles.find(
    (file) => file.copiedFromFileSourceId === "project-file-2",
  );
  assert.ok(copiedFormFile);
  assert.equal(formCopy.original_file_source_id, copiedFormFile.id);
  assert.deepEqual(formCopy.source_file_source_ids, [copiedFormFile.id]);

  const copiedRulesFile = copiedFiles.find(
    (file) => file.copiedFromFileSourceId === "project-file-1",
  );
  assert.ok(copiedRulesFile);
  assert.deepEqual(rulesCopy.source_file_source_ids, [copiedRulesFile.id]);

  const projectFile = state.fileSources.find(
    (file) => file.id === "project-file-1",
  );
  projectFile.display_name = "NOWA nazwa na projekcie";
  projectFile.url = "https://example.test/regulamin-v2.pdf";
  const projectBank = state.documentRequirements.find(
    (row) => row.id === "project-doc-bank",
  );
  projectBank.label = "NOWA nazwa wymagania";

  assert.equal(copiedRulesFile.display_name, "Regulamin projektu");
  assert.equal(copiedRulesFile.url, "https://example.test/regulamin.pdf");
  assert.equal(bankCopy.label, "Potwierdzenie rachunku bankowego");

  state.fileSources = state.fileSources.filter(
    (file) => file.objectId !== "project-1",
  );
  state.documentRequirements = state.documentRequirements.filter(
    (row) => row.objectId !== "project-1",
  );
  state.objects = state.objects.filter((object) => object.id !== "project-1");

  assert.equal(
    state.fileSources.filter((file) => file.objectId === "recruitment-1").length,
    2,
  );
  assert.equal(
    state.documentRequirements.filter(
      (row) => row.objectId === "recruitment-1",
    ).length,
    3,
  );
});


test("re-inheriting adds only new project files and never overwrites recruitment copies", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "project-1",
        type: "project",
        values: { name: "Projekt" },
      },
      {
        id: "recruitment-1",
        type: "recruitment",
        values: { external_number: "N1", project_id: "project-1" },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "project-file-1",
        objectId: "project-1",
        fileType: "PDF",
        url: "https://example.test/a.pdf",
        name: "a.pdf",
        sourcePageUrl: "https://example.test/project",
        addedAt: "2026-09-01T10:00:00.000Z",
        display_name: "A",
      },
    ],
  };

  let sequence = 0;
  fileInheritance.inheritProjectFilesAsCopies(
    state,
    "recruitment-1",
    () => `copy-${++sequence}`,
    "2026-09-28T16:00:00.000Z",
  );

  const firstCopy = state.fileSources.find(
    (file) => file.objectId === "recruitment-1",
  );
  firstCopy.display_name = "Nabór ma własną nazwę";

  state.fileSources.push({
    id: "project-file-2",
    objectId: "project-1",
    fileType: "DOCX",
    url: "https://example.test/b.docx",
    name: "b.docx",
    sourcePageUrl: "https://example.test/project",
    addedAt: "2026-09-28T17:00:00.000Z",
    display_name: "B",
  });

  const statusBefore = fileInheritance.projectFileInheritanceStatus(
    state,
    state.objects.find((object) => object.id === "recruitment-1"),
  );
  assert.deepEqual(
    statusBefore.pendingFiles.map((file) => file.id),
    ["project-file-2"],
  );

  const second = fileInheritance.inheritProjectFilesAsCopies(
    state,
    "recruitment-1",
    () => `copy-${++sequence}`,
    "2026-09-28T18:00:00.000Z",
  );

  assert.equal(second.copied.length, 1);
  assert.equal(
    state.fileSources.filter((file) => file.objectId === "recruitment-1").length,
    2,
  );
  assert.equal(firstCopy.display_name, "Nabór ma własną nazwę");
});


test("document migration separates operator-template and no-template fields", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "round",
        type: "recruitment",
        values: { external_number: "Nabór" },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "template-file",
        objectId: "round",
        fileType: "DOCX",
        url: "https://example.test/form.docx",
        sourcePageUrl: "https://example.test/nabor",
        name: "form.docx",
        addedAt: "2026-10-01T12:00:00Z",
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Wypełniony formularz.",
      },
      {
        id: "info-file",
        objectId: "round",
        fileType: "PDF",
        url: "https://example.test/rules.pdf",
        sourcePageUrl: "https://example.test/nabor",
        name: "rules.pdf",
        addedAt: "2026-10-01T12:00:00Z",
      },
    ],
    documentRequirements: [
      {
        id: "doc-template",
        objectId: "round",
        label: "Formularz",
        requirement: "REQUIRED",
        fulfillment_mode: "OPERATOR_TEMPLATE",
        original_file_source_id: "template-file",
        source_file_source_ids: ["template-file"],
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Wypełniony formularz.",
        signature_requirement: "REQUIRED_FILE",
      },
      {
        id: "doc-info",
        objectId: "round",
        label: "Regulamin",
        requirement: "INFORMATIONAL",
        fulfillment_mode: "OPERATOR_TEMPLATE",
        original_file_source_id: "info-file",
        source_file_source_ids: [],
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Regulamin.",
        signature_requirement: "NOT_REQUIRED",
      },
      {
        id: "doc-no-template",
        objectId: "round",
        label: "Karta Usługi",
        requirement: "REQUIRED",
        fulfillment_mode: "WITHOUT_OPERATOR_TEMPLATE",
        delivery_stage: "ZGLOSZENIE",
        responsibility: "CLIENT",
        required_evidence: "Karta Usługi z BUR.",
        signature_requirement: "NOT_REQUIRED",
        source_file_source_ids: [],
      },
    ],
  };

  assert.equal(
    stateMigrations.migrateFileClassificationsToDocumentRequirements(state),
    true,
  );

  const template = state.documentRequirements.find(
    (row) => row.id === "doc-template",
  );
  const info = state.documentRequirements.find((row) => row.id === "doc-info");
  const noTemplate = state.documentRequirements.find(
    (row) => row.id === "doc-no-template",
  );

  assert.equal(template.original_file_source_id, "template-file");
  assert.equal(template.delivery_stage, undefined);
  assert.equal(template.responsibility, undefined);
  assert.equal(template.required_evidence, undefined);

  const templateFile = state.fileSources.find(
    (source) => source.id === "template-file",
  );
  assert.equal(templateFile.delivery_stage, undefined);
  assert.equal(templateFile.responsibility, undefined);
  assert.equal(templateFile.required_evidence, undefined);

  assert.equal(info.fulfillment_mode, "WITHOUT_OPERATOR_TEMPLATE");
  assert.equal(info.original_file_source_id, undefined);
  assert.deepEqual(info.source_file_source_ids, ["info-file"]);
  assert.equal(info.delivery_stage, undefined);
  assert.equal(info.responsibility, undefined);
  assert.equal(info.required_evidence, undefined);

  assert.equal(noTemplate.delivery_stage, "ZGLOSZENIE");
  assert.equal(noTemplate.responsibility, "CLIENT");
  assert.equal(noTemplate.required_evidence, "Karta Usługi z BUR.");

  assert.equal(
    stateMigrations.migrateFileClassificationsToDocumentRequirements(state),
    false,
  );
});

test("classified physical files migrate to first-class document requirements once", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [
      {
        id: "round",
        type: "recruitment",
        values: { external_number: "Nabór" },
      },
    ],
    rules: [],
    fileSources: [
      {
        id: "rules",
        objectId: "round",
        fileType: "PDF",
        url: "https://example.test/regulamin.pdf",
        sourcePageUrl: "https://example.test/nabor",
        name: "regulamin.pdf",
        addedAt: "2026-10-01T12:00:00Z",
        display_name: "Regulamin",
        purpose: "Regulamin",
        intended_use: "Zasady udziału.",
        client_requirement: "Informacyjny",
        signature_requirement: "Nie jest wymagany",
        delivery_method: "Z oryginału operatora",
      },
      {
        id: "bank",
        objectId: "round",
        fileType: "PDF",
        url: "https://example.test/bank.pdf",
        sourcePageUrl: "https://example.test/nabor",
        name: "bank.pdf",
        addedAt: "2026-10-01T12:00:00Z",
        display_name: "Potwierdzenie rachunku",
        purpose: "Inny dokument",
        intended_use: "Dokument wymagany przy zgłoszeniu.",
        client_requirement: "Warunkowy",
        signature_requirement: "Nie jest wymagany",
        delivery_method: "Dokument dostarczany bez wzoru operatora",
      },
    ],
    documentRequirements: [],
  };

  assert.equal(
    stateMigrations.migrateFileClassificationsToDocumentRequirements(state),
    true,
  );
  assert.equal(state.documentRequirements.length, 2);

  const rules = state.documentRequirements.find(
    (row) => row.source_file_source_ids?.includes("rules"),
  );
  const bank = state.documentRequirements.find(
    (row) => row.source_file_source_ids?.includes("bank"),
  );
  assert.ok(rules);
  assert.ok(bank);

  assert.equal(rules.requirement, "INFORMATIONAL");
  assert.equal(rules.fulfillment_mode, "WITHOUT_OPERATOR_TEMPLATE");
  assert.equal(rules.original_file_source_id, undefined);

  assert.equal(bank.requirement, "CONDITIONAL");
  assert.equal(bank.fulfillment_mode, "WITHOUT_OPERATOR_TEMPLATE");
  assert.equal(bank.original_file_source_id, undefined);
  assert.equal(bank.condition, "Dokument wymagany przy zgłoszeniu.");

  assert.equal(
    stateMigrations.migrateFileClassificationsToDocumentRequirements(state),
    false,
  );
  assert.equal(state.documentRequirements.length, 2);
});

test("regulation filenames get safe informational defaults", () => {
  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName(
      "5.15_Regulamin-naboru-do-projektu-01.07.2026.pdf",
    ),
    {
      purpose: "Regulamin",
      has_fields: false,
      client_requirement: "Informacyjny",
      signature_requirement: "Nie jest wymagany",
    },
  );
});

test("attachments containing 'do Regulaminu' use the specific document pattern first", () => {
  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName(
      "Zalacznik_nr_1_do_Regulaminu_PUR_cz1_-_wersja__od_22.12.2025.docx",
    ),
    {
      purpose: "Formularz do uzupełnienia",
      has_fields: true,
      client_requirement: "Obowiązkowy",
      signature_requirement: "Wymagany podpisany plik",
    },
  );
});

test("Polish filename normalization keeps ł-based patterns matchable", () => {
  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName(
      "Plan_Usług_Rozwojowych_cz_1_wzór.docx",
    ),
    {
      purpose: "Formularz do uzupełnienia",
      has_fields: true,
      client_requirement: "Obowiązkowy",
      signature_requirement: "Wymagany podpisany plik",
    },
  );
  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName("Wzór_pełnomocnictwa.docx"),
    {
      purpose: "Formularz do uzupełnienia",
      has_fields: true,
      client_requirement: "Warunkowy",
      signature_requirement: "Wymagany podpisany plik",
    },
  );
});

test("common BUR filenames get conservative metadata defaults", () => {
  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName(
      "Zal._nr_7_do_Regulaminu_Instrukcja_statusu_MSP.docx",
    ),
    {
      purpose: "Instrukcja",
      has_fields: false,
      client_requirement: "Informacyjny",
      signature_requirement: "Nie jest wymagany",
    },
  );

  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName(
      "Zal._nr_10_do_Regulaminu_Podstawowa_lista_rankingowa_PUR.docx",
    ),
    {
      purpose: "Inny dokument",
      has_fields: true,
      client_requirement: "Informacyjny",
      signature_requirement: "Nie jest wymagany",
    },
  );

  assert.deepEqual(
    fileMetadata.inferFileMetadataFromName("random_document_123.pdf"),
    {},
  );
});

test("existing files receive filename defaults once and manual unset stays unset", () => {
  const state = {
    version: 1,
    revision: 1,
    objects: [],
    rules: [],
    fileSources: [
      {
        id: "file-1",
        objectId: "project-1",
        fileType: "PDF",
        url: "https://example.test/Regulamin_naboru.pdf",
        name: "Regulamin_naboru.pdf",
        sourcePageUrl: "https://example.test",
        addedAt: "2026-09-28T10:00:00.000Z",
      },
    ],
  };

  assert.equal(stateMigrations.migrateFileMetadataInference(state), true);
  assert.equal(state.fileSources[0].purpose, "Regulamin");
  assert.equal(state.fileSources[0].has_fields, false);
  assert.equal(state.fileSources[0].client_requirement, "Informacyjny");
  assert.equal(state.fileSources[0].signature_requirement, "Nie jest wymagany");
  assert.equal(
    state.fileSources[0].metadataInferenceVersion,
    fileMetadata.FILE_METADATA_INFERENCE_VERSION,
  );

  delete state.fileSources[0].purpose;
  assert.equal(stateMigrations.migrateFileMetadataInference(state), false);
  assert.equal(state.fileSources[0].purpose, undefined);
});
