/** Only windows with a live workspace may run page highlighting. */
export function createActiveTabHighlightSync<State>(options: {
  activeTab(
    windowId: number,
  ): Promise<{ id?: number; url?: string } | undefined>;
  state(): Promise<State>;
  sync(
    tabId: number,
    url: string,
    state: State,
    current: () => boolean,
  ): Promise<void>;
  clear(tabId: number): Promise<void>;
}) {
  const windows = new Map<number, number>();
  const painted = new Set<number>();
  let version = 0;
  let running = false;

  async function flush(): Promise<void> {
    if (running) return;
    running = true;
    try {
      let completed: number;
      do {
        completed = version;
        const targets = new Map<number, string>();
        await Promise.all(
          [...windows.keys()].map(async (windowId) => {
            const tab = await options
              .activeTab(windowId)
              .catch(() => undefined);
            if (tab?.id !== undefined && /^https?:\/\//.test(tab.url ?? "")) {
              targets.set(tab.id, tab.url!);
            }
          }),
        );
        if (completed !== version) continue;
        for (const tabId of painted) {
          if (targets.has(tabId)) continue;
          await options.clear(tabId).catch(() => undefined);
          painted.delete(tabId);
        }
        if (!targets.size || completed !== version) continue;
        const state = await options.state();
        for (const [tabId, url] of targets) {
          if (completed !== version) break;
          // Include in cleanup even if navigation interrupts the async send.
          painted.add(tabId);
          await options
            .sync(tabId, url, state, () => completed === version)
            .catch(() => undefined);
        }
      } while (completed !== version);
    } finally {
      running = false;
    }
  }

  function request(): void {
    version++;
    queueMicrotask(() => void flush().catch(() => undefined));
  }

  return {
    request,
    hasWindow: (windowId: number) => windows.has(windowId),
    watch(windowId: number): () => void {
      windows.set(windowId, (windows.get(windowId) ?? 0) + 1);
      request();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        const remaining = (windows.get(windowId) ?? 1) - 1;
        if (remaining) windows.set(windowId, remaining);
        else windows.delete(windowId);
        request();
      };
    },
  };
}
