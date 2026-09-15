(() => {
  const $ = id => document.getElementById(id);
  const C = BurbotCore, schema = BurbotSchema;

  let db = C.empty(), objectId = "", field = "";
  let candidate = null, preview = null;
  let windowId, tabId = null, port = null;
  let generation = 0, busy = false, picking = false;

  const pending = new Map();
  const chosen = () => db.objects.find(o => o.id === objectId);

  function notice(text, error = false) {
    $("notice").textContent = text;
    $("notice").className = error ? "error" : "";
  }

  async function data(op, extra = {}) {
    const result = await browser.runtime.sendMessage({
      type: "BURBOT_DATA",
      op,
      expectedRevision: db.revision,
      ...extra
    });

    if (!result?.ok)
      throw Error(result?.error || "Storage is unavailable.");

    return result.value;
  }

  function rpc(op, extra = {}) {
    return new Promise((resolve, reject) => {
      if (!port) {
        reject(Error("Click the Burbot toolbar button on this page first."));
        return;
      }

      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Page did not respond. Reconnect using the toolbar button."));
      }, 8000);

      pending.set(id, {
        resolve: value => {clearTimeout(timer); resolve(value);},
        reject: error => {clearTimeout(timer); reject(error);}
      });

      try {
        port.postMessage({id, op, ...extra});
      } catch (error) {
        pending.get(id).reject(error);
        pending.delete(id);
      }
    });
  }

  function disconnect() {
    generation++;
    const previous = port;
    port = null;
    previous?.disconnect();

    for (const request of pending.values())
      request.reject(Error("Page connection changed. Try again."));

    pending.clear();
    candidate = null;
    preview = null;
    picking = false;
  }

  async function connect() {
    disconnect();
    const token = generation;

    $("connection").textContent = "Connecting to the active page…";
    render();

    try {
      const tabs = await browser.tabs.query({active: true, windowId});
      if (token !== generation || !tabs[0]) return;

      tabId = tabs[0].id;

      await browser.scripting.executeScript({
        target: {tabId},
        files: ["core.js", "picker.js"]
      });

      if (token !== generation) return;

      port = browser.tabs.connect(tabId, {
        name: "burbot-picker",
        frameId: 0
      });

      port.onMessage.addListener(message => {
        if (token !== generation) return;

        if (message.id) {
          const request = pending.get(message.id);
          pending.delete(message.id);

          if (request) {
            message.ok
              ? request.resolve(message.value)
              : request.reject(Error(message.error));
          }
        } else if (message.event === "CAPTURE") {
          candidate = message.candidate;
          preview = null;

          $("method").replaceChildren(
            ...candidate.options.map((o, i) => new Option(o.label, String(i)))
          );

          notice("Choose a field, then assign this value.");
          render();
        } else if (message.event === "ERROR") {
          notice(message.error, true);
        } else if (message.event === "MODE") {
          picking = message.picking;
          controls();
        }
      });

      port.onDisconnect.addListener(() => {
        if (token !== generation) return;

        disconnect();
        $("connection").textContent =
          "Disconnected. Click the Burbot toolbar button to reconnect.";
        render();
      });

      const url = await rpc("URL");
      if (token !== generation) return;

      $("connection").textContent = "Connected · " + new URL(url).hostname;
      render();
    } catch {
      if (token !== generation) return;

      disconnect();
      $("connection").textContent =
        "Open a website and click the Burbot toolbar button to connect. " +
        "Firefox internal pages and PDFs cannot be picked.";
      render();
    }
  }

  function controls() {
    const object = chosen();

    $("pick").disabled = !port || busy;
    $("pick").textContent = picking ? "Cancel picker" : "Pick element";
    $("page-url").disabled = !port || busy;
    $("preview").disabled = !port || !object || busy ||
      !db.rules.some(r => r.objectId === objectId);
    $("apply").disabled = !preview?.results.length || busy;
    $("delete").disabled = !object || busy;
    $("object-type").disabled = busy;
    $("object-list").disabled = busy;
    $("object-name").disabled = busy;
    $("create-form").querySelector("button").disabled = busy;
    $("method").disabled = busy;
    $("export").disabled = busy;

    let valid = false;
    const option = candidate?.options[Number($("method").value)];

    if (object && field && option) {
      try {
        const value = C.coerce(
          option.raw,
          schema[object.type].fields[field].type
        );

        $("converted").textContent = "Saved value: " + value;
        valid = true;
      } catch (error) {
        $("converted").textContent = error.message;
      }
    } else {
      $("converted").textContent = "Choose an object and a field.";
    }

    $("assign").disabled = !valid || busy || !port;
    $("assign").textContent = object && field
      ? "Assign to " + schema[object.type].fields[field].label
      : "Assign value";
  }

  function render() {
    const objects = db.objects.filter(
      o => o.type === $("object-type").value
    );

    if (!objects.some(o => o.id === objectId))
      objectId = objects[0]?.id || "";

    $("object-list").replaceChildren(...(
      objects.length
        ? objects.map(o => new Option(o.label, o.id))
        : [new Option("Create an object first", "")]
    ));

    $("object-list").value = objectId;

    const object = chosen();
    $("fields").replaceChildren();

    if (object) {
      const definitions = schema[object.type].fields;

      if (!Object.hasOwn(definitions, field))
        field = Object.keys(definitions)[0];

      $("progress").textContent =
        Object.keys(object.values).length + " / " + Object.keys(definitions).length;

      for (const [key, definition] of Object.entries(definitions)) {
        const button = document.createElement("button");
        button.className = "field" + (key === field ? " selected" : "");
        button.disabled = busy;

        const name = document.createElement("b");
        const value = document.createElement("span");

        name.textContent = definition.label + " · " + definition.type;
        value.textContent = object.values[key] === undefined
          ? "Select a value"
          : String(object.values[key]);

        button.append(name, value);
        button.onclick = () => {field = key; render();};
        $("fields").append(button);
      }
    } else {
      $("progress").textContent = "";
    }

    $("capture").hidden = !candidate;

    const option = candidate?.options[Number($("method").value)];
    $("sample").textContent = option?.raw || "";
    $("selector").textContent = candidate?.selector || "(page URL)";

    const rule = db.rules.find(
      r => r.objectId === objectId && r.field === field
    );

    $("rule-details").hidden = !rule;
    $("rule").textContent = rule ? JSON.stringify(rule, null, 2) : "";
    $("results").hidden = !preview;

    controls();
  }

  function action(handler) {
    return async event => {
      event?.preventDefault();
      if (busy) return;

      busy = true;
      render();

      try {
        await handler(event);
      } catch (error) {
        notice(error.message, true);
        try {db = await data("GET");} catch {}
        preview = null;
      } finally {
        busy = false;
        render();
      }
    };
  }

  $("object-type").replaceChildren(
    ...Object.entries(schema).map(
      ([key, value]) => new Option(value.label, key)
    )
  );

  $("object-type").onchange = () => {
    objectId = "";
    field = "";
    preview = null;
    render();
  };

  $("object-list").onchange = () => {
    objectId = $("object-list").value;
    preview = null;
    render();
  };

  $("method").onchange = render;

  $("create-form").onsubmit = action(async () => {
    db = await data("CREATE", {
      objectType: $("object-type").value,
      label: $("object-name").value
    });

    objectId = db.objects[db.objects.length - 1].id;
    $("object-name").value = "";
    preview = null;
    notice("Object created.");
  });

  $("delete").onclick = action(async () => {
    if (!confirm(
      'Delete "' + chosen().label + '" and its extraction rules?'
    )) return;

    db = await data("DELETE", {objectId});
    objectId = "";
    preview = null;
    notice("Object deleted.");
  });

  $("pick").onclick = action(async () => {
    await rpc(picking ? "STOP" : "PICK");
  });

  $("page-url").onclick = action(async () => {
    const url = await rpc("URL");

    candidate = {
      pageUrl: url,
      selector: null,
      options: [{
        label: "Page URL",
        raw: url,
        extraction: {type: "pageUrl"}
      }]
    };

    $("method").replaceChildren(new Option("Page URL", "0"));
    preview = null;
  });

  $("assign").onclick = action(async () => {
    const capture = candidate;
    const option = capture.options[Number($("method").value)];
    const selectedId = objectId;
    const selectedField = field;
    const revision = db.revision;

    if (await rpc("URL") !== capture.pageUrl)
      throw Error("The page changed. Capture the value again.");

    db = await data("ASSIGN", {
      objectId: selectedId,
      field: selectedField,
      expectedRevision: revision,
      candidate: {
        pageUrl: capture.pageUrl,
        selector: capture.selector,
        ...option
      }
    });

    preview = null;
    notice("Value and extraction rule saved.");
  });

  $("preview").onclick = action(async () => {
    const selectedId = objectId;
    const revision = db.revision;
    const token = generation;
    const rules = db.rules.filter(r => r.objectId === selectedId);
    const results = await rpc("RUN", {rules});

    if (generation !== token || db.revision !== revision ||
        objectId !== selectedId)
      throw Error("Page or object changed. Preview again.");

    const successful = [];
    $("result-list").replaceChildren();

    for (const result of results) {
      const rule = rules.find(r => r.id === result.ruleId);
      const definition = schema[chosen().type].fields[rule.field];
      const row = document.createElement("div");
      row.className = "result";

      try {
        if (result.error) throw Error(result.error);

        const value = C.coerce(result.raw, definition.type);
        row.textContent =
          definition.label + "\n" +
          String(chosen().values[rule.field] ?? "—") +
          " → " + String(value);

        successful.push({ruleId: rule.id, raw: result.raw});
      } catch (error) {
        row.classList.add("error");
        row.textContent = definition.label + ": " + error.message;
      }

      $("result-list").append(row);
    }

    preview = {objectId: selectedId, revision, results: successful};
    notice("Review the results before applying them.");
  });

  $("apply").onclick = action(async () => {
    const snapshot = preview;

    db = await data("APPLY", {
      objectId: snapshot.objectId,
      expectedRevision: snapshot.revision,
      results: snapshot.results
    });

    preview = null;
    notice("Successful results applied. Other values were kept.");
  });

  $("export").onclick = action(async () => {
    const saved = await data("GET");

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(saved, null, 2)], {
        type: "application/json"
      })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download =
      "burbot-" + new Date().toISOString().slice(0, 10) + ".json";

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice("JSON export requested.");
  });

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "BURBOT_CONNECT" &&
        message.windowId === windowId)
      void connect();

    return undefined;
  });

  browser.tabs.onActivated.addListener(info => {
    if (info.windowId === windowId) void connect();
  });

  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== tabId) return;

    if (change.status === "loading") {
      disconnect();
      $("connection").textContent = "Page loading…";
      render();
    } else if (change.status === "complete" || change.url) {
      void connect();
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["burbot:v1"]?.newValue) {
      db = changes["burbot:v1"].newValue;
      preview = null;
      render();
    }
  });

  window.addEventListener("pagehide", disconnect);

  (async () => {
    windowId = (await browser.windows.getCurrent()).id;
    db = await data("GET");
    render();
    await connect();
  })().catch(error => notice(error.message, true));
})();
