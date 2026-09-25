(() => {
  const clean = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const own = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);
  const empty = () => ({
    version: 1,
    revision: 0,
    objects: [],
    rules: [],
    geographies: [],
    operatorAssignments: [],
    operatorContacts: [],
    financingRules: [],
    documentRequirements: [],
    fieldEvidence: [],
  });

  function coerce(raw, type) {
    const text = clean(raw);
    if (!text) throw Error("The value is empty.");
    if (type === "string") return text;

    if (type === "url") {
      const url = new URL(text);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("Use an HTTP(S) URL.");
      return url.href;
    }

    if (type === "email") {
      const email = text.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw Error("Wpisz poprawny adres email.");
      return email;
    }

    if (type === "phone") {
      const phone = text.replace(/\s+/g, " ").trim();
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 6 || digits.length > 18)
        throw Error("Wpisz poprawny numer telefonu.");
      return phone;
    }

    if (type === "number") {
      let value = text.replace(/\s*(PLN|EUR|USD|zł|€|\$)\s*$/i, "").trim();
      const sign = value.startsWith("-") ? "-" : "";
      value = value.replace(/^[+-]/, "");

      const integer = (part) => {
        if (/^\d+$/.test(part)) return part;
        if (/^\d{1,3}( \d{3})+$/.test(part)) return part.replace(/ /g, "");
        throw Error("Use a number such as 5 000 000 or 1 234,56 PLN.");
      };

      if (value.includes(",") && value.includes(".")) {
        const decimal =
          value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
        const group = decimal === "," ? "." : ",";
        const pieces = value.split(decimal);
        if (pieces.length !== 2 || !/^\d+$/.test(pieces[1]))
          throw Error("Invalid number.");
        const groups = pieces[0].split(group);
        if (
          !/^\d{1,3}$/.test(groups[0]) ||
          groups.slice(1).some((g) => !/^\d{3}$/.test(g))
        )
          throw Error("Invalid thousands grouping.");
        value = groups.join("") + "." + pieces[1];
      } else {
        const separator = value.includes(",") ? "," : ".";
        const parts = value.split(separator);
        if (parts.length > 2) {
          if (
            !/^\d{1,3}$/.test(parts[0]) ||
            parts.slice(1).some((g) => !/^\d{3}$/.test(g))
          )
            throw Error("Invalid thousands grouping.");
          value = parts.join("");
        } else if (parts.length === 2) {
          if (!/^\d+$/.test(parts[1])) throw Error("Invalid decimal number.");
          if (/^\d{1,3}$/.test(parts[0]) && parts[1].length === 3)
            throw Error(
              "Ambiguous number. Use spaces for thousands, e.g. 1 234.",
            );
          value = integer(parts[0]) + "." + parts[1];
        } else {
          value = integer(value);
        }
      }

      const number = Number(sign + value);
      if (
        !Number.isFinite(number) ||
        Math.abs(number) > Number.MAX_SAFE_INTEGER
      )
        throw Error("Number is outside the supported range.");
      return number;
    }

    if (type === "datetime") {
      const value = new Date(text);
      if (Number.isNaN(value.getTime())) throw Error("Use a valid ISO date-time.");
      return value.toISOString();
    }

    if (type === "date") {
      const match =
        /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) ||
        /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(text);
      if (!match) throw Error("Use YYYY-MM-DD or DD.MM.YYYY.");
      const [year, month, day] =
        match[1].length === 4
          ? match.slice(1).map(Number)
          : [Number(match[3]), Number(match[2]), Number(match[1])];
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        year < 1000 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      )
        throw Error("Invalid calendar date.");
      return date.toISOString().slice(0, 10);
    }

    throw Error("Unsupported field type.");
  }

  function occurrences(text, part) {
    const positions = [];
    if (!part) return positions;
    for (
      let index = text.indexOf(part);
      index !== -1;
      index = text.indexOf(part, index + 1)
    ) {
      positions.push(index);
      if (positions.length > 200)
        throw Error("Text context is too repetitive. Pick a smaller element.");
    }
    return positions;
  }

  function selectedText(text, quote) {
    text = clean(text);
    const exact = clean(quote?.exact);
    const prefix = clean(quote?.prefix);
    const suffix = clean(quote?.suffix);

    // With context on both sides we intentionally allow the value itself to
    // change between runs: prefix + suffix delimit the current value.
    if (prefix && suffix) {
      const starts = occurrences(text, prefix).map((i) => i + prefix.length);
      const ends = occurrences(text, suffix);
      const pairs = [];
      for (const start of starts)
        for (const end of ends) if (end >= start) pairs.push([start, end]);
      if (pairs.length !== 1)
        throw Error(
          "Selection context changed or is ambiguous. Select it again.",
        );
      const [start, end] = pairs[0];
      const result = clean(text.slice(start, end));
      if (!result) throw Error("Selected text is now empty.");
      return result;
    }

    // A boundary selection (missing prefix or suffix) must never expand to an
    // entire compatibility container such as <body>. In that case only the
    // original exact quote is safe, and only when it is unique.
    if (!exact) throw Error("Selection quote is empty.");
    const positions = occurrences(text, exact);
    if (positions.length !== 1)
      throw Error(
        "Selection context changed or is ambiguous. Select it again.",
      );
    return exact;
  }

  function readElement(element, extraction) {
    if (extraction.type === "text") return clean(element.textContent);
    if (extraction.type === "selection")
      return selectedText(element.textContent, extraction.quote);
    if (extraction.type === "attribute") {
      const attr = extraction.attribute;
      if (
        !["href", "src", "datetime", "title", "alt", "content"].includes(attr)
      )
        throw Error("Unsupported attribute.");
      const target = attr === "href" ? element.closest("a[href]") : element;
      const raw = target?.getAttribute(attr);
      if (raw === null || raw === undefined)
        throw Error("Attribute is missing: " + attr);
      return ["href", "src"].includes(attr)
        ? new URL(raw, element.baseURI).href
        : raw;
    }
    throw Error("Unsupported extraction method.");
  }

  const hasValue = (value) =>
    value !== undefined && value !== null && value !== "";
  const displayName = (object) =>
    String(
      object.values?.[globalThis.BurbotSchema[object.type]?.primary] ||
        object.label ||
        "Untitled",
    );
  const targetKey = (target) =>
    target?.kind && target.kind !== "object"
      ? target.kind + ":" + target.id
      : "object";
  const matches = (rule, objectId, field, target) =>
    rule.objectId === objectId &&
    rule.field === field &&
    targetKey(rule.target) === targetKey(target);

  function enumAlias(definition, text) {
    if (!definition.aliases) return text;
    const alias = Object.entries(definition.aliases).find(
      ([key]) => key.toLowerCase() === text.toLowerCase(),
    );
    return alias ? String(alias[1]) : text;
  }

  function geographyEntry(value) {
    const text = clean(value).toLowerCase();
    return globalThis.BurbotGeography?.catalog?.find(
      (entry) =>
        String(entry.value).toLowerCase() === text ||
        String(entry.label).toLowerCase() === text,
    );
  }

  function coerceField(raw, definition, state) {
    let text = clean(raw);
    if (!text) throw Error("Choose or enter a value.");
    if (text.length > 100000) throw Error("Value is too long.");
    const type = definition.type;

    if (type === "enum") {
      text = enumAlias(definition, text);
      const entry = Object.entries(definition.options).find(
        ([key, label]) =>
          key.toLowerCase() === text.toLowerCase() ||
          String(label).toLowerCase() === text.toLowerCase(),
      );
      if (!entry) throw Error("Choose one of the available options.");
      return definition.numeric ? Number(entry[0]) : entry[0];
    }

    if (type === "geography") {
      const entry = geographyEntry(text);
      if (!entry) throw Error("Choose a geography value from search results.");
      return entry.value;
    }

    if (type === "boolean") {
      if (/^(true|yes|tak|1|auto|auto-fill)$/i.test(text)) return true;
      if (/^(false|no|nie|0)$/i.test(text)) return false;
      throw Error("Choose Yes or No.");
    }

    if (type === "reference") {
      const objects = state.objects.filter(
        (o) => o.type === definition.references,
      );
      const exactId = objects.find((o) => o.id === text);
      if (exactId) return exactId.id;
      const named = objects.filter(
        (o) => displayName(o).toLowerCase() === text.toLowerCase(),
      );
      if (named.length !== 1)
        throw Error(
          "Choose an existing project. Create it from the page first if needed.",
        );
      return named[0].id;
    }

    if (type === "nip") {
      const nip = text.replace(/[\s-]/g, "");
      if (!/^\d{10}$/.test(nip)) throw Error("NIP must contain 10 digits.");
      return nip;
    }

    if (["money", "percentage", "integer"].includes(type)) {
      const currency = /(PLN|EUR|USD|zł|€|\$)\s*$/i.exec(text);
      if (currency && (type !== "money" || !/^(PLN|zł)$/i.test(currency[1])))
        throw Error(
          type === "money"
            ? "Enter an amount in PLN. Currency conversion is not automatic."
            : "Enter a value without a currency.",
        );
      const value = coerce(
        type === "percentage" ? text.replace(/\s*%$/, "") : text,
        "number",
      );
      if (type === "integer" && !Number.isSafeInteger(value))
        throw Error("Enter a whole number.");
      const min = definition.min ?? 0;
      const max =
        definition.max ??
        (type === "percentage" ? 100 : Number.MAX_SAFE_INTEGER);
      if (value < min || value > max)
        throw Error("Value must be between " + min + " and " + max + ".");
      return value;
    }

    return coerce(raw, type);
  }

  function formatValue(value, definition, state) {
    if (!hasValue(value)) return "Nie ustawiono";
    if (definition.type === "reference") {
      const object = state.objects.find((o) => o.id === value);
      return object ? displayName(object) : "Projekt niedostępny";
    }
    if (definition.type === "geography")
      return geographyEntry(value)?.label || String(value);
    if (definition.options?.[value]) return definition.options[value];
    if (definition.aliases?.[value]) {
      const current = definition.aliases[value];
      return definition.options?.[current] || String(current);
    }
    if (definition.labels?.[value]) return definition.labels[value];
    if (definition.type === "boolean") return value ? "Tak" : "Nie";
    if (definition.type === "datetime") {
      const date = new Date(String(value));
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
      }
    }
    if (definition.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Intl.DateTimeFormat("pl-PL", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value));
    }
    if (
      ["number", "money", "percentage", "integer"].includes(definition.type) &&
      Number.isFinite(value)
    ) {
      const formatted = new Intl.NumberFormat("pl-PL", {
        maximumFractionDigits: 2,
      }).format(value);
      return (
        formatted +
        (definition.type === "money"
          ? " PLN"
          : definition.type === "percentage"
            ? "%"
            : "")
      );
    }
    return String(value);
  }

  function fieldContext(state, object, field, target, createDocument) {
    let fields = globalThis.BurbotSchema[object.type]?.fields,
      values = object.values;

    if (target && target.kind !== "object") {
      if (target.kind === "geography") {
        values = (state.geographies || []).find(
          (row) => row.id === target.id && row.objectId === object.id,
        );
        fields = globalThis.BurbotGeography?.fields;
        if (!values) throw Error("Geography entry no longer exists.");
      } else if (target.kind === "operator_contact") {
        if (object.type !== "operator" || !globalThis.BurbotSchema.operator?.contacts)
          throw Error("Kontakty są dostępne tylko dla operatorów.");
        values = (state.operatorContacts || []).find(
          (row) => row.id === target.id && row.objectId === object.id,
        );
        if (!values) throw Error("Kontakt operatora już nie istnieje.");
        fields = globalThis.BurbotOperatorContacts?.fields?.[values.kind];
        if (!fields) throw Error("Nieznany rodzaj kontaktu operatora.");
      } else {
        if (!globalThis.BurbotSchema[object.type]?.configuration)
          throw Error("This object has no business configuration.");
        if (target.kind === "funding") {
          values = (state.financingRules || []).find(
            (r) => r.id === target.id && r.objectId === object.id,
          );
          fields = globalThis.BurbotFunding.fields;
          if (!values) throw Error("Funding variant no longer exists.");
        } else if (target.kind === "document") {
          if (
            !globalThis.BurbotDocuments.catalog.some((d) => d.key === target.id)
          )
            throw Error("Unknown document.");
          values = (state.documentRequirements || []).find(
            (r) => r.document_type_key === target.id && r.objectId === object.id,
          );
          if (!values && createDocument) {
            values = {
              id: createDocument(),
              objectId: object.id,
              document_type_key: target.id,
            };
            (state.documentRequirements ||= []).push(values);
          }
          values ||= {};
          fields = globalThis.BurbotDocuments.fields;
        } else throw Error("Unknown field target.");
      }
    }

    if (!fields || !own(fields, field)) throw Error("Unknown field.");
    return { values, definition: fields[field] };
  }

  function validateCandidate(candidate) {
    if (
      !candidate ||
      typeof candidate.raw !== "string" ||
      !clean(candidate.raw) ||
      candidate.raw.length > 100000
    )
      throw Error("Invalid captured value.");
    coerce(candidate.pageUrl, "url");
    const method = candidate.extraction;
    if (
      !method ||
      !["text", "selection", "attribute", "pageUrl"].includes(method.type)
    )
      throw Error("Invalid extraction method.");
    if (
      method.type !== "pageUrl" &&
      (typeof candidate.selector !== "string" ||
        !candidate.selector ||
        candidate.selector.length > 10000)
    )
      throw Error("Invalid selector.");
    if (
      method.type === "attribute" &&
      !["href", "src", "datetime", "title", "alt", "content"].includes(
        method.attribute,
      )
    )
      throw Error("Invalid attribute.");
    if (
      method.type === "selection" &&
      (!method.quote ||
        ["exact", "prefix", "suffix"].some(
          (k) => typeof method.quote[k] !== "string",
        ))
    )
      throw Error("Invalid selection context.");
  }

  function evidenceMatches(entry, objectId, field, target) {
    return (
      entry.objectId === objectId &&
      entry.field === field &&
      targetKey(entry.target) === targetKey(target)
    );
  }

  function addFieldEvidence(state, object, message, uuid, now) {
    validateCandidate(message.candidate);
    const candidate = message.candidate;
    const { values, definition } = fieldContext(
      state,
      object,
      message.field,
      message.target,
    );
    if (definition.readonly || definition.system)
      throw Error("This field is managed automatically.");

    const row = {
      id: uuid(),
      objectId: object.id,
      field: message.field,
      pageUrl: candidate.pageUrl,
      selector: candidate.selector ?? null,
      extraction: candidate.extraction,
      rawValue: candidate.raw,
      createdAt: now,
    };
    if (Array.isArray(candidate.selectorFallbacks) && candidate.selectorFallbacks.length)
      row.selectorFallbacks = candidate.selectorFallbacks;
    if (message.target?.kind && message.target.kind !== "object")
      row.target = message.target;
    if (hasValue(values[message.field]))
      row.valueAtCapture = values[message.field];

    (state.fieldEvidence ||= []).push(row);
    object.updatedAt = now;
  }

  function ruleValue(state, object, rule, raw) {
    const input = rule.transform?.sample === raw ? rule.transform.value : raw;
    return coerceField(
      input,
      fieldContext(state, object, rule.field, rule.target).definition,
      state,
    );
  }

  function assign(state, object, message, uuid, now) {
    validateCandidate(message.candidate);
    const candidate = message.candidate;
    const { values, definition } = fieldContext(
      state,
      object,
      message.field,
      message.target,
      uuid,
    );
    if (definition.readonly || definition.system)
      throw Error("This field is managed automatically.");
    const input = message.value ?? candidate.raw;
    values[message.field] = coerceField(input, definition, state);
    state.rules = state.rules.filter(
      (r) => !matches(r, object.id, message.field, message.target),
    );
    const rule = {
      id: uuid(),
      objectId: object.id,
      field: message.field,
      pageUrl: candidate.pageUrl,
      selector: candidate.selector,
      extraction: candidate.extraction,
      sampleValue: candidate.raw,
      createdAt: now,
    };
    if (message.target?.kind && message.target.kind !== "object")
      rule.target = message.target;
    if (String(input) !== candidate.raw)
      rule.transform = { sample: candidate.raw, value: input };
    state.rules.push(rule);
    if (!message.target || message.target.kind === "object") {
      delete object.manualFields?.[message.field];
      if (message.field === globalThis.BurbotSchema[object.type].primary)
        object.label = String(values[message.field]);
    }
    object.updatedAt = now;
  }

  function mutate(original, message, uuid, now) {
    if (message.expectedRevision !== original.revision)
      throw Error(
        "Data changed in another panel. Review the refreshed values and retry.",
      );
    const state = JSON.parse(JSON.stringify(original));

    if (message.op === "CREATE_FROM_SELECTION") {
      if (!["project", "recruitment", "operator"].includes(message.objectType))
        throw Error("Unknown object type.");
      const initial = clean(message.initialValue);
      if (!initial || initial.length > 2000)
        throw Error("Select an object name (1–2000 characters).");
      const sourceUrl = coerce(message.sourceUrl, "url");
      const schema = globalThis.BurbotSchema[message.objectType];
      const object = {
        id: uuid(),
        type: message.objectType,
        label: initial,
        values: {},
        sourceUrl,
        createdAt: now,
        updatedAt: now,
      };
      for (const [key, definition] of Object.entries(schema.fields))
        if (own(definition, "default")) object.values[key] = definition.default;
      object.values[schema.primary] = initial;
      state.objects.push(object);
      if (message.candidate) {
        if (
          clean(message.candidate.raw) !== initial ||
          message.candidate.pageUrl !== sourceUrl
        )
          throw Error("The page selection changed. Select the name again.");
        assign(
          state,
          object,
          { field: schema.primary, candidate: message.candidate },
          uuid,
          now,
        );
      } else {
        object.creationNote =
          "Value saved from your selection. Select " +
          schema.fields[schema.primary].label +
          " to teach its extraction rule.";
      }
    } else {
      const object = state.objects.find((o) => o.id === message.objectId);
      if (!object) throw Error("Choose an object.");

      if (message.op === "DELETE") {
        const removedGeographyIds = new Set(
          (state.geographies || [])
            .filter(
              (row) =>
                row.objectId === object.id ||
                (object.type === "operator" && row.operatorId === object.id),
            )
            .map((row) => row.id),
        );
        state.objects = state.objects.filter((o) => o.id !== object.id);
        state.rules = state.rules.filter(
          (r) =>
            r.objectId !== object.id &&
            !(
              r.target?.kind === "geography" &&
              removedGeographyIds.has(r.target.id)
            ),
        );
        if (state.operatorAssignments)
          state.operatorAssignments = state.operatorAssignments.filter(
            (row) =>
              row.objectId !== object.id &&
              row.operatorId !== object.id,
          );
        if (state.operatorContacts)
          state.operatorContacts = state.operatorContacts.filter(
            (r) => r.objectId !== object.id,
          );
        if (state.financingRules)
          state.financingRules = state.financingRules.filter(
            (r) => r.objectId !== object.id,
          );
        if (state.documentRequirements)
          state.documentRequirements = state.documentRequirements.filter(
            (r) => r.objectId !== object.id,
          );
        if (state.geographies)
          state.geographies = state.geographies.filter(
            (row) => !removedGeographyIds.has(row.id),
          );
        if (state.fieldEvidence)
          state.fieldEvidence = state.fieldEvidence.filter(
            (row) =>
              row.objectId !== object.id &&
              !(
                row.target?.kind === "geography" &&
                removedGeographyIds.has(row.target.id)
              ),
          );
        if (state.importTargetEvidence)
          state.importTargetEvidence = state.importTargetEvidence.filter(
            (row) =>
              row.objectId !== object.id &&
              !(
                row.target?.kind === "geography" &&
                removedGeographyIds.has(row.target.id)
              ),
          );
      } else if (message.op === "ASSIGN") {
        assign(state, object, message, uuid, now);
      } else if (message.op === "EDIT") {
        const { values, definition } = fieldContext(
          state,
          object,
          message.field,
          message.target,
          uuid,
        );
        if (definition.readonly || definition.system)
          throw Error("This field is managed automatically.");
        const clearing =
          definition.allowEmpty === true && !clean(message.value);
        const value = clearing
          ? undefined
          : coerceField(message.value, definition, state);
        if (clearing) delete values[message.field];
        else values[message.field] = value;

        const rule = state.rules.find((r) =>
          matches(r, object.id, message.field, message.target),
        );
        if (rule && !clearing)
          rule.transform = {
            sample: rule.lastSampleValue ?? rule.sampleValue,
            value: message.value,
          };
        else if (!rule && !clearing && (!message.target || message.target.kind === "object"))
          (object.manualFields ||= {})[message.field] = true;
        else if (clearing && (!message.target || message.target.kind === "object"))
          delete object.manualFields?.[message.field];

        if (
          !clearing &&
          (!message.target || message.target.kind === "object") &&
          message.field === globalThis.BurbotSchema[object.type].primary
        )
          object.label = String(value);
        object.updatedAt = now;
      } else if (message.op === "ADD_FIELD_EVIDENCE") {
        addFieldEvidence(state, object, message, uuid, now);
      } else if (message.op === "REMOVE_FIELD_EVIDENCE") {
        if (typeof message.evidenceId !== "string")
          throw Error("Evidence id is required.");
        const before = (state.fieldEvidence || []).length;
        state.fieldEvidence = (state.fieldEvidence || []).filter(
          (row) =>
            !(
              row.id === message.evidenceId &&
              row.objectId === object.id &&
              evidenceMatches(row, object.id, row.field, row.target)
            ),
        );
        if (state.fieldEvidence.length === before)
          throw Error("Evidence not found.");
        object.updatedAt = now;
      } else if (message.op === "APPLY") {
        if (!Array.isArray(message.results)) throw Error("Invalid preview.");
        for (const result of message.results) {
          const rule = state.rules.find(
            (r) => r.id === result.ruleId && r.objectId === object.id,
          );
          if (!rule) throw Error("An extraction rule changed. Preview again.");
          const value = ruleValue(state, object, rule, result.raw);
          fieldContext(state, object, rule.field, rule.target, uuid).values[
            rule.field
          ] = value;
          if (
            targetKey(rule.target) === "object" &&
            rule.field === globalThis.BurbotSchema[object.type].primary
          )
            object.label = String(value);
          rule.lastSampleValue = result.raw;
          rule.lastExtractedAt = now;
        }
        object.updatedAt = now;
      } else if (message.op === "ADD_OPERATOR_ASSIGNMENT") {
        if (!["project", "recruitment"].includes(object.type))
          throw Error("Operators can be assigned only to projects and recruitments.");
        const operator = state.objects.find(
          (candidate) =>
            candidate.id === message.operatorId &&
            candidate.type === "operator",
        );
        if (!operator) throw Error("Choose an existing operator.");
        const operatorType = message.operatorType ?? "DODATKOWY";
        if (!["GLOWNY", "DODATKOWY"].includes(operatorType))
          throw Error("Unknown operator assignment type.");
        const rows = (state.operatorAssignments ||= []);
        if (
          rows.some(
            (row) =>
              row.objectId === object.id &&
              row.operatorId === operator.id,
          )
        )
          throw Error("This operator is already assigned.");

        const hasMain = rows.some(
          (row) =>
            row.objectId === object.id &&
            row.operatorType === "GLOWNY",
        );
        rows.push({
          id: uuid(),
          objectId: object.id,
          operatorId: operator.id,
          operatorType: hasMain ? operatorType : "GLOWNY",
        });
        object.updatedAt = now;
      } else if (message.op === "REMOVE_OPERATOR_ASSIGNMENT") {
        if (!["project", "recruitment"].includes(object.type))
          throw Error("Operators can be assigned only to projects and recruitments.");
        const rows = state.operatorAssignments || [];
        const assignment = rows.find(
          (row) =>
            row.id === message.assignmentId &&
            row.objectId === object.id,
        );
        if (!assignment) throw Error("Operator assignment not found.");

        const removedGeographyIds = new Set(
          object.type === "recruitment"
            ? (state.geographies || [])
                .filter(
                  (row) =>
                    row.objectId === object.id &&
                    row.operatorId === assignment.operatorId,
                )
                .map((row) => row.id)
            : [],
        );

        state.operatorAssignments = rows.filter(
          (row) => row.id !== assignment.id,
        );
        if (removedGeographyIds.size) {
          state.geographies = (state.geographies || []).filter(
            (row) => !removedGeographyIds.has(row.id),
          );
          state.rules = state.rules.filter(
            (rule) =>
              !(
                rule.objectId === object.id &&
                rule.target?.kind === "geography" &&
                removedGeographyIds.has(rule.target.id)
              ),
          );
          state.fieldEvidence = (state.fieldEvidence || []).filter(
            (row) =>
              !(
                row.objectId === object.id &&
                row.target?.kind === "geography" &&
                removedGeographyIds.has(row.target.id)
              ),
          );
          state.importTargetEvidence = (state.importTargetEvidence || []).filter(
            (row) =>
              !(
                row.objectId === object.id &&
                row.target?.kind === "geography" &&
                removedGeographyIds.has(row.target.id)
              ),
          );
        }

        const remaining = state.operatorAssignments.filter(
          (row) => row.objectId === object.id,
        );
        if (
          assignment.operatorType === "GLOWNY" &&
          remaining.length &&
          !remaining.some((row) => row.operatorType === "GLOWNY")
        ) {
          remaining[0].operatorType = "GLOWNY";
        }
        object.updatedAt = now;
      } else if (message.op === "ADD_GEOGRAPHY") {
        if (!globalThis.BurbotSchema[object.type]?.geography)
          throw Error("Geography is supported only for projects and recruitments.");
        if (!globalThis.BurbotGeography)
          throw Error("Geography catalog is unavailable.");
        if (!own(globalThis.BurbotGeography.types, message.geographyType))
          throw Error("Unknown geography type.");
        if (!own(globalThis.BurbotGeography.roles, message.geographyRole))
          throw Error("Unknown geography role.");
        const entry = geographyEntry(message.value);
        if (!entry || entry.type !== message.geographyType)
          throw Error("Choose a geography value matching the selected type.");
        const rows = (state.geographies ||= []);
        let operatorId;
        if (object.type === "recruitment") {
          operatorId = clean(message.operatorId);
          if (!operatorId)
            throw Error("Choose the operator whose recruitment geography this is.");
          const assigned = (state.operatorAssignments || []).some(
            (row) =>
              row.objectId === object.id &&
              row.operatorId === operatorId,
          );
          if (!assigned)
            throw Error("The selected operator is not assigned to this recruitment.");
        }

        if (
          rows.some(
            (row) =>
              row.objectId === object.id &&
              row.type === message.geographyType &&
              row.role === message.geographyRole &&
              row.value === entry.value &&
              (object.type !== "recruitment" ||
                row.operatorId === operatorId),
          )
        )
          throw Error("This geography condition is already added.");
        rows.push({
          id: uuid(),
          objectId: object.id,
          type: message.geographyType,
          role: message.geographyRole,
          value: entry.value,
          ...(operatorId ? { operatorId } : {}),
        });
        object.updatedAt = now;
      } else if (message.op === "REMOVE_GEOGRAPHY") {
        fieldContext(state, object, "value", {
          kind: "geography",
          id: message.geographyId,
        });
        state.geographies = (state.geographies || []).filter(
          (row) => !(row.id === message.geographyId && row.objectId === object.id),
        );
        state.fieldEvidence = (state.fieldEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "geography" &&
              row.target.id === message.geographyId
            ),
        );
        state.rules = state.rules.filter(
          (rule) =>
            !(
              rule.objectId === object.id &&
              rule.target?.kind === "geography" &&
              rule.target.id === message.geographyId
            ),
        );
        state.importTargetEvidence = (state.importTargetEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "geography" &&
              row.target.id === message.geographyId
            ),
        );
        object.updatedAt = now;
      } else if (message.op === "ADD_OPERATOR_CONTACT") {
        if (
          object.type !== "operator" ||
          !globalThis.BurbotSchema.operator?.contacts ||
          !own(globalThis.BurbotOperatorContacts.kinds, message.contactKind)
        )
          throw Error("Nieznany rodzaj kontaktu operatora.");
        const rows = (state.operatorContacts ||= []);
        const variant =
          Math.max(
            0,
            ...rows
              .filter(
                (r) =>
                  r.objectId === object.id &&
                  r.kind === message.contactKind,
              )
              .map((r) => Number(r.variant_no) || 0),
          ) + 1;
        rows.push({
          id: uuid(),
          objectId: object.id,
          kind: message.contactKind,
          variant_no: variant,
          value: "",
        });
        object.updatedAt = now;
      } else if (message.op === "REMOVE_OPERATOR_CONTACT") {
        fieldContext(state, object, "value", {
          kind: "operator_contact",
          id: message.contactId,
        });
        state.operatorContacts = (state.operatorContacts || []).filter(
          (r) => !(r.id === message.contactId && r.objectId === object.id),
        );
        state.fieldEvidence = (state.fieldEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "operator_contact" &&
              row.target.id === message.contactId
            ),
        );
        state.rules = state.rules.filter(
          (rule) =>
            !(
              rule.objectId === object.id &&
              rule.target?.kind === "operator_contact" &&
              rule.target.id === message.contactId
            ),
        );
        state.importTargetEvidence = (state.importTargetEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "operator_contact" &&
              row.target.id === message.contactId
            ),
        );
        object.updatedAt = now;
      } else if (message.op === "ADD_FUNDING") {
        if (
          !globalThis.BurbotSchema[object.type]?.configuration ||
          !own(globalThis.BurbotFunding.sizes, message.companySize)
        )
          throw Error("Unknown funding group.");
        const rows = (state.financingRules ||= []);
        const variant =
          Math.max(
            0,
            ...rows
              .filter(
                (r) =>
                  r.objectId === object.id &&
                  r.company_size === message.companySize,
              )
              .map((r) => r.variant_no),
          ) + 1;
        rows.push({
          id: uuid(),
          objectId: object.id,
          company_size: message.companySize,
          variant_no: variant,
          own_contribution_form: "UNSPECIFIED",
        });
        object.updatedAt = now;
      } else if (message.op === "REMOVE_FUNDING") {
        fieldContext(state, object, "refund_percent", {
          kind: "funding",
          id: message.variantId,
        });
        state.financingRules = state.financingRules.filter(
          (r) => !(r.id === message.variantId && r.objectId === object.id),
        );
        state.fieldEvidence = (state.fieldEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "funding" &&
              row.target.id === message.variantId
            ),
        );
        state.rules = state.rules.filter(
          (r) =>
            !(
              r.objectId === object.id &&
              r.target?.kind === "funding" &&
              r.target.id === message.variantId
            ),
        );
        state.importTargetEvidence = (state.importTargetEvidence || []).filter(
          (row) =>
            !(
              row.objectId === object.id &&
              row.target?.kind === "funding" &&
              row.target.id === message.variantId
            ),
        );
        object.updatedAt = now;
      } else {
        throw Error("Unknown operation.");
      }
    }

    state.revision++;
    return state;
  }

  globalThis.BurbotCore = {
    clean,
    empty,
    coerce,
    occurrences,
    selectedText,
    readElement,
    mutate,
    coerceField,
    formatValue,
    fieldContext,
    hasValue,
    displayName,
    targetKey,
    matches,
    ruleValue,
  };
})();
