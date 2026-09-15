import type { BurbotState } from "../types/domain";

export type DataOperation =
  | "GET"
  | "GET_FOCUS"
  | "ASSIGN"
  | "EDIT"
  | "APPLY"
  | "DELETE"
  | "ADD_FUNDING"
  | "REMOVE_FUNDING";

export interface DataResponse<T = BurbotState> {
  ok: boolean;
  value?: T;
  error?: string;
}

export async function sendData<T = BurbotState>(
  op: DataOperation,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op,
    ...payload,
  })) as DataResponse<T>;

  if (!response?.ok) {
    throw new Error(response?.error ?? "Burbot background service is unavailable.");
  }

  return response.value as T;
}
