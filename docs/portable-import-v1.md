# Burbot portable import/export JSON v1

Burbot import keeps source snapshots separate from the business objects extracted from them. `sources[].snapshot.text` should be a faithful textual snapshot of the real source. Evidence points into that snapshot with Unicode code-point offsets.

Both **Eksportuj zestaw** and **Eksportuj wszystkie dane JSON** write this same v1 document, directly accepted by Import. View export includes related recruitments for selected projects and the referenced projects/operators needed by `$ref`. Every object appears once in `objects`; there are no nested recruitment copies. Stable object/row keys survive editing and reimport. Source snapshots and supported evidence are retained, with identical stored snapshot copies deduplicated. A file without a captured text snapshot uses `snapshot.text: ""`; this is not evidence that its contents were read.

`objects[].source_url` is an optional absolute HTTP(S) URL identifying the original source page independently of evidence. It survives review and approval. System timestamps, draft decisions and executable DOM rules are not part of this business format. The JSON contains file URLs, not binary attachments; loopback URLs require the original local file server.

Older `burbot-ai-view` documents and full workspace JSON backups are converted to the same business format on import. Identical nested/top-level copies are deduplicated by ID; conflicting copies produce an error. Unknown business fields and missing referenced objects are reported, not silently removed. Legacy rules are never executed or reconstructed by import.

The v1 format is backward compatible. Objects can declare remote file attachments, dynamic document requirements, contacts, geography and financing variants. A document requirement may reference an operator template from `files[]`, or exist without any template at all.

A complete importable example lives at:

`examples/portable-import-v1.example.json`

That example is covered by the import-review tests so its offsets, references, file metadata and evidence stay compatible with the real importer.

```json
{
  "version": 1,
  "offset_unit": "unicode_codepoint",
  "sources": [
    {
      "key": "project-page",
      "type": "HTML",
      "url": "https://example.org/project",
      "snapshot": {
        "text": "Projekt: Generator Kompetencji 3.0"
      }
    },
    {
      "key": "regulations-pdf",
      "type": "PDF",
      "url": "https://example.org/files/regulamin-projektu.pdf",
      "snapshot": {
        "text": "Regulamin projektu"
      }
    }
  ],
  "objects": [
    {
      "key": "project-1",
      "type": "project",
      "data": {
        "name": "Generator Kompetencji 3.0",
        "type": "B2B",
        "status": "AKTYWNY"
      },
      "files": [
        {
          "key": "FILE_REGULATIONS",
          "source": "regulations-pdf",
          "source_page": "project-page",
          "metadata": {
            "display_name": "Regulamin projektu",
            "purpose": "Regulamin",
            "has_fields": false,
            "intended_use": "Zasady udziału w projekcie",
            "client_requirement": "Informacyjny",
            "signature_requirement": "Nie jest wymagany"
          }
        }
      ],
      "documents": [
        {
          "key": "DOC_REGULATIONS",
          "data": {
            "label": "Regulamin projektu",
            "purpose": "Materiał informacyjny opisujący zasady udziału.",
            "requirement": "INFORMATIONAL",
            "fulfillment_mode": "WITHOUT_OPERATOR_TEMPLATE",
            "signature_requirement": "NOT_REQUIRED"
          }
        }
      ]
    }
  ]
}
```

## Object fields relevant to AI import

AI should output only values that are actually known from the sources. It does **not** need to invent empty keys. Import Review is schema-driven and shows the same normal fields as Workspace even when they are absent from `objects[].data`; omitted fields appear as `Nie ustawiono`.

`recruitment.continuous` is a boolean field for a continuous/open-ended recruitment.

`last_checked_at` is a system-managed date-time field on Project, Operator and Recruitment. It must **not** be supplied by AI imports. Burbot stamps it automatically when a changed/new object is committed to SQLite.

Projects and recruitments now use `objects[].operators[]` for operator relations. The old single `data.operator_id` reference is still accepted as a backward-compatible import and is migrated to one `GLOWNY` assignment.

Refund percentages are **not object-level Project/Recruitment fields**. They belong to a concrete financing variant in `objects[].financing[]`. This avoids a second, conflicting "Dofinansowanie" section next to the normal financing variants.

## `objects[].operators[]`

Both `project` and `recruitment` can have multiple operators.

