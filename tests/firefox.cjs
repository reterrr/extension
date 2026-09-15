// Drive the real Firefox sidebar and native menu through Firefox's DevTools
// protocol. Playwright controls the webpage; no WebExtension APIs are mocked.
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { firefox } = require("playwright");
const { root } = require("./helpers.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label = "condition", timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await pause(40);
  }
  throw Error(
    `Timed out waiting for ${label}${last ? ": " + last.message : ""}`,
  );
}
async function launch() {
  const { connectWithMaxRetries, findFreeTcpPort } = await import(
    pathToFileURL(path.join(root, "node_modules/web-ext/lib/firefox/remote.js"))
  );
  const port = await findFreeTcpPort();
  const container = process.env.BURBOT_TEST_CONTAINER === "1";
  const context = await firefox.launchPersistentContext("", {
    headless: true,
    timeout: 20000,
    args: ["--start-debugger-server", String(port)],
    ...(container
      ? {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: "1",
            MOZ_DISABLE_RDD_SANDBOX: "1",
            MOZ_DISABLE_GPU_SANDBOX: "1",
          },
        }
      : {}),
    firefoxUserPrefs: {
      ...(container ? { "security.sandbox.content.level": 0 } : {}),
      "devtools.debugger.remote-enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.chrome.enabled": true,
      "ui.popup.disable_autohide": true,
    },
  });
  let remote;
  try {
    remote = await connectWithMaxRetries({
      port,
      maxRetries: 30,
      retryInterval: 100,
    });
    const results = new Map(),
      targets = new Map();
    const original = remote.client._handleMessage.bind(remote.client);
    remote.client._handleMessage = (message) => {
      if (message.type === "evaluationResult") {
        results.set(message.resultID, message);
        return;
      }
      if (message.type === "target-available-form") {
        targets.set(message.target.actor, message.target);
        return;
      }
      if (message.type === "target-destroyed-form") {
        targets.delete(message.target.actor);
        return;
      }
      if (
        [
          "resources-available-array",
          "resources-destroyed-array",
          "resources-updated-array",
        ].includes(message.type)
      )
        return;
      original(message);
    };
    const request = (message) => remote.client.request(message);
    async function evaluate(actor, expression) {
      const { resultID } = await request({
        to: actor,
        type: "evaluateJSAsync",
        text: `JSON.stringify(${expression})`,
      });
      const event = await until(
        () => results.get(resultID),
        "console evaluation",
      );
      results.delete(resultID);
      if (event.hasException) throw Error(event.exceptionMessage);
      let result = event.result;
      if (result?.type === "longString") {
        result = (
          await request({
            to: result.actor,
            type: "substring",
            start: 0,
            end: result.length,
          })
        ).substring;
      }
      return typeof result === "string" ? JSON.parse(result) : undefined;
    }
    await remote.installTemporaryAddon(root);
    const addon = await remote.getInstalledAddon("burbot-picker@local.example");
    const watcher = await request({
      to: addon.actor,
      type: "getWatcher",
      isServerTargetSwitchingEnabled: true,
    });
    await request({
      to: watcher.actor,
      type: "watchTargets",
      targetType: "frame",
    });
    const descriptor = await request({ to: "root", type: "getProcess", id: 0 });
    const parent = await request({
      to: descriptor.processDescriptor.actor,
      type: "getTarget",
    });
    const targetFor = (suffix) =>
      [...targets.values()].find((t) => t.url.endsWith(suffix));
    const inView = async (suffix, expression) => {
      const target = await until(() => targetFor(suffix), suffix);
      return evaluate(target.consoleActor, expression);
    };
    const ui = (expression) => inView("/sidebar.html", expression);
    const background = (expression) =>
      inView("/_generated_background_page.html", expression);
    const chrome = (expression) =>
      evaluate(
        parent.process.consoleActor,
        `(()=>{const win=Services.wm.getMostRecentWindow('navigator:browser');return (${expression});})()`,
      );
    async function storage(expression) {
      await background(
        `(()=>{globalThis.__testResult=null;Promise.resolve(${expression}).then(value=>{globalThis.__testResult={value};},error=>{globalThis.__testResult={error:error.message};});return true;})()`,
      );
      const result = await until(
        () => background("globalThis.__testResult"),
        "storage operation",
      );
      if (result.error) throw Error(result.error);
      return result.value;
    }
    const page = context.pages()[0];
    async function select(selector, text, emit = true) {
      await page.evaluate(
        ({ selector, text, emit }) => {
          const element = document.querySelector(selector),
            node = element.firstChild;
          const range = document.createRange();
          const start = text ? node.textContent.indexOf(text) : 0;
          if (start < 0) throw Error("Selection text not found");
          range.setStart(node, start);
          range.setEnd(
            node,
            text ? start + text.length : node.textContent.length,
          );
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          if (emit)
            element.dispatchEvent(
              new PointerEvent("pointerup", { bubbles: true }),
            );
        },
        { selector, text, emit },
      );
    }
    async function create(selector, label) {
      await select(selector, null, false);
      // Headless Firefox removes native menus immediately. Observe the actual
      // menu Firefox builds and dispatch its command before that teardown.
      await chrome(`(()=>{
        const popup=win.document.getElementById('contentAreaContextMenu');
        win.__menuResult=null;win.__menuObserver?.disconnect();
        const observer=new win.MutationObserver(()=>{
          const menu=Array.from(popup.querySelectorAll('menu')).find(x=>x.getAttribute('label')==='Create Burbot object');
          if(!menu)return;
          const item=Array.from(menu.querySelectorAll('menuitem')).find(x=>x.getAttribute('label')===${JSON.stringify(label)});
          if(!item)return;observer.disconnect();
          win.__menuResult=Array.from(menu.querySelectorAll('menuitem')).map(x=>x.getAttribute('label'));
          const handling=win.windowUtils.setHandlingUserInput(true);
          try{item.doCommand();}finally{handling.destruct();popup.hidePopup();}
        });
        observer.observe(popup,{childList:true,subtree:true});win.__menuObserver=observer;return true;
      })()`);
      await page
        .locator(selector)
        .click({ button: "right", position: { x: 15, y: 8 } });
      return until(() => chrome("win.__menuResult"), "native Burbot menu");
    }
    const click = (selector) =>
      ui(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Control unavailable: '+${JSON.stringify(selector)});el.click();return true;})()`,
      );
    const setValue = (value) =>
      ui(
        `(()=>{const el=document.getElementById('edit-value');if(el.type==='checkbox')el.checked=${JSON.stringify(value)};else el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    async function screenshot(filename, fullpage = false) {
      const target = targetFor("/sidebar.html");
      const { value: prepared } = await request({
        to: target.screenshotContentActor,
        type: "prepareCapture",
        args: { fullpage },
      });
      const rootActors = await request({ to: "root", type: "getRoot" });
      const { value: shot } = await request({
        to: rootActors.screenshotActor,
        type: "capture",
        args: {
          browsingContextID: target.browsingContextID,
          rect: prepared.rect,
          snapshotScale: 1,
          fullpage,
          disableFlash: true,
        },
      });
      if (!shot.data) throw Error(JSON.stringify(shot.messages));
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(
        filename,
        Buffer.from(shot.data.split(",")[1], "base64"),
      );
    }
    return {
      context,
      page,
      ui,
      chrome,
      storage,
      select,
      create,
      click,
      setValue,
      screenshot,
      addon,
      state: () =>
        storage(
          'browser.storage.local.get("burbot:v1").then(x=>x["burbot:v1"])',
        ),
      close: async () => {
        remote.disconnect();
        await context.close();
      },
    };
  } catch (error) {
    remote?.disconnect();
    await context.close();
    throw error;
  }
}
module.exports = { launch, until };
