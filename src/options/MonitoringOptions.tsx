import { useEffect, useState, type FormEvent } from "react";
import {
  monitoringAccess,
  settingsKey,
  statusKey,
  validateSettings,
  visualArchiveAccess,
  type AgentStatus,
  type Settings,
} from "../shared/monitoring/contracts";

const defaults: Settings = {
  enabled: false,
  mode: "strict",
  apiOrigin: "",
  storageOrigin: "",
  agentToken: "",
  allowedOrigins: [],
};

export function MonitoringOptions() {
  const [saved, setSaved] = useState(defaults);
  const [input, setInput] = useState(defaults);
  const [origins, setOrigins] = useState("");
  const [status, setStatus] = useState<AgentStatus>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [archiveAllowed, setArchiveAllowed] = useState(false);

  useEffect(() => {
    void browser.permissions
      .contains(visualArchiveAccess)
      .then(setArchiveAllowed)
      .catch(() => undefined);
    void browser.storage.local
      .get([settingsKey, statusKey])
      .then((state) => {
        if (state[settingsKey]) {
          const settings = { ...defaults, ...state[settingsKey] } as Settings;
          setInput(settings);
          setSaved(settings);
          setOrigins(settings.allowedOrigins.join("\n"));
        }
        setStatus(state[statusKey]);
      })
      .catch(() => setError("Could not read browser settings."))
      .finally(() => setLoading(false));
    const changed: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, area) => {
      if (area === "local" && changes[statusKey])
        setStatus(changes[statusKey].newValue);
    };
    browser.storage.onChanged.addListener(changed);
    return () => browser.storage.onChanged.removeListener(changed);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const config = validateSettings({
        ...input,
        enabled: true,
        allowedOrigins: origins.split(/\s+/).filter(Boolean),
      });
      // Request recording access while the user is explicitly enabling
      // Monitoring; otherwise silently missing permission produces HTML-only
      // archives even though selector extraction succeeds.
      const allPermissions = {
        permissions: [
          ...new Set([
            ...monitoringAccess.permissions,
            ...visualArchiveAccess.permissions,
          ]),
        ],
        origins: monitoringAccess.origins,
      };
      const fullAccess = await browser.permissions.request(allPermissions);
      if (!fullAccess && !(await browser.permissions.request(monitoringAccess)))
        throw new Error("Monitoring permissions were declined.");
      const canArchive = await browser.permissions.contains(visualArchiveAccess);
      setArchiveAllowed(canArchive);
      await browser.storage.local.set({ [settingsKey]: config });
      setSaved(config);
      if (!canArchive)
        setError(
          "Monitoring is enabled, but Firefox has not granted offline archive resources. Grant access below to save external CSS, images and fonts.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not enable monitoring.",
      );
    }
  }

  async function disable() {
    const config = { ...saved, enabled: false };
    await browser.storage.local.set({ [settingsKey]: config });
    setSaved(config);
    setError("");
  }

  return (
    <section className="ui-card ui-monitoring">
      <h2>Source monitoring</h2>
      <p className="ui-muted">
        When enabled, Firefox opens public sites in temporary container tabs and
        sends rendered HTML and selector results to your Burbot server and
        storage service.
      </p>
      <form onSubmit={save}>
        <label>
          Backend origin
          <input
            required
            placeholder="https://burbot.example.org"
            value={input.apiOrigin}
            onChange={(e) => setInput({ ...input, apiOrigin: e.target.value })}
          />
        </label>
        <label>
          MinIO upload origin
          <input
            required
            placeholder="https://storage.example.org"
            value={input.storageOrigin}
            onChange={(e) =>
              setInput({ ...input, storageOrigin: e.target.value })
            }
          />
        </label>
        <label>
          Browser Agent token
          <input
            required
            type="password"
            autoComplete="off"
            value={input.agentToken}
            onChange={(e) => setInput({ ...input, agentToken: e.target.value })}
          />
        </label>
        <label>
          Monitoring mode
          <select
            value={input.mode}
            onChange={(e) =>
              setInput({
                ...input,
                mode: e.target.value === "trusted" ? "trusted" : "strict",
              })
            }
          >
            <option value="strict">Strict</option>
            <option value="trusted">Trusted local</option>
          </select>
        </label>
        {input.mode === "trusted" ? (
          <p className="ui-muted">
            Use a trusted Agent token issued by your local Burbot backend.
            Firefox checks the public sites supplied by that backend.
          </p>
        ) : (
          <label>
            Approved website origins
            <textarea
              required
              rows={3}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              placeholder="https://example.org"
            />
          </label>
        )}
        <div className="ui-actions">
          <button disabled={loading} type="submit">
            {saved.enabled ? "Save monitoring settings" : "Enable monitoring"}
          </button>
          {saved.enabled && (
            <button
              type="button"
              onClick={() =>
                void disable().catch(() =>
                  setError("Could not disable monitoring."),
                )
              }
            >
              Disable monitoring
            </button>
          )}
        </div>
      </form>
      {saved.enabled && archiveAllowed && (
        <p className="ui-muted">
          Visual archive resource capture is enabled. Loaded styles, images
          and fonts will be saved for future snapshots within archive limits.
        </p>
      )}
      {saved.enabled && !archiveAllowed && (
        <p className="ui-muted">
          Historical pages may have no styling until Firefox can record the
          stylesheets, fonts and images loaded during future checks. This
          permission does not change selector evaluation.
        </p>
      )}
      {saved.enabled && !archiveAllowed && (
        <button
          type="button"
          onClick={() => {
            setError("");
            void browser.permissions
              .request(visualArchiveAccess)
              .then((allowed) => {
                setArchiveAllowed(allowed);
                if (!allowed)
                  setError("Archive resource permission was declined.");
              })
              .catch(() => setError("Could not enable archive resources."));
          }}
        >
          Save loaded styles, images and fonts in archives
        </button>
      )}
      <p aria-live="polite">
        {saved.enabled
          ? {
              idle: "Waiting for checks",
              checking: "Checking a source",
              error: "Check backend connection and permissions",
              disabled: "Monitoring permissions required",
            }[status?.state ?? "idle"]
          : "Monitoring is off"}
      </p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
