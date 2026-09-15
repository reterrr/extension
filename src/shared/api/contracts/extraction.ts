import type { ExtractionRule } from "../../types/extraction";

export interface ConcreteValueInput {
  rawValue: string;
  normalizedValue?: string | null;
  tokenClassId: string;
}

export interface FieldEvidenceInput {
  snapshotId: number;
  rule: ExtractionRule;
  values: ConcreteValueInput[];
}

export interface FieldObservationInput {
  objectId: number;
  objectFieldId: number;
  evidence: FieldEvidenceInput[];
}

export interface CreateExtractionRunRequest {
  workflowId: number;
  fieldObservations: FieldObservationInput[];
}
