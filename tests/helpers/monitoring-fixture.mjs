// Read a claimed job and fixture HTML from stdin, then return a real addon capture.
import { resolve } from "node:path";
import { launch } from "../firefox.cjs";

let input = "";
for await (const chunk of process.stdin.setEncoding("utf8")) input += chunk;
const { job, html } = JSON.parse(input);
const firefox = await launch({
  sourceDir: resolve(import.meta.dirname, "../../dist"),
});
let capture;
try {
  await firefox.page.route(job.url, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await firefox.page.goto(job.url);
  const request = {
    type: "burbot:monitoring-capture",
    expectedOrigins: job.allowedOrigins,
    selectors: job.selectors,
  };
  capture = await firefox.storage(
    "(async () => {" +
      "const tab = (await browser.tabs.query({})).find(tab => tab.url === " +
      JSON.stringify(job.url) +
      ");" +
      "await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['monitoring-capture.js'] });" +
      "return browser.tabs.sendMessage(tab.id, " +
      JSON.stringify(request) +
      ");" +
      "})()",
  );
  if (!capture) throw new Error("Firefox did not return a monitoring capture.");
} finally {
  await firefox.close();
}
process.stdout.write(JSON.stringify(capture) + "\n");
