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

export function createObjectSearchDocument(object, displayName, typeLabel) {
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
  if (!/^[dimsuv]*$/.test(suppliedFlags)) {
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
