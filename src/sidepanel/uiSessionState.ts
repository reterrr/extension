export type SidepanelMode = "commit" | "view" | "import";

export interface SidepanelActiveField {
  objectId: string;
  field: string;
  target?: { kind: string; id: string };
  context?: string;
}

export interface SidepanelUiState {
  version: 1;
  mode: SidepanelMode;
  scroll: {
    commit: number;
    view: number;
    import: number;
  };
  workspace: {
    objectId?: string;
    focusStamp: string;
    active: SidepanelActiveField | null;
    expanded: string[];
    fieldSections: Record<string, boolean>;
    fundingSize: string;
    captureCollapsed: boolean;
    panels: Record<string, boolean>;
    geography: {
      role: string;
      type: string;
      query: string;
      addOpen: boolean;
    };
    switcher: {
      query: string;
      type: string;
      scrollTop: number;
    };
  };
}

const PREFIX = "burbot:sidepanel-ui:";
let writeQueue: Promise<void> = Promise.resolve();

function key(windowId: number): string {
  return PREFIX + String(windowId);
}

function finiteScroll(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function defaultState(): SidepanelUiState {
  return {
    version: 1,
    mode: "view",
    scroll: {
      commit: 0,
      view: 0,
      import: 0,
    },
    workspace: {
      focusStamp: "",
      active: null,
      expanded: [],
      fieldSections: {},
      fundingSize: "",
      captureCollapsed: false,
      panels: {},
      geography: {
        role: "OBEJMUJE",
        type: "WOJEWODZTWO",
        query: "",
        addOpen: false,
      },
      switcher: {
        query: "",
        type: "all",
        scrollTop: 0,
      },
    },
  };
}

export function normalizeSidepanelUiState(value: unknown): SidepanelUiState {
  const fallback = defaultState();
  if (!value || typeof value !== "object") return fallback;

  const raw = value as Partial<SidepanelUiState> & {
    mode?: unknown;
    scroll?: Record<string, unknown>;
  };
  const workspace =
    raw.workspace && typeof raw.workspace === "object"
      ? raw.workspace
      : fallback.workspace;
  const scroll =
    raw.scroll && typeof raw.scroll === "object"
      ? raw.scroll
      : fallback.scroll;
  const switcher =
    workspace.switcher && typeof workspace.switcher === "object"
      ? workspace.switcher
      : fallback.workspace.switcher;
  const geography =
    workspace.geography && typeof workspace.geography === "object"
      ? workspace.geography
      : fallback.workspace.geography;

  const active =
    workspace.active &&
    typeof workspace.active === "object" &&
    typeof workspace.active.objectId === "string" &&
    typeof workspace.active.field === "string"
      ? {
          objectId: workspace.active.objectId,
          field: workspace.active.field,
          ...(workspace.active.target &&
          typeof workspace.active.target.kind === "string" &&
          typeof workspace.active.target.id === "string"
            ? {
                target: {
                  kind: workspace.active.target.kind,
                  id: workspace.active.target.id,
                },
              }
            : {}),
          ...(typeof workspace.active.context === "string"
            ? { context: workspace.active.context }
            : {}),
        }
      : null;

  const rawMode = String(raw.mode ?? "");
  const mode: SidepanelMode =
    rawMode === "commit"
      ? "commit"
      : rawMode === "import" || rawMode === "review"
        ? "import"
        : "view";
  const scrollRecord = scroll as Record<string, unknown>;
  return {
    version: 1,
    mode,
    scroll: {
      commit: finiteScroll(scrollRecord.commit),
      view: finiteScroll(scrollRecord.view ?? scrollRecord.workspace),
      import: finiteScroll(scrollRecord.import ?? scrollRecord.review),
    },
    workspace: {
      ...(typeof workspace.objectId === "string" && workspace.objectId
        ? { objectId: workspace.objectId }
        : {}),
      focusStamp:
        typeof workspace.focusStamp === "string" ? workspace.focusStamp : "",
      active,
      expanded: Array.isArray(workspace.expanded)
        ? [...new Set(workspace.expanded.filter((entry): entry is string => typeof entry === "string"))]
        : [],
      fieldSections:
        workspace.fieldSections &&
        typeof workspace.fieldSections === "object" &&
        !Array.isArray(workspace.fieldSections)
          ? Object.fromEntries(
              Object.entries(workspace.fieldSections).filter(
                ([key, open]) => Boolean(key) && typeof open === "boolean",
              ),
            )
          : {},
      fundingSize:
        typeof workspace.fundingSize === "string" ? workspace.fundingSize : "",
      captureCollapsed: workspace.captureCollapsed === true,
      panels:
        workspace.panels &&
        typeof workspace.panels === "object" &&
        !Array.isArray(workspace.panels)
          ? Object.fromEntries(
              Object.entries(workspace.panels).filter(
                ([id, open]) => Boolean(id) && typeof open === "boolean",
              ),
            )
          : {},
      geography: {
        role: typeof geography.role === "string" ? geography.role : "OBEJMUJE",
        type:
          typeof geography.type === "string"
            ? geography.type
            : "WOJEWODZTWO",
        query: typeof geography.query === "string" ? geography.query : "",
        addOpen: geography.addOpen === true,
      },
      switcher: {
        query: typeof switcher.query === "string" ? switcher.query : "",
        type: typeof switcher.type === "string" ? switcher.type : "all",
        scrollTop: finiteScroll(switcher.scrollTop),
      },
    },
  };
}

export async function readSidepanelUiState(
  windowId: number,
): Promise<SidepanelUiState> {
  const storageKey = key(windowId);
  const stored = await browser.storage.session.get(storageKey);
  return normalizeSidepanelUiState(stored[storageKey]);
}

export type SidepanelUiPatch = Partial<
  Omit<SidepanelUiState, "version" | "scroll" | "workspace">
> & {
  scroll?: Partial<SidepanelUiState["scroll"]>;
  workspace?: Partial<
    Omit<
      SidepanelUiState["workspace"],
      "fieldSections" | "panels" | "geography" | "switcher"
    >
  > & {
    fieldSections?: Record<string, boolean>;
    panels?: Record<string, boolean>;
    geography?: Partial<SidepanelUiState["workspace"]["geography"]>;
    switcher?: Partial<SidepanelUiState["workspace"]["switcher"]>;
  };
};

function mergeState(
  current: SidepanelUiState,
  patch: SidepanelUiPatch,
): SidepanelUiState {
  const workspacePatch = patch.workspace ?? {};
  return normalizeSidepanelUiState({
    ...current,
    ...patch,
    scroll: {
      ...current.scroll,
      ...(patch.scroll ?? {}),
    },
    workspace: {
      ...current.workspace,
      ...workspacePatch,
      fieldSections: {
        ...current.workspace.fieldSections,
        ...(workspacePatch.fieldSections ?? {}),
      },
      panels: {
        ...current.workspace.panels,
        ...(workspacePatch.panels ?? {}),
      },
      geography: {
        ...current.workspace.geography,
        ...(workspacePatch.geography ?? {}),
      },
      switcher: {
        ...current.workspace.switcher,
        ...(workspacePatch.switcher ?? {}),
      },
    },
  });
}

export function patchSidepanelUiState(
  windowId: number,
  patch: SidepanelUiPatch,
): Promise<void> {
  const storageKey = key(windowId);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readSidepanelUiState(windowId);
      const next = mergeState(current, patch);
      await browser.storage.session.set({ [storageKey]: next });
    });
  return writeQueue;
}

export function sidepanelUiStorageKey(windowId: number): string {
  return key(windowId);
}
