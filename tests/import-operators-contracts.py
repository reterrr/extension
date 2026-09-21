from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import-operators-xlsx.py"

spec = importlib.util.spec_from_file_location("burbot_import_operators", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load operator importer.")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_merge_operator_contacts() -> None:
    state = module.empty_state()
    record = {
        "operator_id": "OP_TEST_001",
        "name": "Operator Test",
        "nip": "1234567890",
        "address": "ul. Testowa 1, 00-001 Warszawa",
        "email": "kontakt@example.org",
        "phone": "+48 22 123 45 67",
        "website": "https://example.org",
        "notes": "Notatka operatora",
        "source_url": "https://example.org",
    }

    summary = module.merge_operators(state, [record], "operatorzy.xlsx")
    assert summary["created"] == 1
    operator = state["objects"][0]
    values = operator["values"]

    assert values["name"] == "Operator Test"
    assert values["nip"] == "1234567890"
    assert values["address"] == "ul. Testowa 1, 00-001 Warszawa"
    assert values["email"] == "kontakt@example.org"
    assert values["phone"] == "+48 22 123 45 67"
    assert values["website"] == "https://example.org"
    assert values["notes"] == "Notatka operatora"


def main() -> None:
    test_merge_operator_contacts()
    print("operator importer contracts: OK")


if __name__ == "__main__":
    main()
