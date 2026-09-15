(() => {
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const empty = () => ({version: 1, revision: 0, objects: [], rules: []});

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

    if (type === "number") {
      let value = text.replace(/\s*(PLN|EUR|USD|zł|€|\$)\s*$/i, "").trim();
      const sign = value.startsWith("-") ? "-" : "";
      value = value.replace(/^[+-]/, "");

      const integer = part => {
        if (/^\d+$/.test(part)) return part;
        if (/^\d{1,3}( \d{3})+$/.test(part)) return part.replace(/ /g, "");
        throw Error("Use a number such as 5 000 000 or 1 234,56 PLN.");
      };

      if (value.includes(",") && value.includes(".")) {
        const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
        const group = decimal === "," ? "." : ",";
        const pieces = value.split(decimal);

        if (pieces.length !== 2 || !/^\d+$/.test(pieces[1]))
          throw Error("Invalid number.");

        const groups = pieces[0].split(group);
        if (!/^\d{1,3}$/.test(groups[0]) ||
            groups.slice(1).some(g => !/^\d{3}$/.test(g)))
          throw Error("Invalid thousands grouping.");

        value = groups.join("") + "." + pieces[1];
      } else {
        const separator = value.includes(",") ? "," : ".";
        const parts = value.split(separator);

        if (parts.length > 2) {
          if (!/^\d{1,3}$/.test(parts[0]) ||
              parts.slice(1).some(g => !/^\d{3}$/.test(g)))
            throw Error("Invalid thousands grouping.");

          value = parts.join("");
        } else if (parts.length === 2) {
          if (!/^\d+$/.test(parts[1]))
            throw Error("Invalid decimal number.");

          if (/^\d{1,3}$/.test(parts[0]) && parts[1].length === 3)
            throw Error("Ambiguous number. Use spaces for thousands, e.g. 1 234.");

          value = integer(parts[0]) + "." + parts[1];
        } else {
          value = integer(value);
        }
      }

      const number = Number(sign + value);
      if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER)
        throw Error("Number is outside the supported range.");

      return number;
    }

    if (type === "date") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
        || /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(text);

      if (!match) throw Error("Use YYYY-MM-DD or DD.MM.YYYY.");

      const [year, month, day] = match[1].length === 4
        ? match.slice(1).map(Number)
        : [Number(match[3]), Number(match[2]), Number(match[1])];

      const date = new Date(Date.UTC(year, month - 1, day));

      if (year < 1000 || date.getUTCFullYear() !== year ||
          date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
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
    const {prefix, suffix} = quote;
    const starts = prefix
      ? occurrences(text, prefix).map(i => i + prefix.length)
      : [0];
    const ends = suffix ? occurrences(text, suffix) : [text.length];
    const pairs = [];

    for (const start of starts) {
      for (const end of ends) {
        if (end >= start) pairs.push([start, end]);
      }
    }

    if (pairs.length !== 1)
      throw Error("Selection context changed or is ambiguous. Select it again.");

    const [start, end] = pairs[0];
    const result = clean(text.slice(start, end));

    if (!result) throw Error("Selected text is now empty.");
    return result;
  }

  function readElement(element, extraction) {
    if (extraction.type === "text")
      return clean(element.textContent);

    if (extraction.type === "selection")
      return selectedText(element.textContent, extraction.quote);

    if (extraction.type === "attribute") {
      const attr = extraction.attribute;

      if (!["href", "src", "datetime", "title", "alt", "content"].includes(attr))
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

  function fieldDefinition(object, field) {
    const schema = globalThis.BurbotSchema;

    if (!own(schema, object.type) || !own(schema[object.type].fields, field))
      throw Error("Unknown field.");

    return schema[object.type].fields[field];
  }

  function mutate(original, message, uuid, now) {
    if (message.expectedRevision !== original.revision)
      throw Error("Data changed in another panel. Review the refreshed values and retry.");

    const state = JSON.parse(JSON.stringify(original));

    if (message.op === "CREATE") {
      if (!own(globalThis.BurbotSchema, message.objectType))
        throw Error("Unknown object type.");

      const label = clean(message.label);

      if (!label || label.length > 200)
        throw Error("Enter a name (1–200 characters).");

      state.objects.push({
        id: uuid(),
        type: message.objectType,
        label,
        values: {},
        createdAt: now,
        updatedAt: now
      });
    } else {
      const object = state.objects.find(o => o.id === message.objectId);
      if (!object) throw Error("Choose an object.");

      if (message.op === "DELETE") {
        state.objects = state.objects.filter(o => o.id !== object.id);
        state.rules = state.rules.filter(r => r.objectId !== object.id);
      } else if (message.op === "ASSIGN") {
        const field = fieldDefinition(object, message.field);
        const candidate = message.candidate;

        if (!candidate || typeof candidate.raw !== "string" ||
            candidate.raw.length > 100000)
          throw Error("Invalid captured value.");

        coerce(candidate.pageUrl, "url");

        const method = candidate.extraction;

        if (!method ||
            !["text", "selection", "attribute", "pageUrl"].includes(method.type))
          throw Error("Invalid extraction method.");

        if (method.type !== "pageUrl" &&
            (typeof candidate.selector !== "string" ||
             !candidate.selector || candidate.selector.length > 10000))
          throw Error("Invalid selector.");

        if (method.type === "attribute" &&
            !["href", "src", "datetime", "title", "alt", "content"].includes(method.attribute))
          throw Error("Invalid attribute.");

        if (method.type === "selection" &&
            (!method.quote ||
             ["exact", "prefix", "suffix"].some(k => typeof method.quote[k] !== "string")))
          throw Error("Invalid selection context.");

        object.values[message.field] = coerce(candidate.raw, field.type);

        state.rules = state.rules.filter(
          r => !(r.objectId === object.id && r.field === message.field)
        );

        state.rules.push({
          id: uuid(),
          objectId: object.id,
          field: message.field,
          pageUrl: candidate.pageUrl,
          selector: candidate.selector,
          extraction: method,
          sampleValue: candidate.raw,
          createdAt: now
        });

        object.updatedAt = now;
      } else if (message.op === "APPLY") {
        if (!Array.isArray(message.results))
          throw Error("Invalid preview.");

        for (const result of message.results) {
          const rule = state.rules.find(
            r => r.id === result.ruleId && r.objectId === object.id
          );

          if (!rule)
            throw Error("An extraction rule changed. Preview again.");

          object.values[rule.field] = coerce(
            result.raw,
            fieldDefinition(object, rule.field).type
          );

          rule.lastExtractedAt = now;
        }

        object.updatedAt = now;
      } else {
        throw Error("Unknown operation.");
      }
    }

    state.revision++;
    return state;
  }

  globalThis.BurbotCore = {
    clean, empty, coerce, occurrences, selectedText, readElement, mutate
  };
})();
