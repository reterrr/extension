import {
  maxSnapshotBytes,
  maxVisualArchiveBytes,
  mimeType,
  monitoringAccess,
  representation,
  representationVersion,
  settingsKey,
  sha256,
  statusKey,
  structureHashVersion,
  validateSettings,
  type AgentStatus,
  type Completion,
  type Job,
  type Settings,
} from "../shared/monitoring/contracts";
import { acquire, AcquisitionError } from "./monitoring-navigation";
import { agentFetch } from "./monitoring-request";
import { recoverContext } from "./monitoring-tabs";

const alarm = "burbot-monitoring";
const outboxKey = "burbotMonitoringOutbox";
const apiTimeout = 25_000;
const maxCompletionBytes = 8 * 1024 * 1024;

interface Outbox {
  apiOrigin: string;
  agentScope: string;
  jobId: string;
  completion: Completion;
}

interface UploadGrant {
  uploadIntentId: string;
  url: string;
  expiresAt: string;
}

class RequestError extends Error {
  constructor(readonly status: number) {
    super("Monitoring request failed.");
  }
}

async function request<T>(
  settings: Settings,
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await agentFetch(settings, endpoint, { body, signal });
  if (!response.ok) throw new RequestError(response.status);
  return response.status === 204 ? null : ((await response.json()) as T);
}

function jobEndpoint(jobId: string, action: string) {
  return "jobs/" + encodeURIComponent(jobId) + "/" + action;
}

function uploadTarget(settings: Settings, grant: UploadGrant | null) {
  if (!grant) throw new AcquisitionError("UPLOAD_FAILED");
  const url = new URL(grant.url);
  if (
    url.origin !== settings.storageOrigin ||
    url.username ||
    url.password ||
    url.hash ||
    !(Date.parse(grant.expiresAt) > Date.now())
  )
    throw new AcquisitionError("UPLOAD_FAILED");
  return { url, id: grant.uploadIntentId };
}

async function putArtifact(
  url: URL,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(apiTimeout)]),
    });
    if (!response.ok) throw new Error();
  } catch {
    throw new AcquisitionError("UPLOAD_FAILED");
  }
}

async function replay(
  settings: Settings,
  outbox: Outbox,
  agentScope: string,
  signal: AbortSignal,
) {
  if (
    outbox.apiOrigin === settings.apiOrigin &&
    outbox.agentScope === agentScope
  ) {
    try {
      await request(
        settings,
        jobEndpoint(outbox.jobId, "complete"),
        outbox.completion,
        signal,
      );
    } catch (error) {
      if (
        !(error instanceof RequestError) ||
        ![401, 404, 409, 410, 422].includes(error.status)
      )
        throw error;
      // The backend already lost or rejected this attempt. Its lease handles re-claim.
    }
  }
  await browser.storage.local.remove(outboxKey);
}

