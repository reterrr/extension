import type {
  LegacyStorageState,
  LegacyStoredGeography,
  LegacyStoredObject,
} from "./types/legacy-storage";

export interface GeographyInheritanceStatus {
  project?: LegacyStoredObject;
  operatorAssigned: boolean;
  projectOperatorAssigned: boolean;
  projectGeographies: LegacyStoredGeography[];
  inheritedGeographies: LegacyStoredGeography[];
  pendingGeographies: LegacyStoredGeography[];
}

export interface FundingInheritanceStatus {
  project?: LegacyStoredObject;
  projectVariants: Array<Record<string, unknown>>;
  inheritedVariants: Array<Record<string, unknown>>;
  pendingVariants: Array<Record<string, unknown>>;
}

function projectForRecruitment(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): LegacyStoredObject | undefined {
  if (recruitment.type !== "recruitment") return undefined;
  const projectId = recruitment.values?.project_id;
  if (typeof projectId !== "string" || !projectId) return undefined;
  return state.objects.find(
    (object) =>
      object.type === "project" &&
      (object.id === projectId || object.importKey === projectId),
  );
}

function geographyKey(row: Pick<LegacyStoredGeography, "type" | "role" | "value">): string {
  return [row.type, row.role, row.value].join("\u001f");
}

export function geographyInheritanceStatus(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
  operatorId: string,
): GeographyInheritanceStatus {
  const project = projectForRecruitment(state, recruitment);
  const operatorAssigned =
    !!operatorId &&
    (state.operatorAssignments ?? []).some(
      (row) =>
        row.objectId === recruitment.id &&
        row.operatorId === operatorId,
    );
  const projectOperatorAssigned =
    !!project &&
    !!operatorId &&
    (state.operatorAssignments ?? []).some(
      (row) =>
        row.objectId === project.id &&
        row.operatorId === operatorId,
    );

  if (!project || !operatorAssigned || !projectOperatorAssigned) {
    return {
      project,
      operatorAssigned,
      projectOperatorAssigned,
      projectGeographies: [],
      inheritedGeographies: [],
      pendingGeographies: [],
    };
  }

  const allGeographies = state.geographies ?? [];
  const projectGeographies = allGeographies.filter(
    (row) =>
      row.objectId === project.id &&
      row.operatorId === operatorId,
  );
  const recruitmentGeographies = allGeographies.filter(
    (row) =>
      row.objectId === recruitment.id &&
      row.operatorId === operatorId,
  );
  const inheritedGeographies = recruitmentGeographies.filter(
    (row) => row.copiedFromProjectId === project.id,
  );
  const copiedSourceIds = new Set(
    inheritedGeographies
      .map((row) => row.copiedFromGeographyId)
      .filter((value): value is string => typeof value === "string" && !!value),
  );
  const existingKeys = new Set(recruitmentGeographies.map(geographyKey));

  const pendingGeographies = projectGeographies.filter(
    (row) =>
      !copiedSourceIds.has(row.id) &&
      !existingKeys.has(geographyKey(row)),
  );

  return {
    project,
    operatorAssigned,
    projectOperatorAssigned,
    projectGeographies,
    inheritedGeographies,
    pendingGeographies,
  };
}

export function fundingInheritanceStatus(
  state: LegacyStorageState,
  recruitment: LegacyStoredObject,
): FundingInheritanceStatus {
  const project = projectForRecruitment(state, recruitment);
  if (!project) {
    return {
      project: undefined,
      projectVariants: [],
      inheritedVariants: [],
      pendingVariants: [],
    };
  }

  const rows = state.financingRules ?? [];
  const projectVariants = rows.filter(
    (row) => String(row.objectId ?? "") === project.id,
  );
  const recruitmentVariants = rows.filter(
    (row) => String(row.objectId ?? "") === recruitment.id,
  );
  const inheritedVariants = recruitmentVariants.filter(
    (row) => String(row.copiedFromProjectId ?? "") === project.id,
  );
  const copiedSourceIds = new Set(
    inheritedVariants
      .map((row) => row.copiedFromFundingRuleId)
      .filter((value): value is string => typeof value === "string" && !!value),
  );
  const pendingVariants = projectVariants.filter(
    (row) => !copiedSourceIds.has(String(row.id ?? "")),
  );

  return {
    project,
    projectVariants,
    inheritedVariants,
    pendingVariants,
  };
}

