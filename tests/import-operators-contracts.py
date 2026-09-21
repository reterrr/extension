#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORTER_PATH = ROOT / "scripts" / "import-operators-xlsx.py"
_spec = importlib.util.spec_from_file_location(
    "burbot_operator_importer_test_target",
    IMPORTER_PATH,
)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load {IMPORTER_PATH}.")
importer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(importer)


class OperatorImporterContracts(unittest.TestCase):
    def test_operator_metadata_and_contact_variants_are_replaced_idempotently(self) -> None:
        state = importer.empty_state()
        record = {
            "operator_id": "OP_TEST",
            "name": "Operator Test",
            "role": "OPERATOR",
            "nip": "1234567890",
            "address": "ul. Testowa 1",
            "emails": ["a@example.test", "b@example.test"],
            "phones": ["+48 17 123 45 67", "+48 600 700 800"],
            "website": "https://example.test",
            "notes": "Kontakt testowy",
            "source_url": "https://example.test",
        }

        importer.merge_operators(state, [record], "operators.xlsx")
        operator = state["objects"][0]
        self.assertEqual(operator["values"]["role"], "OPERATOR")
        self.assertEqual(operator["values"]["address"], "ul. Testowa 1")
        self.assertEqual(operator["values"]["notes"], "Kontakt testowy")

        contacts = state["operatorContacts"]
        self.assertEqual(
            [(row["kind"], row["variant_no"], row["value"]) for row in contacts],
            [
                ("EMAIL", 1, "a@example.test"),
                ("EMAIL", 2, "b@example.test"),
                ("PHONE", 1, "+48 17 123 45 67"),
                ("PHONE", 2, "+48 600 700 800"),
            ],
        )

        changed = {
            **record,
            "emails": ["new@example.test"],
            "phones": ["+48 500 500 500"],
        }
        importer.merge_operators(state, [changed], "operators.xlsx")
        self.assertEqual(
            [(row["kind"], row["variant_no"], row["value"]) for row in state["operatorContacts"]],
            [
                ("EMAIL", 1, "new@example.test"),
                ("PHONE", 1, "+48 500 500 500"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
