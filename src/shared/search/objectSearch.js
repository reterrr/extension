const TYPE_ALIASES = new Map([
  ["project", "project"],
  ["projekty", "project"],
  ["projekt", "project"],
  ["operator", "operator"],
  ["operatorzy", "operator"],
  ["recruitment", "recruitment"],
  ["recruitments", "recruitment"],
  ["rekrutacja", "recruitment"],
  ["nabor", "recruitment"],
  ["nabór", "recruitment"],
  ["nabory", "recruitment"],
]);

const FIELD_ALIASES = new Map([
  ["type", "type"],
  ["typ", "type"],
  ["name", "name"],
  ["nazwa", "name"],
  ["nip", "nip"],
  ["number", "number"],
  ["numer", "number"],
  ["status", "status"],
  ["id", "id"],
  ["geo", "geo"],
  ["geografia", "geo"],
  ["woj", "wojewodztwo"],
  ["wojewodztwo", "wojewodztwo"],
  ["województwo", "wojewodztwo"],
  ["podregion", "podregion"],
  ["powiat", "powiat"],
  ["gmina", "gmina"],
  ["miasto", "miasto"],
  ["city", "miasto"],
]);

export function normalizeObjectSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pl-PL")
    .trim();
}

function canonicalType(value) {
  return TYPE_ALIASES.get(normalizeObjectSearch(value)) ?? null;
}

function appendUnique(values, value) {
  const text = String(value ?? "").trim();
  if (text && !values.includes(text)) values.push(text);
}

function geographyEntryText(row, entry) {
  return [
    entry?.label,
    entry?.context,
    entry?.value,
    entry?.search,
    row.value,
  ]
    .filter(Boolean)
    .join(" ");
}

function geographyParents(row, entry) {
  const canonical = String(entry?.value ?? row.value ?? "");
  const parts = canonical.split("|");
  let wojewodztwo = "";
  let powiat = "";

  if (row.type === "WOJEWODZTWO") {
    wojewodztwo = canonical;
  } else if (
    parts.length >= 3 &&
    (parts[1] === "powiat" || parts[1] === "miasto")
  ) {
    wojewodztwo = parts[0];
    if (parts[1] === "powiat") powiat = parts.at(-1) ?? "";
  } else if (row.type === "GMINA" && entry?.context) {
    const context = String(entry.context)
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (context.length >= 2) {
      powiat = context[0];
      wojewodztwo = context.at(-1) ?? "";
    }
  }

  return { wojewodztwo, powiat };
}

export function buildGeographySearchIndex(geographies = [], catalog = []) {
  const catalogByKey = new Map(
    catalog.map((entry) => [entry.type + "\u0000" + entry.value, entry]),
  );
  const byObject = new Map();

  for (const row of geographies) {
    const entry = catalogByKey.get(row.type + "\u0000" + row.value);
    const text = geographyEntryText(row, entry);
    const current = byObject.get(row.objectId) ?? {
      geo: [],
      wojewodztwo: [],
      podregion: [],
      powiat: [],
      gmina: [],
      miasto: [],
    };

    appendUnique(current.geo, text);

    if (row.type === "WOJEWODZTWO")
      appendUnique(current.wojewodztwo, entry?.label ?? row.value);
    else if (row.type === "PODREGION")
      appendUnique(current.podregion, text);
    else if (row.type === "POWIAT")
      appendUnique(current.powiat, text);
    else if (row.type === "GMINA")
      appendUnique(current.gmina, text);
    else if (row.type === "MIASTO_NA_PRAWACH_POWIATU")
      appendUnique(current.miasto, text);

    const parents = geographyParents(row, entry);
    appendUnique(current.wojewodztwo, parents.wojewodztwo);
    appendUnique(current.powiat, parents.powiat);

    byObject.set(row.objectId, current);
  }

  return new Map(
    [...byObject].map(([objectId, fields]) => [
      objectId,
      Object.fromEntries(
        Object.entries(fields).map(([key, values]) => [key, values.join(" ")]),
      ),
    ]),
  );
}

