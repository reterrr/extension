// ============================================================
// Shared primitives
// ============================================================

/** Stored as YYYY-MM-DD in SQLite and used in the frontend unchanged. */
export type ISODate = string;

export enum ProjectType {
  B2B = "B2B",
  B2C = "B2C",
}

export enum ProjectStatus {
  ACTIVE = "ACTIVE",
  CLOSED = "CLOSED",
  SUSPENDED = "SUSPENDED",
  PLANNED = "PLANNED",
}

export enum RecruitmentStatus {
  PLANNED = "PLANNED",
  ANNOUNCED = "ANNOUNCED",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  CLOSED = "CLOSED",
}

export enum RecruitmentClosedStatus {
  END_DATE_EXCEEDED = "END_DATE_EXCEEDED",
  BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED",
  CANCELLED = "CANCELLED",
  OTHER = "OTHER",
}

export enum OperatorType {
  MAIN = "MAIN",
  SECOND = "SECOND",
}

export enum GeographyType {
  WOJEWODZTWO = "WOJEWODZTWO",
  PODREGION = "PODREGION",
  POWIAT = "POWIAT",
  GMINA = "GMINA",
  MIASTO_POWIAT = "MIASTO_POWIAT",
}

export enum GeographyRole {
  INCLUDE = "INCLUDE",
  EXCLUDE = "EXCLUDE",
}

// ============================================================
// Front types
// ============================================================

/**
 * Frontend aggregate for a project.
 *
 * Unlike the SQLite row type, relations are already expanded so the UI does not
 * need to know about join tables.
 */
export interface Project {
  id: bigint;
  type: ProjectType;
  name: string;
  number: string | null;
  status: ProjectStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  announcementsSiteUrl: string | null;

  operators: ProjectOperator[];
  recruitments: Recruitment[];
  geographyGroups: ProjectGeographyGroup[];
}

export interface Recruitment {
  id: bigint;
  projectId: bigint;
  externalNumber: string | null;
  sequenceNumber: number | null;
  year: number | null;
  status: RecruitmentStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  announcedYear: number | null;
  announcedQuarter: 1 | 2 | 3 | 4 | null;
  closedStatus: RecruitmentClosedStatus | null;
  statusReason: string | null;
  announcementUrl: string | null;
}

export interface Operator {
  id: bigint;
  name: string;
  nip: string | null;
}

export interface ProjectOperator {
  operatorType: OperatorType;
  operator: Operator;
}

export interface ProjectGeographyGroup {
  id: bigint;
  geographies: ProjectGeography[];
}

export interface ProjectGeography {
  id: bigint;
  type: GeographyType;
  role: GeographyRole;
  name: string;
}

// ============================================================
// SQLite table row types
// ============================================================

/** One row from `projects`. */
export interface Projects {
  id: bigint;
  type: ProjectType;
  name: string;
  number: string | null;
  status: ProjectStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  announcementsSiteUrl: string | null;
}

/** One row from `recruitments`. */
export interface Recruitments {
  id: bigint;
  projectId: bigint;
  externalNumber: string | null;
  sequenceNumber: number | null;
  year: number | null;
  status: RecruitmentStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  announcedYear: number | null;
  announcedQuarter: 1 | 2 | 3 | 4 | null;
  closedStatus: RecruitmentClosedStatus | null;
  statusReason: string | null;
  announcementUrl: string | null;
}

/** One row from `operators`. */
export interface Operators {
  id: bigint;
  name: string;
  nip: string | null;
}

/** One row from `projects_operators`. */
export interface ProjectsOperators {
  id: bigint;
  projectId: bigint;
  operatorId: bigint;
  operatorType: OperatorType;
}

/**
 * A geography group belongs to a project. Every geography row inside the group
 * is evaluated together when building the project's geographic scope.
 */
export interface GeographyGroup {
  id: bigint;
  projectId: bigint;
}

/** One row from `geography`. */
export interface Geography {
  id: bigint;
  geographyGroupId: bigint;
  type: GeographyType;
  role: GeographyRole;
  name: string;
}
