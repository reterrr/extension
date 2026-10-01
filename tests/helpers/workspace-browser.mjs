import { build } from "esbuild";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
export const reviewRuntime = await build({
  stdin: {
    contents:
      'export * from "./src/shared/commits/review.ts"; export * from "./src/shared/commits/session.ts"; export * from "./src/shared/commits/summary.ts";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ReviewTest",
  platform: "browser",
  logLevel: "silent",
});
const sourceUrl = "https://example.org/nabor";
export const state = {
  version: 1,
  revision: 1,
  rules: [],
  geographies: [],
  operatorAssignments: [],
  operatorContacts: [],
  documentRequirements: [],
  fieldEvidence: [],
  objects: [
    {
      id: "operator",
      type: "operator",
      values: { name: "Rzeszowska Agencja Rozwoju", nip: "8130010538" },
    },
    {
      id: "operator-b",
      type: "operator",
      values: {
        name: "Regionalny Fundusz Rozwoju Kompetencji i Przedsiębiorczości",
      },
    },
    {
      id: "call",
      type: "recruitment",
      sourceUrl,
      values: {
        external_number:
          "Nabór 3/2026 — rozwój kompetencji przedsiębiorców i ich pracowników",
        project_id: "project",
        status: "AKTYWNY",
        year: 2026,
        start_date: "2026-09-01",
        end_date: "2026-10-30",
      },
    },
    {
      id: "project",
      type: "project",
      sourceUrl,
      values: {
        name: "Małopolski program rozwoju kompetencji",
        type: "B2B",
        status: "AKTYWNY",
      },
    },
  ],
  financingRules: [
    {
      id: "funding-1",
      objectId: "call",
      company_size: "MICRO",
      variant_no: 1,
      refund_percent_max: 80,
    },
  ],
  fileSources: [
    {
      id: "rules",
      objectId: "call",
      name: "Regulamin_naboru_3_2026.pdf",
      fileType: "PDF",
      url: "https://example.org/regulamin.pdf",
      sourcePageUrl: sourceUrl,
      purpose: "Regulamin",
      client_requirement: "Informacyjny",
      has_fields: false,
      display_name: "Regulamin naboru",
      intended_use: "Warunki udziału, dokumenty i terminy.",
    },
  ],
};

export function installBrowserMock(seed, sessionSeed = {}) {
  const copy = (value) => structuredClone(value);
  const event = () => {
    const listeners = new Set();
    return {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      emit: (...args) => [...listeners].forEach((fn) => fn(...args)),
    };
  };
  const onChanged = event();
  const onMessage = event();
  const storage = (area, initial = {}) => {
    const values = copy(initial);
    return {
      get: async (keys) =>
        Object.fromEntries(
          (keys == null
            ? Object.keys(values)
            : Array.isArray(keys)
              ? keys
              : [keys]
          ).map((key) => [key, copy(values[key])]),
        ),
      set: async (next) => {
        const changes = {};
        for (const [key, value] of Object.entries(next)) {
          if (JSON.stringify(values[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: copy(values[key]), newValue: copy(value) };
          values[key] = copy(value);
        }
        if (Object.keys(changes).length) onChanged.emit(changes, area);
      },
      remove: async (key) => {
        const oldValue = values[key];
        delete values[key];
        onChanged.emit({ [key]: { oldValue } }, area);
      },
    };
  };
  window.__uiState = copy(seed);
  window.__uiMessages = [];
  window.__uiInjections = [];
  window.__uiCommitted = copy(seed);
  window.__uiDraft = null;
  const runtime = window.ReviewTest;
  const ensureDraft = () =>
    (window.__uiDraft ??= {
      id: "ui-draft",
      createdAt: "2026-09-30",
      updatedAt: "2026-09-30",
      baseRevision: window.__uiCommitted.revision,
      baseState: copy(window.__uiCommitted),
      workingState: copy(window.__uiState),
      stagedObjectIds: [],
      reviewVersion: 1,
    });
  const publish = () => {
    window.__uiState = copy(
      window.__uiDraft?.workingState ?? window.__uiCommitted,
    );
    onMessage.emit({
      type: "BURBOT_WORKSPACE_STATE_CHANGED",
      updateId: crypto.randomUUID(),
      state: copy(window.__uiState),
    });
    onMessage.emit({ type: "BURBOT_COMMIT_CHANGED" });
    window.dispatchEvent(new Event("burbot:commit-changed"));
  };
  window.browser = {
    storage: {
      onChanged,
      local: storage("local"),
      session: storage("session", {
        "burbot:workflow-mode": "view",
        "burbot:object-view": {
          version: 1,
          objectIds: ["call", "project"],
          query: "",
          type: "all",
          createdAt: "2026-09-28",
        },
        ...sessionSeed,
      }),
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    runtime: {
      onMessage,
      connect: () => ({ postMessage() {}, disconnect() {} }),
      getURL: (path) => location.origin + "/" + path,
      sendMessage: async (message) => {
        window.__uiMessages.push(copy(message));
        if (message.type === "BURBOT_COMMIT") {
          if (message.op === "SUMMARY")
            return { ok: true, value: runtime.commitSummary(window.__uiDraft) };
          if (message.op === "FOCUS")
            onMessage.emit({
              ...message,
              type: "BURBOT_FOCUS",
              stamp: crypto.randomUUID(),
            });
          if (message.op === "NEW") ensureDraft();
          if (message.op === "REVIEW_CHANGE") {
            await new Promise((resolve) => setTimeout(resolve, 10));
            runtime.decideReviewChange(
              ensureDraft(),
              message.changeId,
              message.decision,
              message.fingerprint,
            );
            publish();
          }
          if (message.op === "REVIEW_ALL") {
            const d = ensureDraft();
            runtime.decideAllReviewChanges(
              d,
              message.decision,
              message.objectId,
            );
            publish();
          }
          if (message.op === "COMMIT") {
            const d = ensureDraft();
            runtime.validateReviewSelection(d, message.expectedReview);
            const saved = runtime.applyReviewedChanges(d);
            saved.revision += 1;
            window.__uiCommitted = copy(saved);
            runtime.rebaseReviewedChanges(d, saved);
            publish();
            return {
              ok: true,
              value: { session: runtime.commitSessionView(d) },
            };
          }
          return {
            ok: true,
            value: runtime.commitSessionView(window.__uiDraft),
          };
        }
        if (message.type === "BURBOT_DATA") {
          if (message.op === "GET_FOCUS") return { ok: true, value: null };
          if (message.op !== "GET") {
            const d = ensureDraft();
            window.__uiState = window.BurbotCore.mutate(
              window.__uiState,
              message,
              () => crypto.randomUUID(),
              new Date().toISOString(),
            );
            window.__uiState.revision = d.baseRevision;
            d.workingState = copy(window.__uiState);
            runtime.refreshReviewDecisions(d);
            publish();
          }
          return { ok: true, value: copy(window.__uiState) };
        }
        return { ok: true, value: null };
      },
    },
    tabs: {
      query: async () => [
        { id: 1, windowId: 1, url: "https://example.org/nabor" },
      ],
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
      sendMessage: async () => ({ ok: true }),
      connect: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          disconnect() {},
          postMessage(message) {
            queueMicrotask(() =>
              port.onMessage.emit({
                id: message.id,
                ok: true,
                value:
                  message.op === "URL" ? "https://example.org/nabor" : true,
              }),
            );
          },
        };
        return port;
      },
    },
    scripting: {
      executeScript: async (input) => {
        window.__uiInjections.push(copy(input));
        return [];
      },
    },
  };
}
