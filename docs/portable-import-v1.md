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
            "responsibility": "CLIENT",
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

A file attachment references an existing entry from `sources[]`; the URL is not duplicated.

Supported file source types are:

`DOC`, `DOCX`, `PDF`, `XLSX`, `PNG`, `JPG`, `JPEG`, `ZIP`, `RAR`,
`7Z`, `TAR`, `GZ`, `TGZ`.

Archive attachments use the same business metadata fields as other files.
Burbot does not extract field values from inside archives; the dedicated
value-extraction workflow remains PDF-only.

- `key` — optional stable attachment key, but required when a `documents[]` row references this file through `original_file`. Exports emit it whenever the attachment already has a stable key or a document requirement uses it as an operator template; unrelated legacy physical-only attachments may remain keyless for backward-compatible round trips.
- `source` — required source key. It must point to one of the supported file source types with an HTTP(S) `url`. ZIP/RAR/7Z/TAR/GZ/TGZ sources are valid attachments and can be classified normally.
- `source_page` — optional source key for the page where the file link was found. If supplied, that source must have a URL.
- `name` — legacy-only input. The stored technical filename is always derived from the remote file URL; when `metadata.display_name` is absent, legacy `name` is used as the business display-name fallback.
- `metadata` — optional business classification of the concrete file.
- `evidence` — optional evidence for individual metadata fields, using the same Unicode code-point ranges as object evidence.

Current file metadata fields are:

- `display_name` — editable business name of the document. It does not overwrite the technical filename.
- `purpose` — one of:
  - `Formularz do uzupełnienia`
  - `Regulamin`
  - `Instrukcja`
  - `Inny dokument`
- `has_fields` — boolean. `true` means the file contains fields/declarations to complete; `false` means it does not.
- `intended_use` — free-text description of what the document is used for.
- `client_requirement` — one of:
  - `Obowiązkowy`
  - `Warunkowy`
  - `Informacyjny`
- `signature_requirement` — one of:
  - `Nie jest wymagany`
  - `Wymagany podpisany plik`
  - `Dowód w systemie operatora`

In the UI, every unset file-classification value is presented consistently as `Nie ustalono`. It is a UI placeholder/unset state, not a stored enum value. For `has_fields`, the empty value is distinct from both `true` and `false`.

When file metadata is missing, Burbot may apply conservative filename-based defaults for common BUR/PSF document names. Explicit import metadata always wins. Examples: a real `Regulamin...` file defaults to `purpose: "Regulamin"`, `has_fields: false`, `client_requirement: "Informacyjny"`; PUR/formularz/instrukcja/ranking/umowa patterns use their own more specific rules. An attachment whose name merely contains `do_Regulaminu` is not treated as a regulation when a more specific document pattern such as PUR or karta oceny is present.

Older v1 imports may still contain `document_kind` and `delivery_method`. They remain accepted for backward compatibility but are not part of the current file editor/export model.

Older document requirements may also contain `data.version_label` and `source_files`. They remain importable for compatibility, but current exports and AI-generated imports omit both fields.

This creates an object-level Burbot file source that remains available after approval.

## `objects[].documents[]`

Document requirements are first-class business rows and are deliberately separate from physical file attachments.

Use them for all documents that matter in the process, including documents for which the operator does **not** provide a template: a BUR Service Card, bank-account proof, KRS/CEIDG printout, invoice, payment confirmation, certificate, power of attorney or another externally obtained document.

A dynamic document row contains:

- `key` — required stable document-requirement key;
- `data.label` — required readable name, up to 500 characters;
- `data.purpose` — free-text purpose, up to 1000 characters;
- `data.requirement` — `UNKNOWN`, `REQUIRED`, `CONDITIONAL`, or `INFORMATIONAL`;
- `data.condition` — condition for a conditional requirement, up to 1000 characters;
- `data.fulfillment_mode` — `OPERATOR_TEMPLATE` or `WITHOUT_OPERATOR_TEMPLATE`;
- `data.delivery_stage` — process stage, up to 60 characters;
- `data.responsibility` — `FUNDPILOT`, `CLIENT`, or `SHARED`;
- `data.required_evidence` — what must actually be delivered/shown, up to 4000 characters;
- `data.source_url` — optional official HTTP(S) URL;
- `data.source_description` — explanation of the source/basis, up to 1000 characters;
- `data.signature_requirement` — `UNKNOWN`, `NOT_REQUIRED`, `REQUIRED_FILE`, or `EXTERNAL_OPERATOR`;
- `original_file` — optional `files[].key` identifying the operator-provided template. It is required when `fulfillment_mode` is `OPERATOR_TEMPLATE`;
- `evidence` — optional evidence for fields inside `data`.

For an informational document, Burbot normalizes the fulfillment mode to `WITHOUT_OPERATOR_TEMPLATE` and does not treat the physical file as a client template.

Example without an operator template:

```json
{
  "key": "DOC_BUR_SERVICE_CARD",
  "data": {
    "label": "Karta Usługi opublikowana w BUR",
    "purpose": "Potwierdzenie wybranej usługi przy zgłoszeniu.",
    "requirement": "REQUIRED",
    "fulfillment_mode": "WITHOUT_OPERATOR_TEMPLATE",
    "delivery_stage": "ZGLOSZENIE",
    "responsibility": "CLIENT",
    "required_evidence": "Karta Usługi pobrana z BUR dla wybranej usługi.",
    "signature_requirement": "NOT_REQUIRED"
  }
}
```

Example using an operator template:

```json
{
  "key": "DOC_DE_MINIMIS",
  "data": {
    "label": "Wniosek o udzielenie pomocy de minimis",
    "requirement": "CONDITIONAL",
    "condition": "Gdy wsparcie stanowi pomoc de minimis.",
    "fulfillment_mode": "OPERATOR_TEMPLATE",
    "delivery_stage": "ZGLOSZENIE",
    "responsibility": "CLIENT",
    "required_evidence": "Wypełniony i podpisany formularz operatora.",
    "signature_requirement": "REQUIRED_FILE"
  },
  "original_file": "FILE_DE_MINIMIS"
}
```

The old `document_type_key`, `auto_fill`, and `notes` representation is still accepted for backward compatibility. New imports should use the dynamic fields above instead.

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
