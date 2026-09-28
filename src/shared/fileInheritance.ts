import type {
  LegacyStorageState,
  LegacyStoredFileSource,
  LegacyStoredObject,
} from "./types/legacy-storage";

export interface ProjectFileInheritanceStatus {
  project?: LegacyStoredObject;
  projectFiles: LegacyStoredFileSource[];
  pendingFiles: LegacyStoredFileSource[];
  inheritedFiles: LegacyStoredFileSource[];
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

  return {
    project,
    projectFiles,
    pendingFiles,
    inheritedFiles,
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
    "document_kind",
    "delivery_method",
  ] as const) {
    const value = source[field];
    if (value !== undefined) {
      (target as unknown as Record<string, unknown>)[field] = value;
    }
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
  skipped: number;
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
  if (!status.projectFiles.length) {
    throw new Error("Przypisany projekt nie ma plików do skopiowania.");
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
      copiedFromProjectId: status.project!.id,
      copiedFromFileSourceId: source.id,
      copiedAt: now,
    };
    copyOptionalMetadata(copy, source);
    sources.push(copy);
    return copy;
  });

  return {
    project: status.project,
    copied,
    skipped: status.projectFiles.length - copied.length,
  };
}
