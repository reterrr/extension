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

test("unsupported remote file extensions are rejected", () => {
  for (const extension of ["html", "zip", "xls", "gif", "webp"]) {
    assert.throws(
      () =>
        remoteFile.createRemoteFileSourceCandidate(
          `https://projekt.test/files/sample.${extension}`,
          "https://projekt.test/nabor",
        ),
      /\.doc/,
    );
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


test("project files are inherited as independent recruitment copies", () => {
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
        client_requirement: "Wymagany",
        signature_requirement: "Nie wymaga podpisu",
        sourceImportKey: "project-pdf-import",
        sourcePageImportKey: "project-page-import",
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

  assert.equal(result.copied.length, 1);
  const copy = state.fileSources.find(
    (file) => file.objectId === "recruitment-1",
  );
  assert.ok(copy);
  assert.notEqual(copy.id, "project-file-1");
  assert.equal(copy.url, "https://example.test/regulamin.pdf");
  assert.equal(copy.display_name, "Regulamin projektu");
  assert.equal(copy.purpose, "Regulamin / zasady");
  assert.equal(copy.copiedFromProjectId, "project-1");
  assert.equal(copy.copiedFromFileSourceId, "project-file-1");
  assert.equal(copy.copiedAt, "2026-09-28T16:00:00.000Z");
  assert.equal(copy.sourceImportKey, undefined);
  assert.equal(copy.sourcePageImportKey, undefined);

  const projectFile = state.fileSources.find(
    (file) => file.id === "project-file-1",
  );
  projectFile.display_name = "NOWA nazwa na projekcie";
  projectFile.purpose = "Inny cel";
  projectFile.url = "https://example.test/regulamin-v2.pdf";

  assert.equal(copy.display_name, "Regulamin projektu");
  assert.equal(copy.purpose, "Regulamin / zasady");
  assert.equal(copy.url, "https://example.test/regulamin.pdf");

  state.fileSources = state.fileSources.filter(
    (file) => file.id !== "project-file-1",
  );
  state.objects = state.objects.filter((object) => object.id !== "project-1");

  assert.ok(
    state.fileSources.some(
      (file) =>
        file.id === copy.id &&
        file.objectId === "recruitment-1" &&
        file.url === "https://example.test/regulamin.pdf",
    ),
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
