import {
  FILE_METADATA_INFERENCE_VERSION,
  inferFileMetadataFromName,
} from "./fileMetadata";
import type {
  LegacyStorageState,
  LegacyStoredDocumentRequirement,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "./types/legacy-storage";

export interface ProjectFileInheritanceStatus {
  project?: LegacyStoredObject;
  projectFiles: LegacyStoredFileSource[];
  pendingFiles: LegacyStoredFileSource[];
  inheritedFiles: LegacyStoredFileSource[];
  projectRequirements: LegacyStoredDocumentRequirement[];
  pendingRequirements: LegacyStoredDocumentRequirement[];
  inheritedRequirements: LegacyStoredDocumentRequirement[];
  projectDocumentCount: number;
  pendingDocumentCount: number;
  inheritedDocumentCount: number;
}

function recruitmentProjectId(recruitment: LegacyStoredObject): string | null {
  const projectId = recruitment.values?.project_id;
  return typeof projectId === "string" && projectId ? projectId : null;
}

export function projectForRecruitment(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): LegacyStoredObject | undefined {
  if (recruitment.type !== "recruitment") return undefined;
  const projectId = recruitmentProjectId(recruitment);
  if (!projectId) return undefined;
  return state.objects.find(
    (object) =>
      object.type === "project" &&
      (object.id === projectId || object.importKey === projectId),
  );
}

function linkedFileIdForRequirement(
  row: LegacyStoredDocumentRequirement,
  files: LegacyStoredFileSource[],
): string | undefined {
  if (
    row.original_file_source_id &&
    files.some((file) => file.id === row.original_file_source_id)
  ) {
    return row.original_file_source_id;
  }
  const label = row.label?.trim().toLocaleLowerCase("pl-PL") ?? "";
  return files.find(
    (file) =>
      (row.source_file_source_ids ?? []).includes(file.id) &&
      (file.display_name?.trim() || file.name)
        .trim()
        .toLocaleLowerCase("pl-PL") === label,
  )?.id;
}

function requirementSignature(row: LegacyStoredDocumentRequirement): string {
  return [
    row.importKey || "",
    row.label?.trim().toLocaleLowerCase("pl-PL") || "",
    row.fulfillment_mode || "",
    row.requirement || "",
  ].join("\u001f");
}

export function projectFileInheritanceStatus(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): ProjectFileInheritanceStatus {
  const project = projectForRecruitment(state, recruitment);
  if (!project) {
    return {
      project: undefined,
      projectFiles: [],
      pendingFiles: [],
      inheritedFiles: [],
      projectRequirements: [],
      pendingRequirements: [],
      inheritedRequirements: [],
      projectDocumentCount: 0,
      pendingDocumentCount: 0,
      inheritedDocumentCount: 0,
    };
  }

  const allFiles = state.fileSources ?? [];
  const projectFiles = allFiles.filter((file) => file.objectId === project.id);
  const recruitmentFiles = allFiles.filter(
    (file) => file.objectId === recruitment.id,
  );
  const inheritedFiles = recruitmentFiles.filter(
    (file) => file.copiedFromProjectId === project.id,
  );

  const inheritedSourceIds = new Set(
    inheritedFiles
      .map((file) => file.copiedFromFileSourceId)
      .filter((value): value is string => typeof value === "string" && !!value),
  );
  const recruitmentUrls = new Set(
    recruitmentFiles.map((file) => file.url).filter(Boolean),
  );

  const pendingFiles = projectFiles.filter(
    (file) =>
      !inheritedSourceIds.has(file.id) &&
      !recruitmentUrls.has(file.url),
  );

  const allRequirements = state.documentRequirements ?? [];
  const projectRequirements = allRequirements.filter(
    (row) => row.objectId === project.id,
  );
  const recruitmentRequirements = allRequirements.filter(
    (row) => row.objectId === recruitment.id,
  );
  const inheritedRequirements = recruitmentRequirements.filter(
    (row) => row.copiedFromProjectId === project.id,
  );
  const inheritedRequirementIds = new Set(
    inheritedRequirements
      .map((row) => row.copiedFromDocumentRequirementId)
      .filter((value): value is string => typeof value === "string" && !!value),
  );
  const existingRequirementSignatures = new Set(
    recruitmentRequirements.map(requirementSignature),
  );
  const pendingRequirements = projectRequirements.filter(
    (row) =>
      !inheritedRequirementIds.has(row.id) &&
      !existingRequirementSignatures.has(requirementSignature(row)),
  );

  const representedProjectFileIds = new Set(
    projectRequirements
      .map((row) => linkedFileIdForRequirement(row, projectFiles))
      .filter((value): value is string => Boolean(value)),
  );
  const representedPendingFileIds = new Set(
    pendingRequirements
      .map((row) => linkedFileIdForRequirement(row, projectFiles))
      .filter((value): value is string => Boolean(value)),
  );
  const representedInheritedFileIds = new Set(
    inheritedRequirements
      .map((row) => linkedFileIdForRequirement(row, recruitmentFiles))
      .filter((value): value is string => Boolean(value)),
  );
  const projectDocumentCount =
    projectRequirements.length +
    projectFiles.filter((file) => !representedProjectFileIds.has(file.id)).length;
  const pendingDocumentCount =
    pendingRequirements.length +
    pendingFiles.filter((file) => !representedPendingFileIds.has(file.id)).length;
  const inheritedDocumentCount =
    inheritedRequirements.length +
    inheritedFiles.filter((file) => !representedInheritedFileIds.has(file.id)).length;

  return {
    project,
    projectFiles,
    pendingFiles,
    inheritedFiles,
    projectRequirements,
    pendingRequirements,
    inheritedRequirements,
    projectDocumentCount,
    pendingDocumentCount,
    inheritedDocumentCount,
  };
}

function copyOptionalMetadata(
  target: LegacyStoredFileSource,
  source: LegacyStoredFileSource,
): void {
  for (const field of [
    "display_name",
    "purpose",
    "has_fields",
    "intended_use",
    "client_requirement",
    "signature_requirement",
    "condition",
    "delivery_stage",
    "responsibility",
    "required_evidence",
    "source_url",
    "source_description",
    "document_kind",
    "delivery_method",
  ] as const) {
    const value = source[field];
    if (value !== undefined) {
      (target as unknown as Record<string, unknown>)[field] = value;
    }
  }
}

function fileCopyMap(
  status: ProjectFileInheritanceStatus,
  recruitmentFiles: LegacyStoredFileSource[],
): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const projectFile of status.projectFiles) {
    const inherited = recruitmentFiles.find(
      (file) => file.copiedFromFileSourceId === projectFile.id,
    );
    const sameUrl = recruitmentFiles.find(
      (file) => file.url && file.url === projectFile.url,
    );
    const target = inherited ?? sameUrl;
    if (target) mapping.set(projectFile.id, target.id);
  }
  return mapping;
}

