import type { Settings } from "../shared/monitoring/contracts";

export function agentFetch(
  settings: Settings,
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
    timeout?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const { method = "POST", body, signal, timeout = 25_000, headers } = options;
  return fetch(settings.apiOrigin + "/monitoring/" + endpoint, {
    method,
    headers: {
      ...headers,
      Authorization: "Bearer " + settings.agentToken,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(signal ? [signal] : []),
    ]),
  });
}