async function executeJob(
  settings: Settings,
  job: Job,
  agentScope: string,
  controller: AbortController,
) {
  const { signal } = controller;
  const endpoint = (action: string) => jobEndpoint(job.jobId, action);
  const heartbeat = async () => {
    await request(
      settings,
      endpoint("heartbeat"),
      { leaseId: job.leaseId, phase: "capturing" },
      signal,
    );
  };
  let beating = false;
  const timer = setInterval(() => {
    if (beating || signal.aborted) return;
    beating = true;
    void heartbeat()
      .catch(() => controller.abort())
      .finally(() => {
        beating = false;
      });
  }, 20_000);
  let saved = false;
  try {
    if (
      job.representation !== representation ||
      !Array.isArray(job.selectors) ||
      job.selectors.length > 64
    )
      throw new AcquisitionError("CAPTURE_FAILED");
    await heartbeat();
    const { html, visualArchive, ...snapshot } = await acquire(
      job,
      settings,
      signal,
    );
    const bytes = new TextEncoder().encode(html);
    if (
      bytes.length !== snapshot.contentSize ||
      bytes.length > maxSnapshotBytes ||
      (await sha256(bytes)) !== snapshot.contentHash
    )
      throw new AcquisitionError("CAPTURE_FAILED");

    const grant = await request<UploadGrant>(
      settings,
      endpoint("uploads"),
      {
        leaseId: job.leaseId,
        representation,
        mimeType,
        contentHash: snapshot.contentHash,
        contentSize: snapshot.contentSize,
      },
      signal,
    );
    const upload = uploadTarget(settings, grant);

    const completion: Completion = {
      ...snapshot,
      leaseId: job.leaseId,
      uploadIntentId: upload.id,
      completionKey: crypto.randomUUID(),
      representation,
      representationVersion,
      structureHashVersion,
      hashAlgorithm: "sha256",
      mimeType,
    };
    if (
      new TextEncoder().encode(JSON.stringify(completion)).length >
      maxCompletionBytes
    )
      throw new AcquisitionError("CAPTURE_FAILED");

    await putArtifact(upload.url, bytes, signal);
    if (visualArchive && !signal.aborted) {
      try {
        const archive = new TextEncoder().encode(visualArchive);
        if (archive.length <= maxVisualArchiveBytes) {
          const archiveGrant = await request<UploadGrant>(
            settings,
            endpoint("archive-uploads"),
            {
              leaseId: job.leaseId,
              mimeType,
              contentHash: await sha256(archive),
              contentSize: archive.length,
            },
            signal,
          );
          const archiveTarget = uploadTarget(settings, archiveGrant);
          await putArtifact(archiveTarget.url, archive, signal);
          const archiveId = archiveTarget.id;
          if (
            new TextEncoder().encode(
              JSON.stringify({
                ...completion,
                visualArchiveUploadId: archiveId,
              }),
            ).length <= maxCompletionBytes
          )
            completion.visualArchiveUploadId = archiveId;
        }
      } catch {
        // Complete the evidence upload even if the optional archive could not be sent.
      }
    }
    signal.throwIfAborted();
    const outbox: Outbox = {
      apiOrigin: settings.apiOrigin,
      agentScope,
      jobId: job.jobId,
      completion,
    };
    await browser.storage.local.set({ [outboxKey]: outbox });
    saved = true;
    await replay(settings, outbox, agentScope, signal);
  } catch (error) {
    if (!saved) {
      await request(settings, endpoint("fail"), {
        leaseId: job.leaseId,
        code: signal.aborted
          ? "CANCELLED"
          : error instanceof AcquisitionError
            ? error.code
            : "CAPTURE_FAILED",
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

export function installMonitoringAgent() {
  if (!browser.alarms || !browser.permissions) return;
  let busy = false;
  let reconfigure = false;
  let controller: AbortController | undefined;
  const state = (value: AgentStatus["state"]) =>
    browser.storage.local.set({
      [statusKey]: {
        state: value,
        lastUpdate: new Date().toISOString(),
      } satisfies AgentStatus,
    });

  async function tick() {
    if (busy) return;
    busy = true;
    const run = new AbortController();
    controller = run;
    try {
      const permitted = await browser.permissions.contains(monitoringAccess);
      await recoverContext();
      const storage = await browser.storage.local.get([settingsKey, outboxKey]);
      if (!storage[settingsKey]?.enabled || !permitted) {
        await browser.storage.local.remove(outboxKey);
        await browser.alarms.clear(alarm);
        await state("disabled");
        return;
      }
      const settings = validateSettings(storage[settingsKey]);
      const agentScope = await sha256(
        new TextEncoder().encode(settings.agentToken),
      );
      run.signal.throwIfAborted();
      if (storage[outboxKey])
        await replay(settings, storage[outboxKey], agentScope, run.signal);
      const job = await request<Job>(
        settings,
        settings.mode === "trusted" ? "jobs/claim?mode=trusted" : "jobs/claim",
        undefined,
        run.signal,
      );
      if (job) {
        await state("checking");
        await executeJob(settings, job, agentScope, run);
      }
      await state("idle");
    } catch {
      await state("error");
    } finally {
      controller = undefined;
      busy = false;
      if (reconfigure) {
        reconfigure = false;
        launch();
      }
    }
  }

  async function configure() {
    const stored = (await browser.storage.local.get(settingsKey))[
      settingsKey
    ] as Settings | undefined;
    if (
      stored?.enabled &&
      (await browser.permissions.contains(monitoringAccess))
    ) {
      browser.alarms.create(alarm, { periodInMinutes: 1 });
    }
    await tick();
  }

  const launch = () => {
    void configure().catch(() => undefined);
  };
  browser.alarms.onAlarm.addListener(({ name }) => {
    if (name === alarm) void tick().catch(() => undefined);
  });
  function changed() {
    controller?.abort();
    if (busy) reconfigure = true;
    else launch();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[settingsKey]) changed();
  });
  browser.permissions.onRemoved.addListener(
    ({ permissions: removed, origins }) => {
      if (
        origins?.length ||
        removed?.some((permission) =>
          monitoringAccess.permissions.includes(permission),
        )
      ) {
        changed();
      }
    },
  );
  browser.runtime.onStartup.addListener(launch);
  launch();
}
