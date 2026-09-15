import type { ExecutableExtractionRule } from "./extraction";

export type ObjectType = "project" | "recruitment" | "operator" | "nabor";

export interface BurbotObject {
  id: string;
  type: ObjectType;
  label?: string;
  values: Record<string, unknown>;
  sourceUrl?: string;
  creationNote?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type BurbotRule = ExecutableExtractionRule & {
  objectId: string;
  field: string;
  sampleValue?: string;
  target?: { kind: string; id: string };
  transform?: { sample: string; value: unknown };
  createdAt?: string;
};

export interface BurbotState {
  version: 1;
  revision: number;
  objects: BurbotObject[];
  rules: BurbotRule[];
  financingRules?: Array<Record<string, unknown>>;
  documentRequirements?: Array<Record<string, unknown>>;
}

export interface FocusPayload {
  objectId?: string;
  tabId?: number;
  stamp: string;
  note?: string;
  error?: string;
}