export function createObjectSearchDocument(
  object,
  displayName,
  typeLabel,
  geography = {},
) {
  const objectType = object.type === "nabor" ? "recruitment" : object.type;
  const values = object.values ?? {};
  const number = values.number ?? values.external_number ?? "";
  const name = [displayName, object.label, values.name].filter(Boolean).join(" ");
  const type = [
    objectType,
    typeLabel,
    objectType === "project" ? "projekt projekty" : "",
    objectType === "operator" ? "operator operatorzy" : "",
    objectType === "recruitment"
      ? "recruitment rekrutacja nabór nabor nabory"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const fields = {
    type,
    name,
    nip: values.nip ?? "",
    number,
    status: values.status ?? "",
    id: [object.id, object.importKey].filter(Boolean).join(" "),
    geo: geography.geo ?? "",
    wojewodztwo: geography.wojewodztwo ?? "",
    podregion: geography.podregion ?? "",
    powiat: geography.powiat ?? "",
    gmina: geography.gmina ?? "",
    miasto: geography.miasto ?? "",
  };

  const all = [
    ...Object.values(fields),
    object.sourceUrl,
    values.announcements_site_url,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    raw: { ...fields, all },
    normalized: Object.fromEntries(
      Object.entries({ ...fields, all }).map(([key, value]) => [
        key,
        normalizeObjectSearch(value),
      ]),
    ),
    canonicalType: objectType,
  };
}

function tokenize(query) {
  const tokens = [];
  let current = "";
  let quote = null;
  let regex = false;
  let escaped = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === "/" && !regex) {
      const before = current.at(-1);
      if (!current || before === ":") regex = true;
      current += char;
      continue;
    }

    if (char === "/" && regex) {
      regex = false;
      current += char;
      continue;
    }

    if (/\s/.test(char) && !regex) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function rawRegex(value) {
  if (!value.startsWith("/")) return null;
  let slash = -1;
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "/") slash = index;
  }
  if (slash <= 0) return null;

  const pattern = value.slice(1, slash);
  const suppliedFlags = value.slice(slash + 1);
  if (!/^[dgimsuvy]*$/.test(suppliedFlags)) {
    throw new Error(`Nieobsługiwane flagi regex: ${suppliedFlags || "(brak)"}.`);
  }
  const flags = [...new Set(suppliedFlags)].join("");
  return new RegExp(pattern, flags);
}

function wildcardRegex(value) {
  const normalized = normalizeObjectSearch(stripQuotes(value));
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(pattern, "u");
}

function compileTerm(token) {
  let negative = false;
  if ((token.startsWith("-") || token.startsWith("!")) && token.length > 1) {
    negative = true;
    token = token.slice(1);
  }

  let field = "all";
  let value = token;
  const colon = token.indexOf(":");
  if (colon > 0) {
    const candidate = FIELD_ALIASES.get(
      normalizeObjectSearch(token.slice(0, colon)),
    );
    if (candidate) {
      field = candidate;
      value = token.slice(colon + 1);
    }
  }

  if (!value) throw new Error(`Brak wartości po ${field}:.`);

  if (field === "type") {
    const quoted = stripQuotes(value);
    const alias = canonicalType(quoted);
    if (alias) {
      return {
        negative,
        matches: (document) => document.canonicalType === alias,
      };
    }
  }

  const regex = rawRegex(value);
  if (regex) {
    return {
      negative,
      matches: (document) => {
        const raw = String(document.raw[field] ?? "");
        const normalized = String(document.normalized[field] ?? "");
        regex.lastIndex = 0;
        if (regex.test(raw)) return true;
        regex.lastIndex = 0;
        return regex.test(normalized);
      },
    };
  }

  const matcher = wildcardRegex(value);
  return {
    negative,
    matches: (document) =>
      matcher.test(String(document.normalized[field] ?? "")),
  };
}

export function compileObjectSearch(query) {
  const source = String(query ?? "").trim();
  if (!source) {
    return {
      error: null,
      matches: () => true,
    };
  }

  try {
    const terms = tokenize(source).map(compileTerm);
    return {
      error: null,
      matches(document) {
        return terms.every((term) => {
          const result = term.matches(document);
          return term.negative ? !result : result;
        });
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      matches: () => false,
    };
  }
}
