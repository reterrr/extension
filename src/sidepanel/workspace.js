import {
  createCapturedExtractionInput,
  createPageUrlCandidate,
} from "../shared/extraction/rules";
import { createPickerClient } from "./pickerRpc";

(() => {
  const $ = (id) => document.getElementById(id),
    C = BurbotCore;
  let db = C.empty(),
    objectId = "",
    active = null,
    candidate = null,
    draft = "",
    methodIndex = 0;
  let preview = null,
    windowId,
    tabId = null,
    pageUrl = "",
    port = null,
    pickerClient = null,
    generation = 0,
    viewEpoch = 0;
  let busy = false,
    picking = false,
    focusStamp = "",
    descriptors = [],
    ready = false;
  const expanded = new Set();
  const chosen = () => db.objects.find((o) => o.id === objectId);
  const keyOf = (descriptor) =>
    descriptor ? C.targetKey(descriptor.target) + "/" + descriptor.field : "";
  const activeInfo = () =>
    active && chosen()
      ? C.fieldContext(db, chosen(), active.field, active.target)
      : null;
  const activeRule = () =>
    active
      ? db.rules.find((r) =>
          C.matches(r, objectId, active.field, active.target),
        )
      : null;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function notice(text, error = false) {
    $("notice").textContent = text;
    $("notice").className = error ? "error" : "";
  }
  function adopt(next) {
    if (next?.objects && next.revision >= db.revision) {
      if (next.revision > db.revision) preview = null;
      db = next;
    }
  }
  async function data(op, extra = {}) {
    const result = await browser.runtime.sendMessage({
      type: "BURBOT_DATA",
      op,
      expectedRevision: db.revision,
      ...extra,
    });
    if (!result?.ok) throw Error(result?.error || "Storage is unavailable.");
    adopt(result.value);
    return result.value;
  }
  function rpc(op, extra = {}) {
    if (!pickerClient) return Promise.reject(Error("Connect this page first."));
    return op === "RUN"
      ? pickerClient.request("RUN", extra)
      : pickerClient.request(op);
  }
  function resetCapture() {
    candidate = null;
    methodIndex = 0;
    try {
      draft = activeInfo()?.values[active.field] ?? "";
    } catch {
      active = null;
      draft = "";
    }
  }
  function disconnect() {
    generation++;
    viewEpoch++;
    const previousClient = pickerClient;
    pickerClient = null;
    previousClient?.dispose(Error("Page connection changed. Try again."));
    const previous = port;
    port = null;
    previous?.disconnect();
    picking = false;
    pageUrl = "";
    preview = null;
    resetCapture();
  }
  async function connect() {
    if (!ready) return;
    disconnect();
    const token = generation;
    $("connection").textContent = "Connecting…";
    render();
    try {
      const tabs = await browser.tabs.query({ active: true, windowId });
      if (token !== generation || !tabs[0]) return;
      tabId = tabs[0].id;
      await browser.scripting.executeScript({
        target: { tabId },
        files: ["core.js", "picker.js"],
      });
      if (token !== generation) return;
      port = browser.tabs.connect(tabId, { name: "burbot-picker", frameId: 0 });
      pickerClient = createPickerClient(port, (message) => {
        if (token !== generation) return;
        if (message.event === "CAPTURE") {
          if (!busy && active) acceptCapture(message.candidate);
        } else if (message.event === "ERROR") notice(message.error, true);
        else if (message.event === "MODE") {
          picking = message.picking;
          controls();
        }
      });
      port.onDisconnect.addListener(() => {
        if (token !== generation) return;
        disconnect();
        $("connection").textContent =
          "Page disconnected · reconnect to capture";
        render();
      });
      const url = await rpc("URL");
      if (token !== generation) return;
      pageUrl = url;
      $("connection").textContent = new URL(url).hostname + " · connected";
      render();
    } catch {
      if (token !== generation) return;
      disconnect();
      $("connection").textContent =
        "Click Connect or the Burbot toolbar button on a website";
      render();
    }
  }
  function normalFields(object) {
    return Object.entries(BurbotSchema[object.type]?.fields || {}).filter(
      ([key, definition]) =>
        !definition.legacy ||
        C.hasValue(object.values[key]) ||
        db.rules.some((r) => C.matches(r, object.id, key)),
    );
  }
  function chooseObject(id, next = false) {
    if (port && picking) void rpc("STOP").catch(() => {});
    objectId = id;
    active = null;
    preview = null;
    viewEpoch++;
    resetCapture();
    $("switcher").open = false;
    render();
    if (next) {
      const object = chosen();
      const field =
        object &&
        normalFields(object).find(([key]) => !C.hasValue(object.values[key]));
      if (field) selectField({ field: field[0] });
    }
  }
  async function receiveFocus(message) {
    if (!ready || !message || message.stamp === focusStamp) return;
    focusStamp = message.stamp;
    if (message.error) {
      notice(message.error, true);
      return;
    }
    await data("GET");
    if (focusStamp !== message.stamp) return;
    if (db.objects.some((o) => o.id === message.objectId)) {
      chooseObject(message.objectId, true);
      notice(message.note || "Choose a field to capture.");
      if (!port || tabId !== message.tabId) await connect();
    }
  }
  function selectField(descriptor) {
    if (busy) return;
    if (port && picking) void rpc("STOP").catch(() => {});
    active = descriptor;
    viewEpoch++;
    resetCapture();
    if (descriptor.target?.kind === "funding")
      expanded.add("funding:" + descriptor.target.id);
    if (descriptor.target?.kind === "document") {
      expanded.add("document:" + descriptor.target.id);
      $("documents-panel").open = true;
    }
    render();
  }
  function acceptCapture(value) {
    if (!active || !chosen()) {
      notice("Select a field first.");
      return;
    }
    candidate = value;
    methodIndex = 0;
    preview = null;
    const definition = activeInfo().definition;
    if (definition.type === "url") {
      const href = candidate.options.findIndex(
        (o) => o.extraction.attribute === "href",
      );
      if (href >= 0) methodIndex = href;
    }
    updateDraftFromCapture();
    renderEditor();
    controls();
    notice("Review the value, then save its extraction rule.");
  }
  function updateDraftFromCapture() {
    const raw = candidate.options[methodIndex]?.raw ?? "";
    try {
      draft = C.coerceField(raw, activeInfo().definition, db);
    } catch {
      draft = ["enum", "reference", "boolean", "date"].includes(
        activeInfo().definition.type,
      )
        ? ""
        : raw;
    }
  }
  function fieldRow(
    container,
    field,
    definition,
    values,
    target,
    context = "",
  ) {
    const descriptor = { field, target, context };
    descriptors.push(descriptor);
    const button = node(
      "button",
      "field-row" + (keyOf(active) === keyOf(descriptor) ? " selected" : ""),
    );
    button.type = "button";
    button.dataset.field = field;
    button.dataset.target = C.targetKey(target);
    button.setAttribute(
      "aria-pressed",
      String(keyOf(active) === keyOf(descriptor)),
    );
    button.disabled = busy;
    const copy = node("span", "field-copy");
    copy.append(node("span", "field-label", definition.label));
    const set = C.hasValue(values[field]);
    copy.append(
      node(
        "span",
        "field-value" + (set ? "" : " empty"),
        C.formatValue(values[field], definition, db),
      ),
    );
    button.append(copy, node("span", "field-mark", set ? "✓" : ""));
    button.onclick = () => selectField(descriptor);
    container.append(button);
  }
  function trackExpansion(details, key) {
    details.open = expanded.has(key);
    details.addEventListener("toggle", () => {
      if (details.isConnected)
        details.open ? expanded.add(key) : expanded.delete(key);
    });
  }
  function renderSwitcher() {
    const root = $("object-options");
    root.replaceChildren();
    const local = (object) =>
      pageUrl &&
      (object.sourceUrl === pageUrl ||
        db.rules.some(
          (r) => r.objectId === object.id && r.pageUrl === pageUrl,
        ));
    for (const [title, objects] of [
      ["On this page", db.objects.filter(local)],
      ["Saved objects", db.objects.filter((o) => !local(o))],
    ]) {
      if (!objects.length) continue;
      root.append(node("div", "switch-group", title));
      for (const object of [...objects].reverse()) {
        const button = node("button", "", C.displayName(object));
        button.append(
          node("small", "", BurbotSchema[object.type]?.label || object.type),
        );
        button.setAttribute("aria-current", String(object.id === objectId));
        button.disabled = busy;
        button.onclick = () => chooseObject(object.id);
        root.append(button);
      }
    }
  }
  function renderFunding(object) {
    const root = $("funding");
    root.replaceChildren();
    const rows = (db.financingRules || []).filter(
      (r) => r.objectId === object.id,
    );
    for (const [size, label] of Object.entries(BurbotFunding.sizes)) {
      const variants = rows
        .filter((r) => r.company_size === size)
        .sort((a, b) => a.variant_no - b.variant_no);
      const group = node("div", "size-group"),
        heading = node("div", "size-heading");
      heading.append(
        node("h3", "", label),
        node(
          "span",
          "",
          variants.length
            ? variants.length +
                (variants.length === 1 ? " variant" : " variants")
            : "Not configured",
        ),
      );
      group.append(heading);
      for (const variant of variants) {
        const details = node("details", "variant");
        trackExpansion(details, "funding:" + variant.id);
        const summary = node(
          "summary",
          "variant-summary",
          "Variant " + variant.variant_no,
        );
        const parts = [];
        if (C.hasValue(variant.refund_percent))
          parts.push(
            C.formatValue(
              variant.refund_percent,
              BurbotFunding.fields.refund_percent,
              db,
            ),
          );
        if (C.hasValue(variant.max_amount_pln))
          parts.push(
            "max " +
              C.formatValue(
                variant.max_amount_pln,
                BurbotFunding.fields.max_amount_pln,
                db,
              ),
          );
        summary.append(
          node("small", "", parts.join(" · ") || "Ready to capture"),
        );
        summary.append(
          node(
            "small",
            "",
            C.formatValue(
              variant.own_contribution_form,
              BurbotFunding.fields.own_contribution_form,
              db,
            ),
          ),
        );
        details.append(summary);
        for (const [field, definition] of Object.entries(BurbotFunding.fields))
          fieldRow(
            details,
            field,
            definition,
            variant,
            { kind: "funding", id: variant.id },
            label + " · Variant " + variant.variant_no,
          );
        const remove = node("button", "text-button danger", "Remove variant");
        remove.disabled = busy;
        remove.onclick = action(async () => {
          if (!confirm("Remove this funding variant and its extraction rules?"))
            return;
          await data("REMOVE_FUNDING", { objectId, variantId: variant.id });
          if (active?.target?.id === variant.id) {
            active = null;
            resetCapture();
          }
        });
        details.append(remove);
        group.append(details);
      }
      const add = node("button", "text-button", "+ Add variant");
      add.disabled = busy;
      add.onclick = action(async () => {
        const id = objectId,
          epoch = viewEpoch;
        await data("ADD_FUNDING", { objectId: id, companySize: size });
        if (epoch !== viewEpoch) return;
        const variant = db.financingRules
          .filter((r) => r.objectId === id && r.company_size === size)
          .at(-1);
        expanded.add("funding:" + variant.id);
        active = {
          field: "refund_percent",
          target: { kind: "funding", id: variant.id },
          context: label + " · Variant " + variant.variant_no,
        };
        resetCapture();
      });
      group.append(add);
      root.append(group);
    }
  }
  function renderDocuments(object) {
    const root = $("documents");
    root.replaceChildren();
    const records = (db.documentRequirements || []).filter(
      (r) => r.objectId === object.id,
    );
    const count = (requirement) =>
      records.filter((r) => r.requirement === requirement).length;
    $("document-count").textContent = records.length
      ? count("REQUIRED") + " required · " + count("OPTIONAL") + " optional"
      : "Not configured · View documents";
    const groups = new Map([
      ["Required", []],
      ["Optional", []],
      ["Internal", []],
      ["Not configured", []],
    ]);
    for (const document of BurbotDocuments.catalog) {
      const record =
        records.find((r) => r.document_type_key === document.key) || {};
      const group = document.internal
        ? "Internal"
        : record.requirement === "REQUIRED"
          ? "Required"
          : record.requirement === "OPTIONAL"
            ? "Optional"
            : "Not configured";
      groups.get(group).push({ document, record });
    }
    for (const [name, entries] of groups) {
      if (!entries.length) continue;
      const group = node("div", "document-group");
      group.append(node("h3", "", name));
      for (const { document, record } of entries) {
        const details = node("details", "document");
        trackExpansion(details, "document:" + document.key);
        const summary = node("summary"),
          copy = node("span");
        copy.append(node("span", "document-title", document.name));
        const badges = node("span", "document-badges");
        if (record.requirement)
          badges.append(
            node(
              "span",
              "badge",
              record.requirement === "REQUIRED" ? "Required" : "Optional",
            ),
          );
        if (record.auto_fill) badges.append(node("span", "badge", "Auto-fill"));
        if (document.internal) badges.append(node("span", "badge", "Internal"));
        if (!record.requirement)
          badges.append(node("span", "muted", "Not configured"));
        copy.append(badges);
        summary.append(
          node(
            "span",
            "document-mark",
            record.requirement === "REQUIRED" ? "✓" : "○",
          ),
          copy,
        );
        details.append(summary);
        for (const [field, definition] of Object.entries(
          BurbotDocuments.fields,
        ))
          fieldRow(
            details,
            field,
            definition,
            record,
            { kind: "document", id: document.key },
            document.name,
          );
        group.append(details);
      }
      root.append(group);
    }
  }
  function renderEditor() {
    const info = activeInfo();
    $("capture-area").hidden = !info;
    $("capture-hint").hidden = !chosen() || !!info;
    if (!info) return;
    const { definition, values } = info;
    $("active-label").textContent = definition.label;
    $("active-context").textContent = active.context || "";
    $("capture-source").hidden = !candidate;
    if (candidate) {
      $("method").replaceChildren(
        ...candidate.options.map((o, i) => new Option(o.label, String(i))),
      );
      $("method").value = String(methodIndex);
      $("sample").textContent = candidate.options[methodIndex]?.raw || "";
    }
    const root = $("value-control");
    root.replaceChildren();
    let input;
    if (["enum", "reference"].includes(definition.type)) {
      input = node("select");
      input.append(new Option("Choose…", ""));
      const options =
        definition.type === "enum"
          ? Object.entries(definition.options)
          : db.objects
              .filter((o) => o.type === definition.references)
              .map((o) => [o.id, C.displayName(o)]);
      for (const [value, label] of options)
        input.append(new Option(label, value));
      if (
        C.hasValue(draft) &&
        !options.some(([value]) => String(value) === String(draft))
      )
        input.append(new Option("Previously saved: " + draft, draft));
      input.value = String(draft);
    } else if (definition.type === "boolean") {
      input = node("input");
      input.type = "checkbox";
      input.checked = draft === true;
      input.indeterminate = draft === "";
      const label = node("label", "toggle-control");
      label.append(input, node("span", "", "Enable auto-fill"));
      root.append(label);
    } else {
      input = node(definition.multiline ? "textarea" : "input");
      if (input.tagName === "INPUT")
        input.type =
          definition.type === "date"
            ? "date"
            : definition.type === "url"
              ? "url"
              : definition.type === "integer"
                ? "number"
                : "text";
      if (["money", "percentage", "number"].includes(definition.type))
        input.inputMode = "decimal";
      if (definition.type === "integer") {
        input.step = "1";
        if (definition.min !== undefined) input.min = definition.min;
        if (definition.max !== undefined) input.max = definition.max;
      }
      input.value = String(draft);
    }
    input.id = "edit-value";
    input.disabled = busy;
    input.oninput = () => {
      draft = definition.type === "boolean" ? input.checked : input.value;
      input.indeterminate = false;
      controls();
    };
    if (definition.type !== "boolean") root.append(input);
    if (definition.type === "url" && C.hasValue(values[active.field])) {
      try {
        const href = C.coerce(values[active.field], "url"),
          link = node("a", "open-link", "Open saved page ↗");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        root.append(link);
      } catch {}
    }
    const rule = activeRule();
    $("rule-details").hidden = !candidate && !rule;
    $("rule").textContent = JSON.stringify(
      candidate
        ? {
            pageUrl: candidate.pageUrl,
            selector: candidate.selector,
            extraction: candidate.options[methodIndex]?.extraction,
          }
        : rule,
      null,
      2,
    );
  }
  function controls() {
    $("pick").disabled = !port || !active || busy;
    $("pick").textContent = picking ? "Cancel picker" : "Pick element";
    $("selected-text").disabled = !port || !active || busy;
    $("page-url").disabled = !port || !active || busy;
    $("connect").disabled = busy;
    $("connect").textContent = port ? "Reconnect" : "Connect";
    $("preview").disabled =
      !port ||
      !chosen() ||
      busy ||
      !db.rules.some((r) => r.objectId === objectId);
    $("apply").disabled = !preview?.results.length || busy;
    $("save").disabled = busy || !active;
    $("deselect").disabled = busy;
    $("method").disabled = busy;
    $("delete").disabled = busy;
    $("export").disabled = busy;
    if (!active) return;
    try {
      const value = C.coerceField(draft, activeInfo().definition, db);
      $("converted").textContent = candidate
        ? "Save as " + C.formatValue(value, activeInfo().definition, db)
        : activeRule()
          ? "Adjustment keeps the existing extraction rule."
          : "Manual value. Pick from the page to save an extraction rule.";
      $("save").disabled = busy || (candidate && !port);
    } catch (error) {
      $("converted").textContent = error.message;
      $("save").disabled = true;
    }
    $("save").textContent = candidate
      ? "Save rule & next"
      : "Save value & next";
  }
  function render() {
    if (!chosen()) {
      objectId = db.objects.at(-1)?.id || "";
      active = null;
      resetCapture();
    }
    const object = chosen();
    $("empty").hidden = !!object;
    $("workspace").hidden = !object;
    descriptors = [];
    if (object) {
      $("object-kind").textContent =
        BurbotSchema[object.type]?.label || object.type;
      $("object-title").textContent = C.displayName(object);
      renderSwitcher();
      const fields = normalFields(object),
        count = fields.filter(([key]) => C.hasValue(object.values[key])).length;
      $("progress").textContent =
        count + " / " + fields.length + " fields completed";
      const rules = db.rules.filter((r) => r.objectId === objectId).length;
      $("rule-count").textContent = rules + (rules === 1 ? " rule" : " rules");
      $("progress-bar").max = fields.length || 1;
      $("progress-bar").value = count;
      $("fields").replaceChildren();
      const groups = new Map();
      for (const [field, definition] of fields) {
        if (!groups.has(definition.group)) {
          const section = node("section", "field-group");
          section.append(node("h2", "", definition.group));
          groups.set(definition.group, section);
          $("fields").append(section);
        }
        fieldRow(
          groups.get(definition.group),
          field,
          definition,
          object.values,
        );
      }
      const configured = !!BurbotSchema[object.type]?.configuration;
      $("funding-section").hidden = !configured;
      $("documents-section").hidden = !configured;
      if (configured) {
        renderFunding(object);
        renderDocuments(object);
      }
      if (active && !descriptors.some((d) => keyOf(d) === keyOf(active))) {
        active = null;
        resetCapture();
      }
    }
    $("results").hidden = !preview;
    renderEditor();
    controls();
  }
  function action(handler) {
    return async (event) => {
      event?.preventDefault();
      if (busy) return;
      busy = true;
      render();
      try {
        await handler(event);
      } catch (error) {
        notice(error.message, true);
        try {
          await data("GET");
        } catch {}
        preview = null;
      } finally {
        busy = false;
        render();
      }
    };
  }

  $("connect").onclick = () => {
    void connect();
  };
  $("pick").onclick = action(async () => {
    await rpc(picking ? "STOP" : "PICK");
  });
  $("selected-text").onclick = action(async () => {
    acceptCapture(await rpc("SELECTION"));
  });
  $("page-url").onclick = action(async () => {
    const url = await rpc("URL");
    acceptCapture(createPageUrlCandidate(url));
  });
  $("method").onchange = () => {
    methodIndex = Number($("method").value);
    updateDraftFromCapture();
    renderEditor();
    controls();
  };
  $("deselect").onclick = () => {
    if (port && picking) void rpc("STOP").catch(() => {});
    active = null;
    resetCapture();
    render();
  };
  $("save").onclick = action(async () => {
    const id = objectId,
      selected = active,
      epoch = viewEpoch,
      revision = db.revision,
      value = draft,
      capture = candidate;
    const payload = {
      objectId: id,
      field: selected.field,
      target: selected.target,
      value,
      expectedRevision: revision,
    };
    if (capture) {
      const option = capture.options[methodIndex];
      if (!option) throw Error("Choose an extraction method.");
      if ((await rpc("URL")) !== capture.pageUrl || epoch !== viewEpoch)
        throw Error("The page changed. Capture the value again.");
      payload.candidate = createCapturedExtractionInput(capture, option);
    }
    await data(capture ? "ASSIGN" : "EDIT", payload);
    if (epoch !== viewEpoch) return;
    // Continue within the object or the chosen configuration item, not an
    // unrelated document whose requirements have never been configured.
    const siblings = descriptors.filter(
      (d) => C.targetKey(d.target) === C.targetKey(selected.target),
    );
    const index = siblings.findIndex((d) => keyOf(d) === keyOf(selected));
    const next = siblings.slice(index + 1).find((d) => {
      const info = C.fieldContext(db, chosen(), d.field, d.target);
      return !C.hasValue(info.values[d.field]);
    });
    active = next || null;
    if (next?.target) expanded.add(next.target.kind + ":" + next.target.id);
    if (next?.target?.kind === "document") $("documents-panel").open = true;
    resetCapture();
    notice(capture ? "Extraction rule saved." : "Value saved.");
  });
  $("preview").onclick = action(async () => {
    const id = objectId,
      revision = db.revision,
      epoch = viewEpoch;
    const rules = db.rules.filter((r) => r.objectId === id);
    const results = await rpc("RUN", { rules });
    if (epoch !== viewEpoch || db.revision !== revision)
      throw Error("Page or object changed. Preview again.");
    const successful = [];
    $("result-list").replaceChildren();
    for (const result of results) {
      const rule = rules.find((r) => r.id === result.ruleId),
        row = node("div", "result");
      try {
        if (result.error) throw Error(result.error);
        const info = C.fieldContext(db, chosen(), rule.field, rule.target);
        const value = C.ruleValue(db, chosen(), rule, result.raw);
        row.textContent =
          info.definition.label +
          "\n" +
          C.formatValue(info.values[rule.field], info.definition, db) +
          " → " +
          C.formatValue(value, info.definition, db);
        successful.push({ ruleId: rule.id, raw: result.raw });
      } catch (error) {
        row.classList.add("error");
        row.textContent = (rule?.field || "Field") + ": " + error.message;
      }
      $("result-list").append(row);
    }
    preview = { objectId: id, revision, results: successful };
    notice("Review the values before applying.");
  });
  $("apply").onclick = action(async () => {
    const snapshot = preview;
    await data("APPLY", {
      objectId: snapshot.objectId,
      expectedRevision: snapshot.revision,
      results: snapshot.results,
    });
    preview = null;
    resetCapture();
    notice("Successful results applied. Other values were kept.");
  });
  $("delete").onclick = action(async () => {
    if (
      !confirm(
        'Delete "' + C.displayName(chosen()) + '" and its extraction rules?',
      )
    )
      return;
    await data("DELETE", { objectId });
    objectId = "";
    active = null;
    resetCapture();
    $("more").open = false;
  });
  $("export").onclick = action(async () => {
    const saved = await data("GET");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }),
    );
    const link = node("a");
    link.href = url;
    link.download = "burbot-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("more").open = false;
  });
  browser.runtime.onMessage.addListener((message) => {
    if (message?.windowId !== windowId) return undefined;
    if (message.type === "BURBOT_CONNECT") void connect();
    if (message.type === "BURBOT_FOCUS")
      void receiveFocus(message).catch((error) => notice(error.message, true));
    // Never return the GET promise: creation broadcasts while holding the write queue.
    return undefined;
  });
  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) void connect();
  });
  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== tabId) return;
    if (change.status === "loading") {
      disconnect();
      $("connection").textContent = "Page loading…";
      render();
    } else if (change.status === "complete" || change.url) void connect();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["burbot:v1"]?.newValue) {
      adopt(changes["burbot:v1"].newValue);
      render();
    }
  });
  window.addEventListener("pagehide", disconnect);
  (async () => {
    windowId = (await browser.windows.getCurrent()).id;
    await data("GET");
    ready = true;
    await receiveFocus(await data("GET_FOCUS", { windowId }));
    render();
    if (!port) await connect();
  })().catch((error) => notice(error.message, true));
})();
