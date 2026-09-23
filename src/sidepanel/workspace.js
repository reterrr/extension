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
  addObjectToView,
  createObjectView,
  normalizeObjectView,
  objectInView,
  objectsInView,
  removeObjectFromView,
} from "../shared/search/objectView.js";
import { createPickerClient } from "./pickerRpc";
import {
  patchSidepanelUiState,
  readSidepanelUiState,
} from "./uiSessionState";

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
    evidenceCandidate = null,
    evidenceMethodIndex = 0,
    evidencePicking = false,
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
    switcherScrollTop = 0,
    uiPersistTimer = null,
    pendingViewportAnchor = null,
    objectView = null;
  const expanded = new Set();
  const chosen = () => db.objects.find((o) => o.id === objectId);
  const keyOf = (descriptor) =>
    descriptor ? C.targetKey(descriptor.target) + "/" + descriptor.field : "";
  const fieldEvidenceFor = (descriptor = active) =>
    descriptor
      ? (db.fieldEvidence || []).filter(
          (entry) =>
            entry.objectId === objectId &&
            entry.field === descriptor.field &&
            C.targetKey(entry.target) === C.targetKey(descriptor.target),
        )
      : [];

  const evidenceKindLabel = (entry) => {
    const type = entry?.extraction?.type;
    if (type === "selection") return "Zaznaczenie";
    if (type === "pageUrl") return "URL strony";
    if (type === "attribute")
      return entry.extraction.attribute === "href" ? "Link" : "Atrybut";
    if (type === "text") return "Element";
    return "Evidence";
  };

  function activeUiState() {
    if (!active || !objectId) return null;
    return {
      objectId,
      field: active.field,
      ...(active.target ? { target: active.target } : {}),
      ...(active.context ? { context: active.context } : {}),
    };
  }

  function persistWorkspaceUi(extra = {}) {
    if (!Number.isInteger(windowId)) return Promise.resolve();
    return patchSidepanelUiState(windowId, {
      workspace: {
        objectId,
        focusStamp,
        active: activeUiState(),
        expanded: [...expanded],
        switcher: {
          query: switcherQuery,
          type: switcherType,
          scrollTop: switcherScrollTop,
        },
        ...extra,
      },
    });
  }

  function scheduleWorkspaceUiPersist(extra = {}) {
    if (uiPersistTimer !== null) clearTimeout(uiPersistTimer);
    uiPersistTimer = setTimeout(() => {
      uiPersistTimer = null;
      void persistWorkspaceUi(extra);
    }, 100);
  }

  function rememberViewportAnchor(selector, focus = false) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return;
    pendingViewportAnchor = {
      selector,
      top: element.getBoundingClientRect().top,
      focus,
    };
  }

  function restoreViewportAnchor() {
    if (busy) return;
    const anchor = pendingViewportAnchor;
    pendingViewportAnchor = null;
    if (!anchor) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const element = document.querySelector(anchor.selector);
        if (!(element instanceof HTMLElement)) return;
        const delta = element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);

        const dock = $("capture-area");
        if (dock && !dock.hidden) {
          const rect = element.getBoundingClientRect();
          const dockTop = dock.getBoundingClientRect().top;
          if (rect.bottom > dockTop - 10) {
            window.scrollBy(0, rect.bottom - dockTop + 10);
          }
        }

        if (anchor.focus) {
          try {
            element.focus({ preventScroll: true });
          } catch {
            element.focus();
          }
        }
      });
    });
  }

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
    $("switcher").open = false;
    scheduleWorkspaceUiPersist();
    render();
    notice("Widok roboczy ustawiony: " + objectView.objectIds.length + " obiektów.");
  }

  async function clearObjectView() {
    objectView = null;
    await browser.storage.session.remove(OBJECT_VIEW_STORAGE_KEY);
    scheduleWorkspaceUiPersist();
    render();
    notice("Widok wyczyszczony. Pokazuję wszystkie obiekty.");
  }

  async function addToObjectView(id) {
    const next = addObjectToView(objectView, id, db.objects);
    await persistObjectView(next);
    render();
    notice("Dodano obiekt do View.");
  }

  async function removeFromObjectView(id) {
    if (!objectView) {
      throw new Error("Najpierw ustaw aktywny View.");
    }
    const next = removeObjectFromView(objectView, id, db.objects);
    await persistObjectView(next);
    if (objectId === id && !objectInView(objectView, id)) {
      objectId = objectView?.objectIds?.[0] || "";
      active = null;
      preview = null;
      resetCapture();
    }
    render();
    notice("Usunięto obiekt z View.");
  }

  async function stageCurrentObject() {
    if (!objectId) throw new Error("Wybierz obiekt.");
    const result = await browser.runtime.sendMessage({
      type: "BURBOT_COMMIT",
      op: "STAGE_OBJECT",
      objectId,
    });
    if (!result?.ok) throw new Error(result?.error || "Nie udało się dodać do commita.");
    window.dispatchEvent(new Event("burbot:commit-changed"));
    await syncObjectWorkflowControls();
    notice("Obiekt dodany do Commit.");
  }

  async function syncObjectWorkflowControls() {
    const stage = $("stage-object");
    const remove = $("remove-object-from-view");
    if (!stage || !remove) return;

    remove.hidden = !objectView || !objectInView(objectView, objectId);
    if (!objectId) {
      stage.disabled = true;
      stage.textContent = "Dodaj do Commit";
      return;
    }

    const response = await browser.runtime.sendMessage({
      type: "BURBOT_COMMIT",
      op: "GET",
    });
    if (!response?.ok) {
      stage.disabled = true;
      return;
    }
    const entry = response.value?.objects?.find((object) => object.id === objectId);
    const changed = entry && entry.status !== "UNCHANGED";
    stage.disabled = busy || !changed || Boolean(entry?.staged);
    stage.textContent = entry?.staged
      ? "✓ W Commit"
      : changed
        ? "Dodaj do Commit"
        : "Brak zmian";
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
    evidenceCandidate = null;
    evidenceMethodIndex = 0;
    evidencePicking = false;
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
          if (!busy && active) {
            if (evidencePicking) acceptEvidenceCapture(message.candidate);
            else acceptCapture(message.candidate);
          }
        } else if (message.event === "ERROR") notice(message.error, true);
        else if (message.event === "MODE") {
          picking = message.picking;
          if (!message.picking) evidencePicking = false;
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
        !definition.hidden &&
        (!definition.legacy ||
          C.hasValue(object.values[key]) ||
          db.rules.some((r) => C.matches(r, object.id, key))),
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
    scheduleWorkspaceUiPersist();
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
      scheduleWorkspaceUiPersist();
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
    scheduleWorkspaceUiPersist();
    if (descriptor.target?.kind === "funding")
      expanded.add("funding:" + descriptor.target.id);
    if (descriptor.target?.kind === "operator_contact") {
      expanded.add("operator_contact:" + descriptor.target.id);
      $("operator-contacts-panel").open = true;
    }
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
  function acceptEvidenceCapture(value) {
    if (!active || !chosen()) {
      notice("Najpierw wybierz pole.");
      return;
    }
    evidenceCandidate = value;
    evidenceMethodIndex = 0;
    const href = value.options.findIndex(
      (option) => option.extraction?.type === "attribute" && option.extraction.attribute === "href",
    );
    const text = value.options.findIndex(
      (option) => option.extraction?.type === "text",
    );
    if (href >= 0 && activeInfo()?.definition?.type === "url")
      evidenceMethodIndex = href;
    else if (text >= 0)
      evidenceMethodIndex = text;
    evidencePicking = false;
    renderEditor();
    controls();
    notice("Evidence przygotowane. Sprawdź podgląd i zapisz.");
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
    const evidenceCount = readOnly ? 0 : fieldEvidenceFor(descriptor).length;
    button.dataset.evidenceCount = String(evidenceCount);
    const markText = readOnly
      ? set
        ? "AUTO"
        : ""
      : [set ? "✓" : "", evidenceCount ? "EV " + evidenceCount : ""]
          .filter(Boolean)
          .join(" · ");
    button.append(copy, node("span", "field-mark", markText));
    if (!readOnly) button.onclick = () => selectField(descriptor);
    container.append(button);
  }
  function trackExpansion(details, key) {
    details.open = expanded.has(key);
    details.addEventListener("toggle", () => {
      if (!details.isConnected) return;
      details.open ? expanded.add(key) : expanded.delete(key);
      scheduleWorkspaceUiPersist();
    });
  }
  function renderSwitcher() {
    const root = $("object-options");
    const switcher = $("switcher");
    root.dataset.activeObjectId = objectId;
    root.replaceChildren();

    const view = normalizedObjectView();
    const scopedObjects = objectsInView(db.objects, view);
    const objectKind = (object) =>
      object.type === "nabor" ? "recruitment" : object.type;

    const picker = node("div", "object-picker object-picker-view-only");
    const toolbar = node("div", "object-picker-toolbar");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "object-picker-search";
    search.placeholder = view
      ? "Szukaj w aktywnym View…"
      : "Szukaj w bazie…";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "Szukaj obiektu do otwarcia");
    search.value = switcherQuery;

    const feedback = node("div", "object-picker-search-feedback");
    toolbar.append(search, feedback);

    const results = node("div", "object-picker-results");
    picker.append(toolbar, results);
    root.append(picker);

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
      const meta = [typeLabel];
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
      feedback.replaceChildren();

      const compiled = compileObjectSearch(switcherQuery);
      search.classList.toggle("is-invalid", Boolean(compiled.error));
      search.setAttribute("aria-invalid", String(Boolean(compiled.error)));

      if (compiled.error) {
        feedback.append(
          node("small", "object-picker-search-error", compiled.error),
        );
        return;
      }

      feedback.append(
        node(
          "small",
          "object-picker-search-hint",
          view
            ? "Przełącznik pokazuje wyłącznie obiekty należące do aktywnego View."
            : "Brak aktywnego View — przełącznik pokazuje całą bazę.",
        ),
      );

      const matches = scopedObjects.filter((object) => {
        const typeLabel = BurbotSchema[object.type]?.label || object.type;
        return compiled.matches(
          createObjectSearchDocument(
            object,
            C.displayName(object),
            typeLabel,
            {},
          ),
        );
      });

      appendGroup(
        "Projekty",
        matches.filter((o) => objectKind(o) === "project"),
      );
      appendGroup(
        "Operatorzy",
        matches.filter((o) => objectKind(o) === "operator"),
      );
      appendGroup(
        "Nabory",
        matches.filter((o) => objectKind(o) === "recruitment"),
      );

      if (!results.childElementCount) {
        const empty = node("div", "object-picker-empty");
        empty.append(
          node(
            "strong",
            "",
            view && !view.objectIds.length
              ? "Aktywny View jest pusty"
              : "Brak pasujących obiektów",
          ),
          node(
            "small",
            "",
            view
              ? "Dodaj obiekty w panelu Active View powyżej."
              : "Zmień wyszukiwanie.",
          ),
        );
        results.append(empty);
      }
    }

    search.oninput = () => {
      switcherQuery = search.value;
      scheduleWorkspaceUiPersist();
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

    results.onscroll = () => {
      switcherScrollTop = results.scrollTop;
      scheduleWorkspaceUiPersist();
    };

    switcher.ontoggle = () => {
      if (!switcher.open) {
        switcherScrollTop = results.scrollTop;
        scheduleWorkspaceUiPersist();
        return;
      }
      search.value = switcherQuery;
      renderResults();
      requestAnimationFrame(() => {
        results.scrollTop = switcherScrollTop;
        search.focus();
      });
    };

    renderResults();
    requestAnimationFrame(() => {
      results.scrollTop = switcherScrollTop;
    });
  }
  function renderOperatorContacts(object) {
    const root = $("operator-contacts");
    root.replaceChildren();
    const rows = (db.operatorContacts || []).filter(
      (r) => r.objectId === object.id,
    );
    $("operator-contact-count").textContent = rows.length
      ? rows.length + (rows.length === 1 ? " kontakt" : " kontaktów")
      : "Brak kontaktów";

    for (const [kind, label] of Object.entries(BurbotOperatorContacts.kinds)) {
      const variants = rows
        .filter((row) => row.kind === kind)
        .sort((a, b) => a.variant_no - b.variant_no);
      const group = node("div", "size-group");
      const heading = node("div", "size-heading");
      heading.append(
        node("h3", "", label),
        node(
          "span",
          "",
          variants.length
            ? variants.length +
                (variants.length === 1 ? " wariant" : " wariantów")
            : "Brak",
        ),
      );
      group.append(heading);

      for (const variant of variants) {
        const details = node("details", "variant");
        trackExpansion(details, "operator_contact:" + variant.id);
        const summary = node(
          "summary",
          "variant-summary",
          label + " " + variant.variant_no,
        );
        summary.append(
          node(
            "small",
            "",
            C.hasValue(variant.value) ? String(variant.value) : "Nie ustawiono",
          ),
        );
        details.append(summary);

        const grid = node("div", "funding-field-grid");
        fieldRow(
          grid,
          "value",
          BurbotOperatorContacts.fields[kind].value,
          variant,
          { kind: "operator_contact", id: variant.id },
          label + " · Wariant " + variant.variant_no,
        );
        details.append(grid);

        const remove = node("button", "text-button danger", "Usuń kontakt");
        remove.disabled = busy;
        remove.onclick = action(async () => {
          if (!confirm("Usunąć ten kontakt i jego reguły ekstrakcji?")) return;
          rememberViewportAnchor(
            '[data-operator-contact-add="' + kind + '"]',
          );
          await data("REMOVE_OPERATOR_CONTACT", {
            objectId,
            contactId: variant.id,
          });
          if (active?.target?.id === variant.id) {
            active = null;
            resetCapture();
          }
        });
        details.append(remove);
        group.append(details);
      }

      const add = node("button", "text-button", "+ Dodaj " + label.toLowerCase());
      add.dataset.operatorContactAdd = kind;
      add.disabled = busy;
      add.onclick = action(async () => {
        rememberViewportAnchor(
          '[data-operator-contact-add="' + kind + '"]',
          true,
        );
        const id = objectId,
          epoch = viewEpoch;
        await data("ADD_OPERATOR_CONTACT", {
          objectId: id,
          contactKind: kind,
        });
        if (epoch !== viewEpoch) return;
        const variant = (db.operatorContacts || [])
          .filter((row) => row.objectId === id && row.kind === kind)
          .sort((a, b) => a.variant_no - b.variant_no)
          .at(-1);
        if (!variant) throw Error("Nie udało się utworzyć kontaktu.");
        expanded.add("operator_contact:" + variant.id);
        active = {
          field: "value",
          target: { kind: "operator_contact", id: variant.id },
          context: label + " · Wariant " + variant.variant_no,
        };
        resetCapture();
        scheduleWorkspaceUiPersist();
      });
      group.append(add);
      root.append(group);
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
                (variants.length === 1 ? " wariant" : " wariantów")
            : "Nie skonfigurowano",
        ),
      );
      group.append(heading);
      for (const variant of variants) {
        const details = node("details", "variant");
        trackExpansion(details, "funding:" + variant.id);
        const summary = node(
          "summary",
          "variant-summary",
          "Wariant " + variant.variant_no,
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
          node("small", "", parts.join(" · ") || "Brak danych"),
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

        const fundingFieldGroups = new Map();
        for (const [field, definition] of Object.entries(BurbotFunding.fields)) {
          const groupName = definition.group || "Inne";
          if (!fundingFieldGroups.has(groupName))
            fundingFieldGroups.set(groupName, []);
          fundingFieldGroups.get(groupName).push([field, definition]);
        }

        for (const [groupName, fields] of fundingFieldGroups) {
          const section = node("section", "funding-field-group");
          section.dataset.group = groupName;

          const groupHeading = node("div", "funding-field-group-heading");
          const headingCopy = node("div", "funding-field-group-heading-copy");
          headingCopy.append(node("strong", "", groupName));

          const filled = fields.filter(([field]) =>
            C.hasValue(variant[field]),
          ).length;
          headingCopy.append(
            node(
              "small",
              "",
              filled + "/" + fields.length + " pól",
            ),
          );

          const unit = groupName.includes("(%)")
            ? "%"
            : groupName.includes("(PLN)")
              ? "PLN"
              : "";
          groupHeading.append(headingCopy);
          if (unit)
            groupHeading.append(
              node("span", "funding-field-group-unit", unit),
            );

          const grid = node("div", "funding-field-grid");
          for (const [field, definition] of fields)
            fieldRow(
              grid,
              field,
              definition,
              variant,
              { kind: "funding", id: variant.id },
              label + " · Wariant " + variant.variant_no,
            );

          section.append(groupHeading, grid);
          details.append(section);
        }

        const remove = node("button", "text-button danger", "Usuń wariant");
        remove.disabled = busy;
        remove.onclick = action(async () => {
          if (!confirm("Usunąć ten wariant finansowania i jego reguły ekstrakcji?"))
            return;
          rememberViewportAnchor(
            '[data-funding-add="' + size + '"]',
          );
          await data("REMOVE_FUNDING", { objectId, variantId: variant.id });
          if (active?.target?.id === variant.id) {
            active = null;
            resetCapture();
          }
        });
        details.append(remove);
        group.append(details);
      }
      const add = node("button", "text-button", "+ Dodaj wariant");
      add.dataset.fundingAdd = size;
      add.disabled = busy;
      add.onclick = action(async () => {
        rememberViewportAnchor(
          '[data-funding-add="' + size + '"]',
          true,
        );
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
          context: label + " · Wariant " + variant.variant_no,
        };
        resetCapture();
        scheduleWorkspaceUiPersist();
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
  function renderReferenceObjectPicker(root, definition) {
    const referencedType = definition.references;
    const candidates = db.objects.filter((object) => object.type === referencedType);
    const geographyByObject = buildGeographySearchIndex(
      db.geographies || [],
      BurbotGeography?.catalog || [],
    );

    const picker = node("div", "reference-object-picker");
    const selected = node("div", "reference-object-picker-selected");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "object-picker-search reference-object-picker-search";
    search.autocomplete = "off";
    search.spellcheck = false;
    const typeLabel =
      BurbotSchema[referencedType]?.label ||
      (referencedType === "project" ? "Projekt" : referencedType);
    search.placeholder = "Szukaj: " + typeLabel.toLocaleLowerCase("pl-PL") + "…";
    search.setAttribute("aria-label", "Szukaj obiektu referencyjnego");

    const feedback = node("div", "object-picker-search-feedback");
    const results = node("div", "reference-object-picker-results");
    const footer = node("div", "reference-object-picker-footer");
    picker.append(selected, search, feedback, results, footer);
    root.append(picker);

    let query = "";

    const candidateMeta = (object) => {
      const meta = [];
      if (object.values?.number) meta.push("Numer " + object.values.number);
      if (object.values?.external_number)
        meta.push(String(object.values.external_number));
      if (object.values?.nip) meta.push("NIP " + object.values.nip);
      if (object.importKey) meta.push(String(object.importKey));
      return meta.join(" · ");
    };

    const searchDocument = (object) =>
      createObjectSearchDocument(
        object,
        C.displayName(object),
        BurbotSchema[object.type]?.label || object.type,
        geographyByObject.get(object.id) || {},
      );

    const selectObject = (object) => {
      draft = object.id;
      renderResults();
      controls();
    };

    const visibleButtons = () =>
      Array.from(results.querySelectorAll("button.reference-object-option"));

    const moveFocus = (button, direction) => {
      const buttons = visibleButtons();
      if (!buttons.length) return;
      const current = Math.max(0, buttons.indexOf(button));
      buttons[(current + direction + buttons.length) % buttons.length].focus();
    };

    const optionButton = (object) => {
      const button = node("button", "object-option reference-object-option");
      button.type = "button";
      button.dataset.objectId = object.id;
      const isSelected = String(object.id) === String(draft);
      button.setAttribute("aria-selected", String(isSelected));
      button.disabled = busy;

      const copy = node("span", "object-option-copy");
      copy.append(node("strong", "object-option-name", C.displayName(object)));
      const meta = candidateMeta(object);
      if (meta) copy.append(node("small", "object-option-meta", meta));
      button.append(copy);
      if (isSelected)
        button.append(node("span", "object-option-current", "✓"));

      button.onclick = () => selectObject(object);
      button.onkeydown = (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(button, 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(button, -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          search.focus();
        }
      };
      return button;
    };

    function renderSelected() {
      selected.replaceChildren();
      const current = candidates.find(
        (object) => String(object.id) === String(draft),
      );
      if (!current) {
        selected.hidden = true;
        return;
      }
      selected.hidden = false;
      const copy = node("span", "reference-object-picker-selected-copy");
      copy.append(
        node("small", "reference-object-picker-selected-label", "Wybrano"),
        node("strong", "", C.displayName(current)),
      );
      const meta = candidateMeta(current);
      if (meta) copy.append(node("small", "object-option-meta", meta));
      const clear = node("button", "text-button reference-object-picker-clear", "Wyczyść");
      clear.type = "button";
      clear.disabled = busy;
      clear.onclick = () => {
        draft = "";
        renderResults();
        controls();
        search.focus();
      };
      selected.append(copy, clear);
    }

    function renderResults() {
      renderSelected();
      results.replaceChildren();
      feedback.replaceChildren();

      const compiled = compileObjectSearch(query);
      search.classList.toggle("is-invalid", Boolean(compiled.error));
      search.setAttribute("aria-invalid", String(Boolean(compiled.error)));

      if (compiled.error) {
        feedback.append(
          node("small", "object-picker-search-error", compiled.error),
        );
        footer.textContent = "Niepoprawne wyszukiwanie";
        return;
      }

      feedback.append(
        node(
          "small",
          "object-picker-search-hint",
          "Tekst · * wildcard · /regex/i · name: · number: · nip: · id: · geo:",
        ),
      );

      const matches = candidates.filter((object) =>
        compiled.matches(searchDocument(object)),
      );
      footer.textContent =
        matches.length +
        (matches.length === 1 ? " wynik" : " wyników") +
        " · " +
        typeLabel;

      if (!matches.length) {
        results.append(
          node(
            "div",
            "reference-object-picker-empty",
            query
              ? "Brak pasujących obiektów."
              : "Brak obiektów tego typu w workspace.",
          ),
        );
        return;
      }

      for (const object of matches) results.append(optionButton(object));
    }

    search.oninput = () => {
      query = search.value;
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
      }
    };

    renderResults();
  }

  function renderFieldEvidence(root) {
    if (!active || !chosen()) return;

    const section = node("section", "field-evidence-editor");
    const header = node("div", "field-evidence-header");
    const headerCopy = node("div");
    headerCopy.append(
      node("strong", "", "Evidence"),
      node("small", "", "Opcjonalne źródła potwierdzające wartość pola."),
    );
    const count = fieldEvidenceFor().length;
    header.append(
      headerCopy,
      node("span", "field-evidence-count", count ? String(count) : "0"),
    );
    section.append(header);

    const tools = node("div", "field-evidence-tools");
    const pick = node(
      "button",
      "text-button field-evidence-action",
      picking && evidencePicking ? "Anuluj wybór" : "Wybierz element",
    );
    pick.type = "button";
    pick.disabled = !port || busy || (picking && !evidencePicking);
    pick.onclick = action(async () => {
      if (picking && evidencePicking) {
        await rpc("STOP");
        evidencePicking = false;
        return;
      }
      if (picking) await rpc("STOP");
      evidencePicking = true;
      await rpc("PICK");
    });

    const selection = node(
      "button",
      "text-button field-evidence-action",
      "Użyj zaznaczenia",
    );
    selection.type = "button";
    selection.disabled = !port || busy || picking;
    selection.onclick = action(async () => {
      evidencePicking = false;
      acceptEvidenceCapture(await rpc("SELECTION"));
    });

    const page = node(
      "button",
      "text-button field-evidence-action",
      "Użyj URL strony",
    );
    page.type = "button";
    page.disabled = !port || busy || picking;
    page.onclick = action(async () => {
      evidencePicking = false;
      acceptEvidenceCapture(createPageUrlCandidate(await rpc("URL")));
    });
    tools.append(pick, selection, page);
    section.append(tools);

    if (evidenceCandidate) {
      const previewBox = node("div", "field-evidence-preview");
      const methodLabel = node("label", "", "Odczytaj jako");
      const method = node("select", "field-evidence-method");
      evidenceCandidate.options.forEach((option, index) =>
        method.append(new Option(option.label, String(index))),
      );
      method.value = String(evidenceMethodIndex);
      method.disabled = busy;
      method.onchange = () => {
        evidenceMethodIndex = Number(method.value);
        renderEditor();
        controls();
      };

      const option = evidenceCandidate.options[evidenceMethodIndex];
      previewBox.append(
        methodLabel,
        method,
        node("small", "field-evidence-source", evidenceCandidate.pageUrl),
        node("div", "field-evidence-sample", option?.raw || ""),
      );

      const actions = node("div", "field-evidence-preview-actions");
      const cancel = node("button", "text-button", "Anuluj");
      cancel.type = "button";
      cancel.disabled = busy;
      cancel.onclick = () => {
        evidenceCandidate = null;
        evidenceMethodIndex = 0;
        renderEditor();
        controls();
      };
      const saveEvidence = node("button", "field-evidence-save", "Dodaj evidence");
      saveEvidence.type = "button";
      saveEvidence.disabled = busy || !option;
      saveEvidence.onclick = action(async () => {
        const selected = active;
        const capture = evidenceCandidate;
        const selectedOption = capture?.options[evidenceMethodIndex];
        if (!selected || !capture || !selectedOption)
          throw Error("Wybierz evidence.");
        if ((await rpc("URL")) !== capture.pageUrl)
          throw Error("Strona się zmieniła. Wybierz evidence ponownie.");

        await data("ADD_FIELD_EVIDENCE", {
          objectId,
          field: selected.field,
          target: selected.target,
          candidate: createCapturedExtractionInput(capture, selectedOption),
        });
        evidenceCandidate = null;
        evidenceMethodIndex = 0;
        notice("Evidence dodane.");
      });
      actions.append(cancel, saveEvidence);
      previewBox.append(actions);
      section.append(previewBox);
    }

    const list = node("div", "field-evidence-list");
    for (const entry of fieldEvidenceFor()) {
      const row = node("div", "field-evidence-row");
      const copy = node("div", "field-evidence-copy");
      const sourceLink = node("a", "field-evidence-source", entry.pageUrl);
      sourceLink.href = entry.pageUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      copy.append(
        node("strong", "", evidenceKindLabel(entry)),
        node("span", "field-evidence-raw", entry.rawValue),
        sourceLink,
      );
      const remove = node("button", "text-button danger", "Usuń");
      remove.type = "button";
      remove.disabled = busy;
      remove.onclick = action(async () => {
        await data("REMOVE_FIELD_EVIDENCE", {
          objectId,
          evidenceId: entry.id,
        });
        notice("Evidence usunięte.");
      });
      row.append(copy, remove);
      list.append(row);
    }
    if (!count) {
      list.append(
        node(
          "div",
          "field-evidence-empty",
          "Brak evidence. Pole może pozostać bez evidence.",
        ),
      );
    }
    section.append(list);
    root.append(section);
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
    let input = null;
    if (definition.type === "reference") {
      renderReferenceObjectPicker(root, definition);
    } else if (definition.type === "enum") {
      input = node("select");
      input.append(new Option("Choose…", ""));
      const options = Object.entries(definition.options);
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
              : definition.type === "email"
                ? "email"
                : definition.type === "phone"
                  ? "tel"
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
    if (input) {
      input.id = "edit-value";
      input.disabled = busy;
      input.oninput = () => {
        draft = definition.type === "boolean" ? input.checked : input.value;
        input.indeterminate = false;
        controls();
      };
      if (definition.type !== "boolean") root.append(input);
    }
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
    renderFieldEvidence(root);

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
    $("pick").disabled = !port || !active || busy || evidencePicking;
    $("pick").textContent = picking && !evidencePicking ? "Cancel picker" : "Pick element";
    $("selected-text").disabled = !port || !active || busy || evidencePicking;
    $("page-url").disabled = !port || !active || busy || evidencePicking;
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
      const view = normalizedObjectView();
      objectId =
        objectsInView(db.objects, view).at(0)?.id ||
        (!view ? db.objects.at(-1)?.id : "") ||
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
      const hasContacts = !!BurbotSchema[object.type]?.contacts;
      $("operator-contacts-section").hidden = !hasContacts;
      if (hasContacts) renderOperatorContacts(object);

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
    void syncObjectWorkflowControls();
    restoreViewportAnchor();
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
  $("stage-object").onclick = action(stageCurrentObject);
  $("remove-object-from-view").onclick = action(async () => {
    if (!objectId) return;
    await removeFromObjectView(objectId);
  });
  $("pick").onclick = action(async () => {
    evidencePicking = false;
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
    scheduleWorkspaceUiPersist();
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
    scheduleWorkspaceUiPersist();
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
    scheduleWorkspaceUiPersist();
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
  window.addEventListener("burbot:commit-changed", () => {
    void syncObjectWorkflowControls();
  });
  window.addEventListener("pagehide", () => {
    void persistWorkspaceUi();
    disconnect();
  });
  (async () => {
    windowId = (await browser.windows.getCurrent()).id;
    await data("GET");
    const [storedView, uiState] = await Promise.all([
      browser.storage.session.get(OBJECT_VIEW_STORAGE_KEY),
      readSidepanelUiState(windowId),
    ]);
    objectView = normalizeObjectView(
      storedView[OBJECT_VIEW_STORAGE_KEY],
      db.objects,
    );

    switcherQuery = uiState.workspace.switcher.query;
    switcherType = uiState.workspace.switcher.type;
    switcherScrollTop = uiState.workspace.switcher.scrollTop;
    focusStamp = uiState.workspace.focusStamp;
    expanded.clear();
    for (const key of uiState.workspace.expanded) expanded.add(key);

    if (
      uiState.workspace.objectId &&
      db.objects.some((object) => object.id === uiState.workspace.objectId)
    ) {
      objectId = uiState.workspace.objectId;
      const savedActive = uiState.workspace.active;
      if (savedActive?.objectId === objectId) {
        active = {
          field: savedActive.field,
          ...(savedActive.target ? { target: savedActive.target } : {}),
          ...(savedActive.context ? { context: savedActive.context } : {}),
        };
        resetCapture();
      }
    }

    ready = true;
    const pendingFocus = await data("GET_FOCUS", { windowId });
    if (pendingFocus?.stamp && pendingFocus.stamp !== focusStamp) {
      await receiveFocus(pendingFocus);
    } else {
      render();
    }
    scheduleWorkspaceUiPersist();
    window.dispatchEvent(new Event("burbot:workspace-ready"));
    if (!port) await connect();
  })().catch((error) => notice(error.message, true));
})();
