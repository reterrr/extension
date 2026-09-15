const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.join(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
function coreContext(extra = {}) {
  const context = vm.createContext({
    URL,
    Intl,
    Date,
    crypto: webcrypto,
    console,
    setTimeout,
    clearTimeout,
    ...extra,
  });
  for (const file of ["schema.js", "core.js"])
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
      filename: file,
    });
  return context;
}
function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    emit: (...args) => listeners.map((fn) => fn(...args)),
  };
}
function candidate(text, url = "https://example.org/project") {
  return {
    pageUrl: url,
    selector: "#name",
    raw: text,
    extraction: {
      type: "selection",
      quote: { exact: text, prefix: "", suffix: "" },
    },
  };
}
module.exports = { root, clone, coreContext, event, candidate };
