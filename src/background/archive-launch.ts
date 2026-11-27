import {
  isolatedArchiveURL,
  uuid,
} from "../shared/monitoring/snapshot-delivery";
import {
  replayArchiveScope,
  stagedArchiveBlob,
} from "../shared/monitoring/archive-stage";

async function launch() {
  const id = location.hash.slice(1);
  if (!uuid.test(id)) return;
  const payload: unknown = await browser.runtime.sendMessage({
    type: "archive-markup",
    id,
  });
  const html =
    typeof payload === "string"
      ? payload
      : (payload as { staged?: boolean } | null)?.staged === true
        ? await stagedArchiveBlob(
            replayArchiveScope(id),
            "document",
            "text/html;charset=utf-8",
          )
        : null;
  if (!html || (html instanceof Blob && !html.size)) return;
  const publisher = document.createElement("iframe");
  publisher.hidden = true;
  // This frame only publishes an opaque URL. Firefox loads the HTML into the whole tab.
  publisher.sandbox.add("allow-scripts", "allow-top-navigation");
  publisher.src = location.pathname;
  publisher.addEventListener(
    "load",
    () => publisher.contentWindow?.postMessage({ html }, "*"),
    { once: true },
  );
  window.addEventListener("message", async (event) => {
    const url = event.data?.url;
    if (
      event.source !== publisher.contentWindow ||
      event.origin !== "null" ||
      typeof url !== "string" ||
      !isolatedArchiveURL.test(url)
    )
      return;
    if (
      await browser.runtime.sendMessage({ type: "archive-published", id, url })
    )
      publisher.contentWindow?.postMessage("navigate", "*");
  });
  document.body.append(publisher);
}

function publish() {
  const launcherOrigin = `${location.protocol}//${location.host}`;
  let url: string | undefined;
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== launcherOrigin) return;
    if (event.data === "navigate" && url) {
      top?.location.replace(url);
    } else if (
      !url &&
      (typeof event.data?.html === "string" || event.data?.html instanceof Blob)
    ) {
      url = URL.createObjectURL(
        new Blob([event.data.html], { type: "text/html;charset=utf-8" }),
      );
      parent.postMessage({ url }, launcherOrigin);
    }
  });
}

if (window === top) void launch().catch(() => undefined);
else if (self.origin === "null") publish();