export function copyProjectGeographiesToRecruitment(
  state: LegacyStorageState,
  recruitmentId: string,
  operatorId: string,
  idFactory: () => string,
  now: string,
): { copied: LegacyStoredGeography[]; project: LegacyStoredObject } {
  const recruitment = state.objects.find(
    (object) => object.id === recruitmentId,
  );
  if (!recruitment || recruitment.type !== "recruitment") {
    throw new Error("Wybierz nabór.");
  }

  const status = geographyInheritanceStatus(state, recruitment, operatorId);
  if (!status.project) {
    throw new Error("Najpierw przypisz projekt do naboru.");
  }
  if (!operatorId) {
    throw new Error("Najpierw wybierz operatora.");
  }
  if (!status.operatorAssigned) {
    throw new Error("Wybrany operator nie jest przypisany do tego naboru.");
  }
  if (!status.projectOperatorAssigned) {
    throw new Error(
      "Wybrany operator nie jest przypisany do projektu. Geografia projektu jest teraz operatorowa.",
    );
  }
  if (!status.projectGeographies.length) {
    throw new Error(
      "Przypisany projekt nie ma geografii dla wybranego operatora.",
    );
  }
  if (!status.pendingGeographies.length) {
    throw new Error(
      "Brak nowych elementów geografii projektu do skopiowania dla tego operatora.",
    );
  }

  const rows = (state.geographies ||= []);
  const copied = status.pendingGeographies.map((source) => {
    const copy: LegacyStoredGeography = {
      id: idFactory(),
      objectId: recruitment.id,
      operatorId,
      type: source.type,
      role: source.role,
      value: source.value,
      copiedFromProjectId: status.project!.id,
      copiedFromGeographyId: source.id,
      copiedAt: now,
    };
    rows.push(copy);
    return copy;
  });

  return { copied, project: status.project };
}

const FUNDING_COPY_IGNORED = new Set([
  "id",
  "objectId",
  "importKey",
  "variant_no",
  "copiedFromProjectId",
  "copiedFromFundingRuleId",
  "copiedAt",
]);

function nextVariantNo(
  rows: Array<Record<string, unknown>>,
  objectId: string,
  companySize: string,
  preferred: number,
): number {
  const used = new Set(
    rows
      .filter(
        (row) =>
          String(row.objectId ?? "") === objectId &&
          String(row.company_size ?? "") === companySize,
      )
      .map((row) => Number(row.variant_no))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  if (Number.isInteger(preferred) && preferred > 0 && !used.has(preferred)) {
    return preferred;
  }
  let candidate = 1;
  while (used.has(candidate)) candidate++;
  return candidate;
}

export function copyProjectFundingToRecruitment(
  state: LegacyStorageState,
  recruitmentId: string,
  idFactory: () => string,
  now: string,
): { copied: Array<Record<string, unknown>>; project: LegacyStoredObject } {
  const recruitment = state.objects.find(
    (object) => object.id === recruitmentId,
  );
  if (!recruitment || recruitment.type !== "recruitment") {
    throw new Error("Wybierz nabór.");
  }

  const status = fundingInheritanceStatus(state, recruitment);
  if (!status.project) {
    throw new Error("Najpierw przypisz projekt do naboru.");
  }
  if (!status.projectVariants.length) {
    throw new Error("Przypisany projekt nie ma wariantów dofinansowania do skopiowania.");
  }
  if (!status.pendingVariants.length) {
    throw new Error("Brak nowych wariantów projektu do skopiowania.");
  }

  const rows = (state.financingRules ||= []);
  const copied = status.pendingVariants.map((source) => {
    const companySize = String(source.company_size ?? "");
    const sourceVariantNo = Number(source.variant_no ?? 1);
    const copy: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
      if (FUNDING_COPY_IGNORED.has(key)) continue;
      copy[key] =
        value && typeof value === "object"
          ? JSON.parse(JSON.stringify(value))
          : value;
    }

    copy.id = idFactory();
    copy.objectId = recruitment.id;
    copy.company_size = companySize;
    copy.variant_no = nextVariantNo(
      rows,
      recruitment.id,
      companySize,
      sourceVariantNo,
    );
    copy.copiedFromProjectId = status.project!.id;
    copy.copiedFromFundingRuleId = String(source.id ?? "");
    copy.copiedAt = now;
    rows.push(copy);
    return copy;
  });

  return { copied, project: status.project };
}
