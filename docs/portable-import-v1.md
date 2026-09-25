# Burbot portable import JSON v1

Burbot import keeps source snapshots separate from the business objects extracted from them. `sources[].snapshot.text` should be a faithful textual snapshot of the real source. Evidence points into that snapshot with Unicode code-point offsets.

The v1 format is backward compatible. Objects can declare remote file attachments, contacts, geography and financing variants.

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

### Recruitment geography per operator

Project geography remains attached to the Project itself.

Recruitment geography belongs to a concrete assigned operator. Use an `operator` reference on each recruitment geography row:

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

If a recruitment has exactly one assigned operator, old imports without `geography[].operator` are automatically scoped to that operator. With zero or multiple operators, `geography[].operator` is required.

## `objects[].files[]`

A file attachment references an existing entry from `sources[]`; the URL is not duplicated.

Supported remote file source types are:

`DOC`, `DOCX`, `PDF`, `XLSX`, `PNG`, `JPG`, `JPEG`.

- `source` — required source key. It must point to one of the supported file source types with an HTTP(S) `url`.
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

In the UI, unset values are presented as `Wybierz na podstawie treści`, `Nie ustalono`, or `Do ustalenia z instrukcji`; those are placeholders, not stored enum values.

Older v1 imports may still contain `document_kind` and `delivery_method`. They remain accepted for backward compatibility but are not part of the current file editor/export model.

This creates an object-level Burbot file source that remains available after approval.

## `objects[].financing[]`

Each financing entry becomes one Burbot financing variant. Project and Recruitment use the same financing structure.

- `key` — required stable key unique within the object's financing list.
- `company_size` — one of `MICRO`, `SMALL`, `MEDIUM`, `LARGE`, `B2C`.
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
- imported evidence/sources are attached to the updated values;
- the existing object's internal ID remains unchanged.

The final database commit assigns `last_checked_at` to new or changed objects.
