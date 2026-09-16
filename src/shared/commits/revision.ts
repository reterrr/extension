export function withAuthoritativeDraftRevision<T extends Record<string, unknown>>(
  message: T,
  workingRevision: number,
): T & { expectedRevision: number } {
  return {
    ...message,
    expectedRevision: workingRevision,
  };
}
