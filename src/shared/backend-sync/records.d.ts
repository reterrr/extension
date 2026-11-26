import type { LegacyStorageState } from "../types/legacy-storage";
import type {
  EntityDefinition,
  FieldDefinition,
  Identity,
  Registry,
} from "./types";

export interface LocalRecord {
  identity: Identity;
  label: string;
  values: Record<string, unknown>;
}

export function identityKey(identity: Identity): string;
export function same(before: unknown, after: unknown): boolean;
export function entityFor(
  registry: Registry,
  identity: Identity,
): EntityDefinition | undefined;
export function fieldFor(
  registry: Registry,
  identity: Identity,
  localKey: string,
): FieldDefinition | undefined;
export function localRecords(state: LegacyStorageState): LocalRecord[];
