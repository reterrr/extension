import {
  createCapturedExtractionInput,
  createPageUrlCandidate,
} from "../shared/extraction/rules";
import {
  buildGeographySearchIndex,
  compileObjectSearch,
  createObjectSearchDocument,
} from "../shared/search/objectSearch.js";
import {
  aiViewExportFilename,
  createAiViewExport,
} from "../shared/export/aiViewExport.js";
import {
  OBJECT_VIEW_STORAGE_KEY,
  createObjectView,
  normalizeObjectView,
  objectInView,
  objectsInView,
} from "../shared/search/objectView.js";
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
    ready = false,
    switcherQuery = "",
    switcherType = "all",
    objectView = null;
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
  function publishSelectorPreview() {
    let detail = null;
    if (
      active &&
      candidate &&
      typeof candidate.selector === "string" &&
      candidate.selector.length > 0
    ) {
      const option = candidate.options[methodIndex];
      const quote =
        option?.extraction?.type === "selection"
          ? option.extraction.quote
          : undefined;
      detail = {
        objectId,
        field: active.field,
        targetKey: C.targetKey(active.target),
        pageUrl: candidate.pageUrl,
        highlight: {
          id:
            "preview:" +
            objectId +
            ":" +
            C.targetKey(active.target) +
            ":" +
            active.field,
          selector: candidate.selector,
          ...(candidate.selectorFallbacks?.length
            ? { selectorFallbacks: candidate.selectorFallbacks }
            : {}),
          ...(quote ? { quote } : {}),
        },
      };
    }
    window.dispatchEvent(
      new CustomEvent("burbot:selector-capture-preview", { detail }),
    );
  }
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

  function normalizedObjectView() {
    objectView = normalizeObjectView(objectView, db.objects);
    return objectView;
  }

  function renderObjectViewIndicator() {
    const root = $("active-object-view");
    if (!root) return;
    const view = normalizedObjectView();
    root.hidden = !view;
    if (!view) return;
    const count = view.objectIds.length;
    $("active-object-view-count").textContent =
      count + (count === 1 ? " obiekt" : " obiektów");
    const query = view.query || (view.type !== "all" ? "type:" + view.type : "");
    $("active-object-view-query").textContent = query;
    $("active-object-view-query").hidden = !query;
    root.title = query
      ? "Widok utworzony z: " + query
      : "Tymczasowy widok roboczy";
  }

  async function persistObjectView(next) {
    objectView = normalizeObjectView(next, db.objects);
    if (objectView) {
      await browser.storage.session.set({
        [OBJECT_VIEW_STORAGE_KEY]: objectView,
      });
    } else {
      await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
    }
  }

  async function setObjectView(objects, query, type) {
    const next = createObjectView(
      objects,
      query,
      type,
      new Date().toISOString(),
    );
    await persistObjectView(next);
    if (!objectInView(objectView, objectId)) {
      objectId = objectView.objectIds[0] || "";
      active = null;
      preview = null;
      resetCapture();
    }
    switcherQuery = "";
    switcherType = "all";
    $("switcher").open = false;
    render();
    notice("Widok roboczy ustawiony: " + objectView.objectIds.length + " obiektów.");
  }

  async function clearObjectView() {
    objectView = null;
    await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
    switcherQuery = "";
    switcherType = "all";
    render();
    notice("Widok wyczyszczony. Pokazuję wszystkie obiekty.");
  }
  function downloadJsonFile(filename, value) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json",
      }),
    );
    const link = node("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportObjectViewForAi() {
    const view = normalizedObjectView();
    if (!view) throw new Error("Najpierw ustaw View z wyników wyszukiwania.");
    const exportedAt = new Date().toISOString();
    const payload = createAiViewExport({
      state: db,
      view,
      schema: BurbotSchema,
      geographyCatalog: BurbotGeography?.catalog || [],
      documentCatalog: BurbotDocuments?.catalog || [],
      exportedAt,
    });
    downloadJsonFile(aiViewExportFilename(exportedAt), payload);
    notice("Wyeksportowano View dla AI: " + payload.objects.length + " obiektów.");
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
    if (result.value?.objects && Array.isArray(result.value.rules)) {
      window.dispatchEvent(
        new CustomEvent("burbot:workspace-state-changed", {
          detail: { state: result.value },
        }),
      );
    }
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
    publishSelectorPreview();
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
    publishSelectorPreview();
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
    const readOnly = Boolean(definition.readonly || definition.system);
    if (!readOnly) descriptors.push(descriptor);
    const button = node(
      "button",
      "field-row" +
        (keyOf(active) === keyOf(descriptor) ? " selected" : "") +
        (readOnly ? " system-field" : ""),
    );
    button.type = "button";
    button.dataset.field = field;
    button.dataset.target = C.targetKey(target);
    button.setAttribute(
      "aria-pressed",
      String(!readOnly && keyOf(active) === keyOf(descriptor)),
    );
    if (readOnly) {
      button.setAttribute("aria-readonly", "true");
      button.tabIndex = -1;
    }
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
    button.append(
      copy,
      node("span", "field-mark", readOnly ? (set ? "AUTO" : "") : set ? "✓" : ""),
    );
    if (!readOnly) button.onclick = () => selectField(descriptor);
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
    const switcher = $("switcher");
    root.dataset.activeObjectId = objectId;
    root.replaceChildren();

    const local = (object) =>
      pageUrl &&
      (object.sourceUrl === pageUrl ||
        db.rules.some(
          (r) => r.objectId === object.id && r.pageUrl === pageUrl,
        ));

    const objectKind = (object) =>
      object.type === "nabor" ? "recruitment" : object.type;

    const geographyByObject = buildGeographySearchIndex(
      db.geographies || [],
      BurbotGeography?.catalog || [],
    );

    const geographySearch = (object) =>
      geographyByObject.get(object.id) || {};

    const scopedObjects = objectsInView(db.objects, normalizedObjectView());

    const picker = node("div", "object-picker");
    const toolbar = node("div", "object-picker-toolbar");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "object-picker-search";
    search.placeholder = "Szukaj projektu, operatora lub naboru…";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "Szukaj obiektu");
    search.value = switcherQuery;

    const filters = node("div", "object-picker-filters");
    const filterOptions = [
      ["all", "Wszystkie"],
      ["project", "Projekty"],
      ["operator", "Operatorzy"],
      ["recruitment", "Nabory"],
    ];
    for (const [value, label] of filterOptions) {
      const button = node("button", "object-picker-filter", label);
      button.type = "button";
      button.dataset.type = value;
      button.setAttribute("aria-pressed", String(switcherType === value));
      button.onclick = () => {
        switcherType = value;
        renderResults();
        search.focus();
      };
      filters.append(button);
    }

    const searchFeedback = node("div", "object-picker-search-feedback");
    const syntaxHint = node(
      "small",
      "object-picker-search-hint",
      'Obsługuje: * wildcard · /regex/i · type:projekty · geo:śląskie · powiat:rzeszowski',
    );
    searchFeedback.append(syntaxHint);

    const viewActions = node("div", "object-picker-view-actions");
    const viewInfo = node("span", "object-picker-view-info");
    const setViewButton = node("button", "object-picker-set-view");
    setViewButton.type = "button";
    const clearViewButton = node(
      "button",
      "object-picker-clear-view",
      "Wyczyść widok",
    );
    clearViewButton.type = "button";
    clearViewButton.hidden = !objectView;
    clearViewButton.onclick = () => {
      void clearObjectView().catch((error) => notice(error.message, true));
    };
    viewActions.append(viewInfo, setViewButton, clearViewButton);

    toolbar.append(search, filters, searchFeedback, viewActions);
    const results = node("div", "object-picker-results");
    picker.append(toolbar, results);
    root.append(picker);

    let currentMatches = [];

    const visibleButtons = () =>
      Array.from(results.querySelectorAll("button.object-option"));

    const focusRelative = (button, direction) => {
      const buttons = visibleButtons();
      if (!buttons.length) return;
      const current = Math.max(0, buttons.indexOf(button));
      const next = (current + direction + buttons.length) % buttons.length;
      buttons[next].focus();
    };

    const chooseFromKeyboard = (button, event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRelative(button, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusRelative(button, -1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        switcher.open = false;
        switcher.querySelector("summary")?.focus();
      }
    };

    function objectButton(object) {
      const button = node("button", "object-option");
      button.type = "button";
      button.dataset.objectId = object.id;
      button.setAttribute("aria-current", String(object.id === objectId));
      button.disabled = busy;

      const copy = node("span", "object-option-copy");
      copy.append(node("strong", "object-option-name", C.displayName(object)));

      const typeLabel = BurbotSchema[object.type]?.label || object.type;
      const meta = [];
      meta.push(typeLabel);
      if (object.values?.number) meta.push(String(object.values.number));
      else if (object.values?.external_number)
        meta.push(String(object.values.external_number));
      else if (object.values?.nip) meta.push("NIP " + object.values.nip);
      copy.append(node("small", "object-option-meta", meta.join(" · ")));

      button.append(copy);
      if (object.id === objectId)
        button.append(node("span", "object-option-current", "✓"));

      button.onclick = () => chooseObject(object.id);
      button.onkeydown = (event) => chooseFromKeyboard(button, event);
      return button;
    }

    function appendGroup(title, objects) {
      if (!objects.length) return;
      const group = node("section", "object-picker-group");
      const heading = node("div", "switch-group");
      heading.append(
        node("span", "", title),
        node("small", "object-picker-count", String(objects.length)),
      );
      group.append(heading);
      for (const object of objects) group.append(objectButton(object));
      results.append(group);
    }

    function renderResults() {
      results.replaceChildren();
      for (const button of filters.querySelectorAll(".object-picker-filter")) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.type === switcherType),
        );
      }

      const compiled = compileObjectSearch(switcherQuery);
      search.classList.toggle("is-invalid", Boolean(compiled.error));
      search.setAttribute("aria-invalid", String(Boolean(compiled.error)));
      searchFeedback.replaceChildren();
      if (compiled.error) {
        searchFeedback.append(
          node("small", "object-picker-search-error", compiled.error),
        );
      } else {
        searchFeedback.append(syntaxHint);
      }

      const matches = (object) => {
        if (switcherType !== "all" && objectKind(object) !== switcherType)
          return false;
        const typeLabel = BurbotSchema[object.type]?.label || object.type;
        return compiled.matches(
          createObjectSearchDocument(
            object,
            C.displayName(object),
            typeLabel,
            geographySearch(object),
          ),
        );
      };

      currentMatches = scopedObjects.filter(matches);
      const localObjects = [...currentMatches.filter((o) => local(o))].reverse();
      const saved = currentMatches.filter((o) => !local(o));

      const hasRestriction =
        Boolean(switcherQuery.trim()) || switcherType !== "all";
      viewInfo.textContent = objectView
        ? "Aktywny widok: " + scopedObjects.length + " obiektów"
        : "Wyniki: " + currentMatches.length;
      setViewButton.textContent = objectView
        ? hasRestriction
          ? "Zawęź widok · " + currentMatches.length
          : "Widok aktywny · " + scopedObjects.length
        : hasRestriction
          ? "Ustaw widok · " + currentMatches.length
          : "Wyszukaj obiekty, aby ustawić widok";
      setViewButton.disabled =
        Boolean(compiled.error) || !currentMatches.length || !hasRestriction;
      clearViewButton.hidden = !objectView;

      appendGroup("Na tej stronie", localObjects);
      appendGroup(
        "Projekty",
        [...saved.filter((o) => objectKind(o) === "project")].reverse(),
      );
      appendGroup(
        "Operatorzy",
        [...saved.filter((o) => objectKind(o) === "operator")].reverse(),
      );
      appendGroup(
        "Nabory",
        [...saved.filter((o) => objectKind(o) === "recruitment")].reverse(),
      );

      if (!results.childElementCount) {
        const empty = node("div", "object-picker-empty");
        empty.append(
          node("strong", "", "Brak pasujących obiektów"),
          node("small", "", "Zmień wyszukiwanie albo filtr typu."),
        );
        results.append(empty);
      }
    }

    setViewButton.onclick = () => {
      if (setViewButton.disabled) return;
      void setObjectView(
        currentMatches,
        switcherQuery,
        switcherType,
      ).catch((error) => notice(error.message, true));
    };

    search.oninput = () => {
      switcherQuery = search.value;
      renderResults();
    };
    search.onkeydown = (event) => {
      const buttons = visibleButtons();
      if (event.key === "ArrowDown" && buttons.length) {
        event.preventDefault();
        buttons[0].focus();
      } else if (event.key === "ArrowUp" && buttons.length) {
        event.preventDefault();
        buttons.at(-1).focus();
      } else if (event.key === "Enter" && buttons.length) {
        event.preventDefault();
        buttons[0].click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        switcher.open = false;
        switcher.querySelector("summary")?.focus();
      }
    };

    switcher.ontoggle = () => {
      if (!switcher.open) return;
      switcherQuery = "";
      switcherType = "all";
      search.value = "";
      renderResults();
      requestAnimationFrame(() => search.focus());
    };

    renderResults();
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
        const hasMin = C.hasValue(variant.refund_percent_min),
          hasMax = C.hasValue(variant.refund_percent_max);
        if (hasMin || hasMax) {
          const minText = hasMin
              ? C.formatValue(
                  variant.refund_percent_min,
                  BurbotFunding.fields.refund_percent_min,
                  db,
                )
              : "",
            maxText = hasMax
              ? C.formatValue(
                  variant.refund_percent_max,
                  BurbotFunding.fields.refund_percent_max,
                  db,
                )
              : "";
          if (hasMin && hasMax)
            parts.push(
              minText === maxText
                ? minText
                : minText.replace(/%$/, "") + "–" + maxText,
            );
          else if (hasMin) parts.push("od " + minText);
          else parts.push("do " + maxText);
        } else if (C.hasValue(variant.refund_percent_standard)) {
          parts.push(
            C.formatValue(
              variant.refund_percent_standard,
              BurbotFunding.fields.refund_percent_standard,
              db,
            ),
          );
        } else if (C.hasValue(variant.refund_percent_base)) {
          parts.push(
            "baza " +
              C.formatValue(
                variant.refund_percent_base,
                BurbotFunding.fields.refund_percent_base,
                db,
              ),
          );
        } else if (C.hasValue(variant.refund_percent)) {
          // Compatibility before an old state/import has been normalized.
          parts.push(
            C.formatValue(
              variant.refund_percent,
              BurbotFunding.fields.refund_percent,
              db,
            ),
          );
        }
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
          field: "refund_percent_min",
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
    renderObjectViewIndicator();
    if (!chosen()) {
      objectId =
        objectsInView(db.objects, normalizedObjectView()).at(0)?.id ||
        db.objects.at(-1)?.id ||
        "";
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
        businessFields = fields.filter(([, definition]) => !definition.system),
        count = businessFields.filter(([key]) => C.hasValue(object.values[key])).length;
      $("progress").textContent =
        count + " / " + businessFields.length + " fields completed";
      const rules = db.rules.filter((r) => r.objectId === objectId).length;
      $("rule-count").textContent = rules + (rules === 1 ? " rule" : " rules");
      $("progress-bar").max = businessFields.length || 1;
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
  $("export-object-view").onclick = () => {
    try {
      exportObjectViewForAi();
    } catch (error) {
      notice(error.message, true);
    }
  };
  $("clear-object-view").onclick = () => {
    void clearObjectView().catch((error) => notice(error.message, true));
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
    publishSelectorPreview();
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
    downloadJsonFile(
      "burbot-" + new Date().toISOString().slice(0, 10) + ".json",
      saved,
    );
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
    if (area === "session" && changes[OBJECT_VIEW_STORAGE_KEY]) {
      objectView = normalizeObjectView(
        changes[OBJECT_VIEW_STORAGE_KEY].newValue,
        db.objects,
      );
      render();
    }
  });
  window.addEventListener("pagehide", disconnect);
  (async () => {
    windowId = (await browser.windows.getCurrent()).id;
    await data("GET");
    const storedView = await browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY);
    objectView = normalizeObjectView(storedView[OBJECT_VIEW_STORAGE_KEY], db.objects);
    ready = true;
    await receiveFocus(await data("GET_FOCUS", { windowId }));
    render();
    if (!port) await connect();
  })().catch((error) => notice(error.message, true));
})();
