import copy
import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "import_projects_xlsx",
    ROOT / "scripts" / "import-projects-xlsx.py",
)
assert SPEC and SPEC.loader
importer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(importer)


class ImportProjectsContracts(unittest.TestCase):
    def state(self):
        return {
            "version": 1,
            "revision": 0,
            "objects": [
                {
                    "id": "OP_1",
                    "importKey": "OP_1",
                    "type": "operator",
                    "label": "Operator 1",
                    "values": {"name": "Operator 1"},
                },
                {
                    "id": "OP_2",
                    "importKey": "OP_2",
                    "type": "operator",
                    "label": "Operator 2",
                    "values": {"name": "Operator 2"},
                },
            ],
            "rules": [],
            "geographies": [],
            "operatorAssignments": [],
        }

    def project_row(self):
        return {
            "projekt_id": "PR_1",
            "nazwa_projektu": "Projekt 1",
            "typ_odbiorcy": "B2B",
            "data_start": "46000",
            "data_koniec": "46100",
            "status_projektu": "aktywny",
            "link_do_harmonogramu": "",
            "link_do_dokumentow": "",
            "operator_id": "OP_1",
        }

    def test_project_geography_uses_project_operator(self):
        state = self.state()
        result = importer.merge_projects(
            state,
            [self.project_row()],
            [
                {
                    "geo_projekt_id": "GPR_1",
                    "projekt_id": "PR_1",
                    "geo_id": "GEO_1",
                }
            ],
            {"GEO_1": ("WOJEWODZTWO", "podkarpackie")},
            "fixture.xlsx",
        )

        project = next(
            obj for obj in state["objects"] if obj.get("importKey") == "PR_1"
        )
        self.assertEqual(result["geography_rows"], 1)
        self.assertEqual(
            state["geographies"][0]["operatorId"],
            "OP_1",
        )
        self.assertTrue(
            any(
                assignment["objectId"] == project["id"]
                and assignment["operatorId"] == "OP_1"
                and assignment["operatorType"] == "GLOWNY"
                for assignment in state["operatorAssignments"]
            )
        )
        self.assertNotIn("operator_id", project["values"])

    def test_exported_project_geography_can_name_additional_operator(self):
        state = self.state()
        importer.merge_projects(
            state,
            [self.project_row()],
            [
                {
                    "geo_projekt_id": "GPR_1",
                    "projekt_id": "PR_1",
                    "operator_id": "OP_2",
                    "geo_id": "GEO_1",
                }
            ],
            {"GEO_1": ("WOJEWODZTWO", "śląskie")},
            "fixture.xlsx",
        )

        project = next(
            obj for obj in state["objects"] if obj.get("importKey") == "PR_1"
        )
        self.assertEqual(state["geographies"][0]["operatorId"], "OP_2")
        self.assertTrue(
            any(
                assignment["objectId"] == project["id"]
                and assignment["operatorId"] == "OP_2"
                and assignment["operatorType"] == "DODATKOWY"
                for assignment in state["operatorAssignments"]
            )
        )


if __name__ == "__main__":
    unittest.main()