Each row contains:

- `key` — stable relation key;
- `operator` — `{ "$ref": "operator-key" }`;
- `operator_type` — `GLOWNY` or `DODATKOWY`.

Example:

```json
"operators": [
  {
    "key": "operator-main",
    "operator": { "$ref": "operator-1" },
    "operator_type": "GLOWNY"
  },
  {
    "key": "operator-partner",
    "operator": { "$ref": "operator-2" },
    "operator_type": "DODATKOWY"
  }
]
```

At most one operator can be `GLOWNY`. If an import supplies operators but none is marked `GLOWNY`, Burbot promotes the first row to `GLOWNY`.

### Project and recruitment geography per operator

Geography on both a Project and a Recruitment belongs to a concrete operator assigned to that object. Use an `operator` reference on each geography row:

```json
"geography": [
  {
    "key": "op1-lubuskie",
    "type": "WOJEWODZTWO",
    "role": "OBEJMUJE",
    "value": "lubuskie",
    "operator": { "$ref": "operator-1" }
  },
  {
    "key": "op2-lubuskie",
    "type": "WOJEWODZTWO",
    "role": "OBEJMUJE",
    "value": "lubuskie",
    "operator": { "$ref": "operator-2" }
  }
]
```

If a Project or Recruitment has exactly one assigned operator, old imports without `geography[].operator` are automatically scoped to that operator. With zero or multiple operators, `geography[].operator` is required. A geography row may reference only an operator assigned to the same owning object.

## `objects[].files[]`

Portable v1 now uses **one canonical document list**. A real-world document must appear exactly once in `files[]`.

There are two forms.

A physical operator file:

```json
{
  "key": "DOC_APPLICATION",
  "source": "SRC_APPLICATION",
  "source_page": "SRC_ROUND_PAGE",
  "metadata": {
    "display_name": "Formularz zgłoszeniowy",
    "purpose": "Formularz do uzupełnienia",
    "has_fields": true,
    "client_requirement": "Obowiązkowy",
    "signature_requirement": "Wymagany podpisany plik"
  }
}
```

A requirement for which the operator provides no template:

```json
{
  "key": "DOC_BUR_SERVICE_CARD",
  "without_template": true,
  "metadata": {
    "display_name": "Karta Usługi opublikowana w BUR",
    "purpose": "Inny dokument",
    "intended_use": "Potwierdzenie wybranej usługi.",
    "client_requirement": "Obowiązkowy",
    "delivery_stage": "ZGLOSZENIE",
    "responsibility": "CLIENT",
    "required_evidence": "Karta Usługi pobrana z BUR.",
    "signature_requirement": "Nie jest wymagany",
    "source_url": "https://operator.example/round",
    "source_description": "Requirement from the recruitment regulation."
  }
}
```

Rules:

- `key` — stable object-local document key; required for new canonical imports.
- `source` — physical attachment source; required unless `without_template: true`.
- `without_template: true` — means the requirement exists but no operator-provided file/template exists. In that case `source` must be omitted.
- `source_page` — optional page source for a physical file.
- `name` — legacy input only; use `metadata.display_name` in new imports.
- `metadata` — classification for the same document. Workflow fields `delivery_stage`, `responsibility` and `required_evidence` apply only to `without_template: true`.
- `evidence` — evidence for supplied metadata fields.

Supported physical source types are `DOC`, `DOCX`, `PDF`, `XLSX`, `PNG`, `JPG`, `JPEG`, `ZIP`, `RAR`, `7Z`, `TAR`, `GZ`, `TGZ`.

Current metadata fields:

- `display_name`;
- `purpose`: `Formularz do uzupełnienia`, `Regulamin`, `Instrukcja`, `Inny dokument`;
- `has_fields`;
- `intended_use`;
- `client_requirement`: `Obowiązkowy`, `Warunkowy`, `Informacyjny`;
- `condition`;
- `delivery_stage` — only for `without_template: true`;
- `responsibility`: `FUNDPILOT`, `CLIENT`, `SHARED` — only for `without_template: true`;
- `required_evidence` — only for `without_template: true`;
- `signature_requirement`: `Nie jest wymagany`, `Wymagany podpisany plik`, `Dowód w systemie operatora`;
- `source_url`;
- `source_description`;
- legacy `document_kind` and `delivery_method`.

