# Burbot portable import JSON v1

Burbot import keeps source snapshots separate from the business objects extracted from them. `sources[].snapshot.text` should be a faithful textual snapshot of the real source. Evidence points into that snapshot with Unicode code-point offsets.

The v1 format is backward compatible. Objects can additionally declare remote PDF attachments and financing variants.

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
        "text": "...faithful page text..."
      }
    },
    {
      "key": "regulations-pdf",
      "type": "PDF",
      "url": "https://example.org/files/regulations.pdf",
      "snapshot": {
        "text": "...text extracted from the PDF..."
      }
    }
  ],
  "objects": [
    {
      "key": "operator-1",
      "type": "operator",
      "data": {
        "name": "Example operator"
      }
    },
    {
      "key": "project-1",
      "type": "project",
      "data": {
        "name": "Example project",
        "operator_id": { "$ref": "operator-1" },
        "status": "AKTYWNY",
        "refund_percent_min": 50,
        "refund_percent_max": 80
      },
      "evidence": {
        "name": [
          {
            "source": "project-page",
            "char_start": 123,
            "char_end": 138,
            "raw_value": "Example project"
          }
        ]
      },
      "files": [
        {
          "source": "regulations-pdf",
          "source_page": "project-page",
          "name": "Regulamin projektu.pdf"
        }
      ],
      "financing": [
        {
          "key": "micro-standard",
          "company_size": "MICRO",
          "data": {
            "refund_percent": 80,
            "max_amount_pln": 100000,
            "max_per_person_pln": 5000,
            "own_contribution_form": "CASH",
            "notes": "Standardowy wariant"
          }
        }
      ]
    },
    {
      "key": "recruitment-1",
      "type": "recruitment",
      "data": {
        "external_number": "1/2026",
        "project_id": { "$ref": "project-1" },
        "refund_percent_min": 60,
        "refund_percent_max": 80
      }
    }
  ]
}
```

## Object fields relevant to AI import

AI should output only values that are actually known from the sources. It does **not** need to invent empty keys. Import Review is schema-driven and shows the same normal fields as Workspace even when they are absent from `objects[].data`; omitted fields appear as `Nie ustawiono` and can be completed manually or by using the page picker.

Additional current fields include:

- `project.operator_id` — reference to an imported `operator` via `{ "$ref": "operator-key" }`;
- `project.refund_percent_min` — minimum project refund percentage, `0..100`;
- `project.refund_percent_max` — maximum project refund percentage, `0..100`;
- `recruitment.refund_percent_min` — minimum recruitment refund percentage, `0..100`;
- `recruitment.refund_percent_max` — maximum recruitment refund percentage, `0..100`.

## `objects[].files[]`

A file attachment references an existing entry from `sources[]`; the URL is not duplicated.

- `source` — required source key. It must point to a `PDF` source with an HTTP(S) `url`.
- `source_page` — optional source key for the HTML/PDF page where the file link was found. If supplied, that source must have a URL.
- `name` — optional display name. When omitted, Burbot derives it from the PDF URL.

This creates an object-level Burbot file source that remains available after approval.

## `objects[].financing[]`

Each financing entry becomes one Burbot financing variant.

- `key` — required stable key unique within the object's financing list.
- `company_size` — one of `MICRO`, `SMALL`, `MEDIUM`, `LARGE`.
- `data` — any supported financing fields:
  - `refund_percent`
  - `max_amount_pln`
  - `max_per_person_pln`
  - `own_contribution_form`: `UNSPECIFIED`, `CASH`, or `WAGES`
  - `notes`

Variant numbers are assigned in input order separately for each company size.

## Review semantics

The import first enters **Import Review**. Import Review uses the same field-oriented interaction model as Workspace. Before approval the reviewer can:

- see all normal schema fields, including fields omitted by AI;
- select a field and use `Pick element`, selected text, page URL, or a manual value;
- edit imported object fields;
- change financing values or remove a financing variant;
- rename or remove an attached PDF;
- inspect evidence and jump to the matching source location.

When a reviewer manually changes an object field, Burbot removes imported evidence for that field. Evidence for the old value must not be presented as proof of the corrected value.
