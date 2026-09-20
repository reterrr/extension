#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COMMON_PATH = Path(__file__).with_name("import-projects-xlsx.py")
_spec = importlib.util.spec_from_file_location("burbot_project_importer", COMMON_PATH)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load shared XLSX importer helpers from {COMMON_PATH}.")
common = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(common)

RECRUITMENT_HEADERS = [
    "nabor_id",
    "nabor_nr",
    "operator_id",
    "projekt_id",
    "nabor_nazwa",
    "nabor_od",
    "nabor_do",
    "status",
    "link_nabor",
    "link_dokumenty",
    "mikro_procent",
    "mikro_max_na_firme",
    "mikro_max_na_uczestnika",
    "mala_procent",
    "mala_max_na_firme",
    "mala_max_na_uczestnika",
    "srednia_procent",
    "srednia_max_na_firme",
    "srednia_max_na_uczestnika",
    "kod_dzialania",
    "zrodlo_danych",
    "uwaga",
    "link_prowadzi_do_konkretnego_naboru",
    "mikro_procent_bazowy",
    "mala_procent_bazowy",
    "srednia_procent_bazowy",
    "zasady_dofinansowania",
    "data_weryfikacji_finansow",
    "zrodlo_weryfikacji_finansow",
    "b2c_procent_bazowy",
    "b2c_procent_max",
    "b2c_wklad_wlasny_standard",
    "b2c_wklad_wlasny_min",
    "b2c_max_wartosc_uslug",
    "b2c_max_refundacja_standard",
    "b2c_max_refundacja_max",
    "wojewodztwo",
    "lista_powiatow",
    "nazwa_operatora",
    "nazwa_projektu",
]
PROJECT_HEADERS = ["projekt_id", "typ_odbiorcy", "nazwa_projektu", "operator_id"]
OPERATOR_HEADERS = ["operator_id", "nazwa_operatora"]
GEO_DICT_HEADERS = [
    "geo_id",
    "parent_geo_id",
    "poziom",
    "geo_typ",
    "nazwa",
    "canonical_geo_id",
]
GEO_RECRUITMENT_HEADERS = ["id", "nabor_id", "miejscowosc_id", "typ"]

STATUS_MAP = {
    "zamknięty": "ZAKONCZONY",
    "zamkniety": "ZAKONCZONY",
    "otwarty": "AKTYWNY",
    "wkrótce": "PLANOWANY",
    "wkrotce": "PLANOWANY",
}

ROLE_MAP = {
    "include": "OBEJMUJE",
    "exclude": "WYKLUCZA",
}


def read_workbook(
    path: Path,
) -> tuple[
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, str]],
]:
    with zipfile.ZipFile(path) as zf:
        shared = common.read_shared_strings(zf)
        sheet_paths = common.workbook_sheet_paths(zf)
        required = (
            "Operatorzy",
            "Projekty",
            "Nabory",
            "Geografia_Slownik",
            "Geografia_Nabory",
        )
        for sheet in required:
            if sheet not in sheet_paths:
                raise ValueError(f"Workbook is missing worksheet {sheet!r}.")

        operators = common.rows_as_records(
            common.read_sheet(zf, sheet_paths["Operatorzy"], shared),
            OPERATOR_HEADERS,
            "Operatorzy",
        )
        projects = common.rows_as_records(
            common.read_sheet(zf, sheet_paths["Projekty"], shared),
            PROJECT_HEADERS,
            "Projekty",
        )
        recruitments = common.rows_as_records(
            common.read_sheet(zf, sheet_paths["Nabory"], shared),
            RECRUITMENT_HEADERS,
            "Nabory",
        )
        geo_dict = common.rows_as_records(
            common.read_sheet(zf, sheet_paths["Geografia_Slownik"], shared),
            GEO_DICT_HEADERS,
            "Geografia_Slownik",
        )
        geo_recruitments = common.rows_as_records(
            common.read_sheet(zf, sheet_paths["Geografia_Nabory"], shared),
            GEO_RECRUITMENT_HEADERS,
            "Geografia_Nabory",
        )

    return operators, projects, recruitments, geo_dict, geo_recruitments


