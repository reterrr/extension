import {
  continuousLocal,
  continuousSignalKey,
  flushQueue,
  inSyncOrder,
  readSyncSettings,
  refreshRegistry,
  syncActionMessage,
  syncSettingsKey,
  type SyncAction,
} from "../shared/backend-sync/client";
import { syncContinuousBatch } from "../shared/backend-sync/continuous";

const alarm = "burbot-continuous-backend-sync";
const notify = () =>
  browser.storage.local
    .set({ [continuousSignalKey]: Date.now() })
    .catch(() => undefined);
let timer: ReturnType<typeof setTimeout> | undefined;
let running: AbortController | undefined;
let requested = false;

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void automatic(), delay);
}

function wakeContinuousSync() {
  if (running) requested = true;
  else schedule(0);
}

export function wakeAfterCommit() {
  void notify();
  wakeContinuousSync();
}

function reconfigure() {
  running?.abort();
  wakeContinuousSync();
}

async function automatic() {
  if (running) return;
  const run = new AbortController();
  running = run;
  let next: number | null = null;
  try {
    const result = await inSyncOrder(async () => {
      const settings = await readSyncSettings();
      if (!settings || run.signal.aborted) return null;
      return syncContinuousBatch(settings, false, run.signal);
    });
    if (result?.changed) await notify();
    if (result?.more) next = 0;
    else if (result?.retryAt != null)
      next = Math.max(0, result.retryAt - Date.now());
  } catch {
    // The alarm and connectivity changes wake the coordinator when SQLite returns.
  } finally {
    running = undefined;
    if (requested) {
      requested = false;
      schedule(0);
    } else if (next !== null) schedule(next);
  }
}

async function manual(action: "sync" | "retry" | "legacy") {
  try {
    if (action === "legacy") {
      const settings = await readSyncSettings();
      if (settings) await flushQueue(settings);
    } else {
      await inSyncOrder(async () => {
        const settings = await readSyncSettings();
        if (!settings) throw new Error("Connect the backend workspace first.");
        if (action === "retry") {
          await refreshRegistry(settings);
          await continuousLocal("retry", { origin: settings.origin });
        }
        const run = new AbortController();
        let result;
        do {
          result = await syncContinuousBatch(settings, true, run.signal);
          if (result.changed) await notify();
        } while (result.more);
      });
      wakeContinuousSync();
    }
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Synchronization failed.",
    };
  } finally {
    await notify();
  }
}

export function installContinuousSync() {
  browser.runtime.onMessage.addListener(
    (message: { type?: string; action?: SyncAction }, sender) => {
      if (
        message?.type !== syncActionMessage ||
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(browser.runtime.getURL(""))
      )
        return undefined;
      switch (message.action) {
        case "configure":
          reconfigure();
          return Promise.resolve({ ok: true });
        case "wake":
          wakeContinuousSync();
          return Promise.resolve({ ok: true });
        case "sync":
        case "retry":
        case "legacy":
          return manual(message.action);
      }
      return undefined;
    },
  );
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[syncSettingsKey]) reconfigure();
  });
  browser.alarms.onAlarm.addListener(({ name }) => {
    if (name === alarm) wakeContinuousSync();
  });
  browser.runtime.onStartup.addListener(wakeContinuousSync);
  window.addEventListener("online", wakeContinuousSync);
  browser.alarms.create(alarm, { periodInMinutes: 0.5 });
  wakeContinuousSync();
}
