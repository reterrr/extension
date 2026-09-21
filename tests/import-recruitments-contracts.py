#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORTER_PATH = ROOT / "scripts" / "import-recruitments-xlsx.py"
_spec = importlib.util.spec_from_file_location(
    "burbot_recruitment_importer_test_target",
    IMPORTER_PATH,
)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load {IMPORTER_PATH}.")
importer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(importer)


def base_row() -> dict[str, str]:
    return {key: "" for key in importer.RECRUITMENT_HEADERS}


class RecruitmentImporterContracts(unittest.TestCase):
    def test_status_mapping_and_explicit_continuous_detection(self) -> None:
        self.assertEqual(importer.STATUS_MAP["ogłoszony"], "OGLOSZONY")
        self.assertEqual(importer.STATUS_MAP["planowany"], "PLANOWANY")
        self.assertEqual(importer.STATUS_MAP["aktywny"], "AKTYWNY")
        self.assertEqual(importer.STATUS_MAP["zawieszony"], "ZAWIESZONY")
        self.assertEqual(importer.STATUS_MAP["zamknięty"], "ZAMKNIETY")
        self.assertEqual(importer.STATUS_MAP["anulowany"], "ANULOWANY")
        # Backwards-compatible spreadsheet labels remain accepted.
        self.assertEqual(importer.STATUS_MAP["otwarty"], "AKTYWNY")
        self.assertEqual(importer.STATUS_MAP["wkrótce"], "PLANOWANY")

        row = base_row()
        row["nabor_id"] = "NAB_TEST_CIAGLY"
        self.assertTrue(importer.continuous_from_source(row))

        row["nabor_id"] = "NAB_TEST"
        row["nabor_nazwa"] = "Nabór od 1 do 30 września 2026"
        self.assertFalse(importer.continuous_from_source(row))

    def test_b2b_financing_maps_base_standard_and_limits(self) -> None:
        row = base_row()
        row.update(
            {
                "nabor_id": "NAB_B2B",
                "mikro_procent_bazowy": "50",
                "mikro_procent": "80",
                "mikro_max_na_firme": "12000",
                "mikro_max_na_uczestnika": "6000",
                "mala_procent_bazowy": "45",
                "mala_procent": "75",
            }
        )

        variants = importer.build_b2b_financing(row, "object-1")
        by_size = {variant["company_size"]: variant for variant in variants}

        self.assertEqual(set(by_size), {"MICRO", "SMALL"})
        self.assertEqual(by_size["MICRO"]["refund_percent_base"], 50)
        self.assertEqual(by_size["MICRO"]["refund_percent_standard"], 80)
        self.assertEqual(by_size["MICRO"]["max_amount_pln"], 12000)
        self.assertEqual(by_size["MICRO"]["max_per_person_pln"], 6000)
        self.assertEqual(by_size["SMALL"]["refund_percent_base"], 45)
        self.assertEqual(by_size["SMALL"]["refund_percent_standard"], 75)

    def test_b2c_financing_maps_all_source_values(self) -> None:
        row = base_row()
        row.update(
            {
                "nabor_id": "NAB_B2C",
                "b2c_procent_bazowy": "80",
                "b2c_procent_max": "95",
                "b2c_wklad_wlasny_standard": "20",
                "b2c_wklad_wlasny_min": "5",
                "b2c_max_wartosc_uslug": "10000",
                "b2c_max_refundacja_standard": "8000",
                "b2c_max_refundacja_max": "9500",
            }
        )

        [variant] = importer.build_b2c_financing(row, "object-2")
        self.assertEqual(variant["company_size"], "B2C")
        self.assertEqual(variant["refund_percent_base"], 80)
        self.assertEqual(variant["refund_percent_max"], 95)
        self.assertEqual(variant["own_contribution_percent_standard"], 20)
        self.assertEqual(variant["own_contribution_percent_min"], 5)
        self.assertEqual(variant["max_service_value_pln"], 10000)
        self.assertEqual(variant["max_refund_standard_pln"], 8000)
        self.assertEqual(variant["max_refund_max_pln"], 9500)

    def test_planned_components_use_exact_date_or_explicit_name_period(self) -> None:
        exact = importer.planned_components(
            "2026-10-15",
            "2026-12-20",
            "Planowany nabór",
        )
        self.assertEqual(exact["planowanyStartRok"], 2026)
        self.assertEqual(exact["planowanyStartMiesiac"], 10)
        self.assertEqual(exact["planowanyStartKwartal"], 4)
        self.assertEqual(exact["planowanyKoniecMiesiac"], 12)
        self.assertEqual(exact["planowanyKoniecKwartal"], 4)

        named = importer.planned_components(
            None,
            None,
            "Planowany nabór – wrzesień 2026",
        )
        self.assertEqual(named["planowanyStartRok"], 2026)
        self.assertEqual(named["planowanyStartMiesiac"], 9)
        self.assertEqual(named["planowanyStartKwartal"], 3)

        quarter = importer.planned_components(
            None,
            None,
            "Planowany nabór – IV kwartał 2026",
        )
        self.assertEqual(quarter["planowanyStartRok"], 2026)
        self.assertEqual(quarter["planowanyStartKwartal"], 4)

    def test_multiple_source_urls_are_normalized_without_loss(self) -> None:
        value = (
            "https://example.test/a ; "
            "https://example.test/b ; "
            "https://example.test/c"
        )
        self.assertEqual(
            importer.url_list(value, "zrodlo_danych", "NAB_URL"),
            [
                "https://example.test/a",
                "https://example.test/b",
                "https://example.test/c",
            ],
        )
        self.assertEqual(
            importer.normalized_url_list(
                value,
                "zrodlo_danych",
                "NAB_URL",
            ),
            (
                "https://example.test/a ; "
                "https://example.test/b ; "
                "https://example.test/c"
            ),
        )


if __name__ == "__main__":
    unittest.main()