def optional_date(value: str, field: str, recruitment_id: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    return common.excel_date(value, field, recruitment_id)


def optional_url(value: str, field: str, recruitment_id: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    return common.valid_url(value, f"{recruitment_id}.{field}")


def optional_number(value: str, field: str, recruitment_id: str) -> int | float | None:
    value = value.strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(
            f"{recruitment_id}.{field}: expected a number, got {value!r}."
        ) from exc
    if not (number == number and abs(number) != float("inf")):
        raise ValueError(f"{recruitment_id}.{field}: invalid number {value!r}.")
    return int(number) if number.is_integer() else number


def optional_percentage(
    value: str, field: str, recruitment_id: str
) -> int | float | None:
    number = optional_number(value, field, recruitment_id)
    if number is None:
        return None
    if number < 0 or number > 100:
        raise ValueError(
            f"{recruitment_id}.{field}: percentage must be between 0 and 100."
        )
    return number


def boolean_pl(value: str, field: str, recruitment_id: str) -> bool | None:
    value = value.strip().casefold()
    if not value:
        return None
    if value in {"tak", "true", "1", "yes"}:
        return True
    if value in {"nie", "false", "0", "no"}:
        return False
    raise ValueError(
        f"{recruitment_id}.{field}: expected tak/nie, got {value!r}."
    )


def continuous_from_source(row: dict[str, str]) -> bool:
    text = " ".join(
        [
            row.get("nabor_id", ""),
            row.get("nabor_nazwa", ""),
            row.get("uwaga", ""),
            row.get("zasady_dofinansowania", ""),
        ]
    )
    normalized = common.normalize_key(text)
    return "CIAGL" in normalized


def inferred_year(start_date: str | None, name: str) -> int | None:
    if start_date:
        return int(start_date[:4])
    years = sorted(set(re.findall(r"\b20\d{2}\b", name)))
    if len(years) == 1:
        return int(years[0])
    return None


def set_or_remove(values: dict[str, Any], key: str, value: Any) -> None:
    if value is None or value == "":
        values.pop(key, None)
    else:
        values[key] = value


def recruitment_source_url(row: dict[str, str]) -> str | None:
    for field in ("link_nabor", "zrodlo_danych", "link_dokumenty"):
        value = row.get(field, "").strip()
        if value:
            return optional_url(value, field, row["nabor_id"])
    return None


def build_b2b_financing(
    row: dict[str, str],
    object_id: str,
) -> list[dict[str, Any]]:
    recruitment_id = row["nabor_id"]
    variants: list[dict[str, Any]] = []
    definitions = [
        ("MICRO", "mikro"),
        ("SMALL", "mala"),
        ("MEDIUM", "srednia"),
    ]

    for size, prefix in definitions:
        base = optional_percentage(
            row[f"{prefix}_procent_bazowy"],
            f"{prefix}_procent_bazowy",
            recruitment_id,
        )
        standard = optional_percentage(
            row[f"{prefix}_procent"],
            f"{prefix}_procent",
            recruitment_id,
        )
        max_company = optional_number(
            row[f"{prefix}_max_na_firme"],
            f"{prefix}_max_na_firme",
            recruitment_id,
        )
        max_person = optional_number(
            row[f"{prefix}_max_na_uczestnika"],
            f"{prefix}_max_na_uczestnika",
            recruitment_id,
        )

        if all(value is None for value in (base, standard, max_company, max_person)):
            continue

        variant: dict[str, Any] = {
            "id": f"xlsx:{recruitment_id}:funding:{size}",
            "objectId": object_id,
            "company_size": size,
            "variant_no": 1,
        }
        set_or_remove(variant, "refund_percent_base", base)
        set_or_remove(variant, "refund_percent_standard", standard)
        set_or_remove(variant, "max_amount_pln", max_company)
        set_or_remove(variant, "max_per_person_pln", max_person)
        variants.append(variant)

    return variants


def build_b2c_financing(
    row: dict[str, str],
    object_id: str,
) -> list[dict[str, Any]]:
    recruitment_id = row["nabor_id"]
    values = {
        "refund_percent_base": optional_percentage(
            row["b2c_procent_bazowy"], "b2c_procent_bazowy", recruitment_id
        ),
        "refund_percent_max": optional_percentage(
            row["b2c_procent_max"], "b2c_procent_max", recruitment_id
        ),
        "own_contribution_percent_standard": optional_percentage(
            row["b2c_wklad_wlasny_standard"],
            "b2c_wklad_wlasny_standard",
            recruitment_id,
        ),
        "own_contribution_percent_min": optional_percentage(
            row["b2c_wklad_wlasny_min"],
            "b2c_wklad_wlasny_min",
            recruitment_id,
        ),
        "max_service_value_pln": optional_number(
            row["b2c_max_wartosc_uslug"],
            "b2c_max_wartosc_uslug",
            recruitment_id,
        ),
        "max_refund_standard_pln": optional_number(
            row["b2c_max_refundacja_standard"],
            "b2c_max_refundacja_standard",
            recruitment_id,
        ),
        "max_refund_max_pln": optional_number(
            row["b2c_max_refundacja_max"],
            "b2c_max_refundacja_max",
            recruitment_id,
        ),
    }

    if all(value is None for value in values.values()):
        return []

    variant: dict[str, Any] = {
        "id": f"xlsx:{recruitment_id}:funding:B2C",
        "objectId": object_id,
        "company_size": "B2C",
        "variant_no": 1,
    }
    for key, value in values.items():
        set_or_remove(variant, key, value)
    return [variant]


def validate_input(
    operators: list[dict[str, str]],
    projects: list[dict[str, str]],
    recruitments: list[dict[str, str]],
    geo_dict: list[dict[str, str]],
    geo_recruitments: list[dict[str, str]],
    catalog: Any,
) -> tuple[
    dict[str, dict[str, str]],
    dict[str, dict[str, str]],
    dict[str, tuple[str, str]],
]:
    operator_by_id = {row["operator_id"]: row for row in operators}
    project_by_id = {row["projekt_id"]: row for row in projects}
    recruitment_by_id = {row["nabor_id"]: row for row in recruitments}
    geo_by_id = {row["geo_id"]: row for row in geo_dict}

    if len(operator_by_id) != len(operators):
        raise ValueError("Duplicate operator_id in Operatorzy.")
    if len(project_by_id) != len(projects):
        raise ValueError("Duplicate projekt_id in Projekty.")
    if len(recruitment_by_id) != len(recruitments):
        raise ValueError("Duplicate nabor_id in Nabory.")
    if len(geo_by_id) != len(geo_dict):
        raise ValueError("Duplicate geo_id in Geografia_Slownik.")

    used_geo_ids: set[str] = set()
    linked_recruitments: set[str] = set()
    pair_set: set[tuple[str, str, str]] = set()
    link_ids: set[str] = set()

    for row in recruitments:
        rid = row["nabor_id"]
        if not rid:
            raise ValueError("Every recruitment must have nabor_id.")
        if row["projekt_id"] not in project_by_id:
            raise ValueError(
                f"{rid}: unknown projekt_id {row['projekt_id']!r}."
            )
        if row["operator_id"] not in operator_by_id:
            raise ValueError(
                f"{rid}: unknown operator_id {row['operator_id']!r}."
            )
        status = row["status"].strip().casefold()
        if status not in STATUS_MAP:
            raise ValueError(f"{rid}: unsupported status {row['status']!r}.")
        project_type = project_by_id[row["projekt_id"]]["typ_odbiorcy"].upper()
        if project_type not in {"B2B", "B2C"}:
            raise ValueError(
                f"{rid}: project has unsupported type {project_type!r}."
            )

        optional_date(row["nabor_od"], "nabor_od", rid)
        optional_date(row["nabor_do"], "nabor_do", rid)
        optional_date(
            row["data_weryfikacji_finansow"],
            "data_weryfikacji_finansow",
            rid,
        )
        for field in (
            "link_nabor",
            "link_dokumenty",
            "zrodlo_danych",
            "zrodlo_weryfikacji_finansow",
        ):
            optional_url(row[field], field, rid)
        boolean_pl(
            row["link_prowadzi_do_konkretnego_naboru"],
            "link_prowadzi_do_konkretnego_naboru",
            rid,
        )

        if project_type == "B2B":
            build_b2b_financing(row, rid)
        else:
            build_b2c_financing(row, rid)

    for row in geo_recruitments:
        link_id = row["id"]
        rid = row["nabor_id"]
        geo_id = row["miejscowosc_id"]
        role = row["typ"].strip().casefold()

        if not link_id or link_id in link_ids:
            raise ValueError(f"Duplicate or empty Geografia_Nabory.id: {link_id!r}.")
        link_ids.add(link_id)
        if rid not in recruitment_by_id:
            raise ValueError(f"Unknown nabor_id in Geografia_Nabory: {rid}.")
        if geo_id not in geo_by_id:
            raise ValueError(f"Unknown geography {geo_id} for recruitment {rid}.")
        if role not in ROLE_MAP:
            raise ValueError(
                f"{link_id}: unsupported geography role {row['typ']!r}."
            )
        pair = (rid, geo_id, role)
        if pair in pair_set:
            raise ValueError(
                f"Duplicate recruitment/geography/role: {rid} / {geo_id} / {role}."
            )
        pair_set.add(pair)
        linked_recruitments.add(rid)
        used_geo_ids.add(geo_id)

    missing_geo = sorted(set(recruitment_by_id) - linked_recruitments)
    if missing_geo:
        raise ValueError(
            f"{len(missing_geo)} recruitment(s) have no geography: "
            + ", ".join(missing_geo[:10])
        )

    canonical = {
        geo_id: common.canonical_geography(geo_by_id[geo_id], geo_by_id, catalog)
        for geo_id in used_geo_ids
    }
    return project_by_id, operator_by_id, canonical


def merge_recruitments(
    state: dict[str, Any],
    projects: list[dict[str, str]],
    recruitments: list[dict[str, str]],
    geo_recruitments: list[dict[str, str]],
    canonical_geo: dict[str, tuple[str, str]],
    source_name: str,
) -> dict[str, int]:
    objects = state.setdefault("objects", [])
    geographies = state.setdefault("geographies", [])
    financing_rules = state.setdefault("financingRules", [])
    project_by_id = {row["projekt_id"]: row for row in projects}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    project_object_ids: dict[str, str] = {}
    operator_object_ids: dict[str, str] = {}

    referenced_project_ids = sorted({row["projekt_id"] for row in recruitments})
    referenced_operator_ids = sorted({row["operator_id"] for row in recruitments})

    for project_key in referenced_project_ids:
        project = common.find_by_stable_key(objects, "project", project_key)
        if not project:
            raise ValueError(
                f"Missing project {project_key} in SQLite workspace. "
                "Import projects first."
            )
        project_object_ids[project_key] = str(project["id"])

    for operator_key in referenced_operator_ids:
        operator = common.find_by_stable_key(objects, "operator", operator_key)
        if not operator:
            raise ValueError(
                f"Missing operator {operator_key} in SQLite workspace. "
                "Import operators first."
            )
        operator_object_ids[operator_key] = str(operator["id"])

    imported_objects: dict[str, dict[str, Any]] = {}
    created = 0
    updated = 0
    continuous_count = 0
    status_counts: dict[str, int] = {}
    all_financing: list[dict[str, Any]] = []

    for row in recruitments:
        recruitment_key = row["nabor_id"]
        project_type = project_by_id[row["projekt_id"]]["typ_odbiorcy"].upper()
        recruitment = common.find_by_stable_key(
            objects, "recruitment", recruitment_key
        )

        if recruitment is None:
            recruitment = {
                "id": recruitment_key,
                "type": "recruitment",
                "label": row["nabor_nazwa"] or recruitment_key,
                "values": {},
                "createdAt": now,
                "creationNote": f"Imported from {source_name}",
            }
            objects.append(recruitment)
            created += 1
        else:
            updated += 1

        start_date = optional_date(row["nabor_od"], "nabor_od", recruitment_key)
        end_date = optional_date(row["nabor_do"], "nabor_do", recruitment_key)
        verified_at = optional_date(
            row["data_weryfikacji_finansow"],
            "data_weryfikacji_finansow",
            recruitment_key,
        )
        status = STATUS_MAP[row["status"].strip().casefold()]
        continuous = continuous_from_source(row)
        direct_link = boolean_pl(
            row["link_prowadzi_do_konkretnego_naboru"],
            "link_prowadzi_do_konkretnego_naboru",
            recruitment_key,
        )

        values = recruitment.setdefault("values", {})
        values["external_number"] = row["nabor_nazwa"] or recruitment_key
        values["project_id"] = project_object_ids[row["projekt_id"]]
        values["operator_id"] = operator_object_ids[row["operator_id"]]
        values["source_number"] = row["nabor_nr"]
        values["status"] = status
        values["continuous"] = continuous
        values["last_checked_at"] = now

        sequence = int(row["nabor_nr"]) if row["nabor_nr"].isdigit() else None
        set_or_remove(values, "sequence_number", sequence)
        set_or_remove(
            values,
            "year",
            inferred_year(start_date, row["nabor_nazwa"]),
        )

        for field in ("dataRozpoczeciaOd", "dataRozpoczeciaDo"):
            set_or_remove(values, field, start_date)
        for field in ("dataZakonczeniaOd", "dataZakonczeniaDo"):
            set_or_remove(values, field, end_date)

        set_or_remove(
            values,
            "urlOgloszenia",
            optional_url(row["link_nabor"], "link_nabor", recruitment_key),
        )
        set_or_remove(
            values,
            "documents_url",
            optional_url(
                row["link_dokumenty"], "link_dokumenty", recruitment_key
            ),
        )
        set_or_remove(
            values,
            "data_source_url",
            optional_url(row["zrodlo_danych"], "zrodlo_danych", recruitment_key),
        )
        set_or_remove(values, "action_code", row["kod_dzialania"].strip() or None)
        set_or_remove(values, "notes", row["uwaga"].strip() or None)
        set_or_remove(values, "direct_recruitment_link", direct_link)
        set_or_remove(
            values,
            "funding_rules",
            row["zasady_dofinansowania"].strip() or None,
        )
        set_or_remove(values, "funding_verified_at", verified_at)
        set_or_remove(
            values,
            "funding_verification_url",
            optional_url(
                row["zrodlo_weryfikacji_finansow"],
                "zrodlo_weryfikacji_finansow",
                recruitment_key,
            ),
        )

        recruitment["type"] = "recruitment"
        recruitment["label"] = row["nabor_nazwa"] or recruitment_key
        recruitment["importKey"] = recruitment_key
        recruitment["updatedAt"] = now
        source_url = recruitment_source_url(row)
        if source_url:
            recruitment["sourceUrl"] = source_url
        else:
            recruitment.pop("sourceUrl", None)

        imported_objects[recruitment_key] = recruitment
        status_counts[status] = status_counts.get(status, 0) + 1
        if continuous:
            continuous_count += 1

        if project_type == "B2B":
            all_financing.extend(build_b2b_financing(row, str(recruitment["id"])))
        else:
            all_financing.extend(build_b2c_financing(row, str(recruitment["id"])))

    imported_object_ids = {
        str(object["id"]) for object in imported_objects.values()
    }

    state["geographies"] = [
        row
        for row in geographies
        if str(row.get("objectId", "")) not in imported_object_ids
    ]
    imported_geography_rows: list[dict[str, Any]] = []
    for row in geo_recruitments:
        recruitment = imported_objects[row["nabor_id"]]
        geo_type, geo_value = canonical_geo[row["miejscowosc_id"]]
        imported_geography_rows.append(
            {
                "id": row["id"],
                "objectId": str(recruitment["id"]),
                "type": geo_type,
                "role": ROLE_MAP[row["typ"].strip().casefold()],
                "value": geo_value,
            }
        )
    state["geographies"].extend(imported_geography_rows)

    state["financingRules"] = [
        row
        for row in financing_rules
        if str(row.get("objectId", "")) not in imported_object_ids
    ]
    state["financingRules"].extend(all_financing)

    state["revision"] = int(state.get("revision", 0)) + 1

    return {
        "total_recruitments": len(recruitments),
        "created": created,
        "updated": updated,
        "geography_rows": len(imported_geography_rows),
        "financing_rows": len(all_financing),
        "continuous": continuous_count,
        "active": status_counts.get("AKTYWNY", 0),
        "planned": status_counts.get("PLANOWANY", 0),
        "closed": status_counts.get("ZAKONCZONY", 0),
        "revision": state["revision"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Import all BUR recruitments, geography and financing from XLSX "
            "into the current Burbot SQLite workspace."
        )
    )
    parser.add_argument("xlsx", type=Path, help="Path to bur_.xlsx")
    parser.add_argument(
        "--db-url",
        default="http://127.0.0.1:8765",
        help="Burbot DB service URL.",
    )
    parser.add_argument(
        "--geography-source",
        type=Path,
        default=Path("src/shared/types/geography.ts"),
        help="Path to Burbot geography.ts catalog.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate workbook, geography and financing without modifying SQLite.",
    )
    args = parser.parse_args()

    if not args.xlsx.is_file():
        raise SystemExit(f"File does not exist: {args.xlsx}")

    operators, projects, recruitments, geo_dict, geo_recruitments = read_workbook(
        args.xlsx
    )
    catalog = common.GeographyCatalog(args.geography_source)
    project_by_id, _operator_by_id, canonical_geo = validate_input(
        operators,
        projects,
        recruitments,
        geo_dict,
        geo_recruitments,
        catalog,
    )

    b2b = sum(
        1
        for row in recruitments
        if project_by_id[row["projekt_id"]]["typ_odbiorcy"].upper() == "B2B"
    )
    b2c = len(recruitments) - b2b
    continuous = sum(1 for row in recruitments if continuous_from_source(row))
    status_counts: dict[str, int] = {}
    financing_count = 0

    for row in recruitments:
        status = STATUS_MAP[row["status"].strip().casefold()]
        status_counts[status] = status_counts.get(status, 0) + 1
        if project_by_id[row["projekt_id"]]["typ_odbiorcy"].upper() == "B2B":
            financing_count += len(build_b2b_financing(row, row["nabor_id"]))
        else:
            financing_count += len(build_b2c_financing(row, row["nabor_id"]))

    print(f"Validated {len(recruitments)} recruitments from {args.xlsx.name}.")
    print(
        f"Statuses: active={status_counts.get('AKTYWNY', 0)}, "
        f"planned={status_counts.get('PLANOWANY', 0)}, "
        f"closed={status_counts.get('ZAKONCZONY', 0)}."
    )
    print(f"Project types: B2B={b2b}, B2C={b2c}.")
    print(f"Explicit continuous recruitments: {continuous}.")
    print(f"Validated {len(geo_recruitments)} recruitment/geography assignments.")
    print(f"Financing variants to import: {financing_count}.")

    if args.dry_run:
        print("Dry run complete; database was not modified.")
        return 0

    state = common.get_state(args.db_url)
    summary = merge_recruitments(
        state,
        projects,
        recruitments,
        geo_recruitments,
        canonical_geo,
        args.xlsx.name,
    )
    common.put_state(args.db_url, state)

    print(
        "Imported {total_recruitments} recruitments: "
        "{created} created, {updated} updated; "
        "{active} active, {planned} planned, {closed} closed; "
        "{continuous} continuous; {geography_rows} geography rows; "
        "{financing_rows} financing rows; workspace revision {revision}.".format(
            **summary
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, zipfile.BadZipFile) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