function remapRequirementFiles(
  source: LegacyStoredDocumentRequirement,
  copy: LegacyStoredDocumentRequirement,
  mapping: Map<string, string>,
): void {
  if (source.original_file_source_id) {
    const mapped = mapping.get(source.original_file_source_id);
    if (!mapped) {
      throw new Error(
        `Nie udało się skopiować wzoru operatora dla dokumentu „${source.label}”.`,
      );
    }
    copy.original_file_source_id = mapped;
  } else {
    delete copy.original_file_source_id;
  }

  if (source.source_file_source_ids?.length) {
    copy.source_file_source_ids = source.source_file_source_ids
      .map((sourceId) => mapping.get(sourceId))
      .filter((value): value is string => Boolean(value));
  } else {
    copy.source_file_source_ids = [];
  }
}

export function inheritProjectFilesAsCopies(
  state: LegacyStorageState,
  recruitmentId: string,
  idFactory: () => string,
  now: string,
): {
  project: LegacyStoredObject;
  copied: LegacyStoredFileSource[];
  copiedRequirements: LegacyStoredDocumentRequirement[];
  skipped: number;
  skippedRequirements: number;
} {
  const recruitment = state.objects.find(
    (object) => object.id === recruitmentId,
  );
  if (!recruitment || recruitment.type !== "recruitment") {
    throw new Error("Wybierz nabór.");
  }

  const status = projectFileInheritanceStatus(state, recruitment);
  if (!status.project) {
    throw new Error("Najpierw przypisz projekt do naboru.");
  }
  if (!status.projectFiles.length && !status.projectRequirements.length) {
    throw new Error("Przypisany projekt nie ma dokumentów do skopiowania.");
  }

  const sources = (state.fileSources ||= []);
  const copied = status.pendingFiles.map((source) => {
    const copy: LegacyStoredFileSource = {
      id: idFactory(),
      objectId: recruitment.id,
      fileType: source.fileType,
      url: source.url,
      name: source.name,
      sourcePageUrl: source.sourcePageUrl,
      addedAt: now,
      ...inferFileMetadataFromName(source.name),
      copiedFromProjectId: status.project!.id,
      copiedFromFileSourceId: source.id,
      copiedAt: now,
      metadataInferenceVersion: FILE_METADATA_INFERENCE_VERSION,
    };
    copyOptionalMetadata(copy, source);
    sources.push(copy);
    return copy;
  });

  const recruitmentFiles = sources.filter(
    (file) => file.objectId === recruitment.id,
  );
  const mapping = fileCopyMap(status, recruitmentFiles);
  const requirements = (state.documentRequirements ||= []);
  const copiedRequirements = status.pendingRequirements.map((source) => {
    const copy: LegacyStoredDocumentRequirement = JSON.parse(
      JSON.stringify(source),
    );
    copy.id = idFactory();
    copy.objectId = recruitment.id;
    copy.copiedFromProjectId = status.project!.id;
    copy.copiedFromDocumentRequirementId = source.id;
    copy.copiedAt = now;
    remapRequirementFiles(source, copy, mapping);
    requirements.push(copy);
    return copy;
  });

  return {
    project: status.project,
    copied,
    copiedRequirements,
    skipped: status.projectFiles.length - copied.length,
    skippedRequirements:
      status.projectRequirements.length - copiedRequirements.length,
  };
}