Do not represent one operator form once as a physical `files[]` entry and again as a `documents[]` row. That is a duplicate.

An informational physical PDF such as a regulation is still a single `files[]` entry with `source` and `client_requirement: "Informacyjny"`.

### Legacy `objects[].documents[]`

Older portable v1 documents may contain a separate `documents[]` collection with `original_file`. It remains accepted for backward compatibility only. **New exports and AI-generated imports must not emit `documents[]`.**

When converting old data, merge the requirement fields into the matching `files[].metadata`. A legacy document without `original_file` becomes a single `files[]` row with `without_template: true`.

Older document requirements may also contain `data.version_label` and `source_files`; these remain readable only for compatibility.

## `objects[].services[]`

Project services are runtime-defined; there is no fixed service catalog.

Only a `project` object may declare `services[]`:

```json
{
  "services": [
    { "key": "SERVICE_TRAINING", "label": "Szkolenia" },
    { "key": "SERVICE_ADVISORY", "label": "Doradztwo" }
  ]
}
```

Each row has a stable project-local `key` and a `label` of 1–200 characters. Do not create generic services when the source does not actually distinguish financing by service.

A financing row can reference a service through `service`:

```json
{
  "key": "micro-training",
  "company_size": "MICRO",
  "service": "SERVICE_TRAINING",
  "data": {
    "refund_percent_max": 80
  }
}
```

For Project financing, `service` must reference that Project's own `services[].key`. Recruitment financing may reference a service declared on its referenced Project. The Project and its services therefore need to be present in the same portable document. Omitting `service` means the financing variant is not scoped to one particular service.

## `objects[].financing[]`

Each financing entry becomes one Burbot financing variant. Project and Recruitment use the same financing structure. The field name `company_size` is retained for compatibility, but it also covers the two employer-category values `NON_PUBLIC_FINANCE_EMPLOYER` and `OTHER_EMPLOYER`.

- `key` — required stable key unique within the object's financing list.
- `company_size` — one of `MICRO`, `SMALL`, `MEDIUM`, `LARGE`, `B2C`, `NGO`, `NON_PUBLIC_FINANCE_EMPLOYER`, `OTHER_EMPLOYER`. The last two are programme-specific employer groups: employers outside the public-finance sector and remaining employers.
- `service` — optional project-local `services[].key` that scopes the variant to a runtime-defined service.
- `data` — any supported financing fields:
  - `refund_percent_min` — minimum refund percentage, `0..100`;
  - `refund_percent_avg` — average refund percentage, `0..100`;
  - `refund_percent_max` — maximum refund percentage, `0..100`;
  - `max_amount_pln`;
  - `max_per_person_pln`;
  - `own_contribution_form`: `UNSPECIFIED`, `CASH`, or `WAGES`;
  - `notes`.

A fixed refund such as 60% should be represented as:

```json
{
  "refund_percent_min": 60,
  "refund_percent_avg": 60,
  "refund_percent_max": 60
}
```

Legacy imports using a single `refund_percent` remain accepted. Burbot migrates that value to `refund_percent_min`, `refund_percent_avg` and `refund_percent_max`.

Variant numbers are assigned in input order separately for each company size.

## Review semantics

The import first enters **Import Review**. Import Review is read-only: it is used to inspect imported values, attached files, financing variants and evidence/source locations. Corrections are made in Workspace after approval.

Approval stages the selected object into the active commit. If the imported object matches an object already present in the active commit (stable import key / object ID, or the supported Project-number / Operator-NIP identity fallback), approval updates that existing object **in place** instead of creating a duplicate.

For an in-place update:

- only object fields explicitly supplied by the import (plus fields manually corrected during Import Review) are changed;
- omitted object fields keep their existing values, so schema defaults from the preview cannot accidentally overwrite real data;
- financing variants are upserted by their stable financing `key`; only fields supplied for that variant are changed;
- existing financing fields omitted by AI are preserved;
- files are upserted by URL rather than duplicated;
- document requirements are upserted by their stable `key`; operator-template and source-file links are remapped to the target object's file records;
- imported evidence/sources are attached to the updated values;
- the existing object's internal ID remains unchanged.

The final database commit assigns `last_checked_at` to new or changed objects.
