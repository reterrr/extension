let loading: Promise<void> | undefined;
export function ensureGeographyCatalog(): Promise<void> {
  return (loading ??= import("../shared/domain/geographyRuntime")
    .then(() => {
      window.dispatchEvent(new Event("burbot:geography-catalog-ready"));
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}
