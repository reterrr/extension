import type { Nabor, Operator, Projekt } from "./business";

export * from "./business";

/** The only three business DTO shapes consumed by the frontend. */
export type DomainDto = Projekt | Operator | Nabor;

export interface FocusPayload {
  objectId?: string;
  tabId?: number;
  stamp: string;
  note?: string;
  error?: string;
}
