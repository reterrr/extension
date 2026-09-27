#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import os
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
    "ogłoszony": "OGLOSZONY",
    "ogloszony": "OGLOSZONY",
    "planowany": "PLANOWANY",
    "wkrótce": "PLANOWANY",
    "wkrotce": "PLANOWANY",
    "aktywny": "AKTYWNY",
    "otwarty": "AKTYWNY",
    "zawieszony": "ZAWIESZONY",
    "zamknięty": "ZAMKNIETY",
    "zamkniety": "ZAMKNIETY",
    "zakończony": "ZAMKNIETY",
    "zakonczony": "ZAMKNIETY",
    "anulowany": "ANULOWANY",
    "cancelled": "ANULOWANY",
    "canceled": "ANULOWANY",
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


def optional_time(value: str, field: str, recruitment_id: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?", value.replace(".", ":"))
    if not match:
        raise ValueError(
            f"{recruitment_id}.{field}: expected HH:MM, got {value!r}."
        )
    hour = int(match.group(1))
    minute = int(match.group(2) or "0")
    if hour > 23 or minute > 59:
        raise ValueError(
            f"{recruitment_id}.{field}: invalid time {value!r}."
        )
    return f"{hour:02d}:{minute:02d}"


def optional_int_range(
    value: str,
    field: str,
    recruitment_id: str,
    minimum: int,
    maximum: int,
) -> int | None:
    value = value.strip()
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(
            f"{recruitment_id}.{field}: expected integer, got {value!r}."
        ) from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(
            f"{recruitment_id}.{field}: expected {minimum}..{maximum}, got {parsed}."
        )
    return parsed


def optional_url(value: str, field: str, recruitment_id: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    return common.valid_url(value, f"{recruitment_id}.{field}")


def url_list(value: str, field: str, recruitment_id: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    parts = [part.strip() for part in value.split(";") if part.strip()]
    return [
        common.valid_url(part, f"{recruitment_id}.{field}") or ""
        for part in parts
    ]


def normalized_url_list(value: str, field: str, recruitment_id: str) -> str | None:
    urls = [url for url in url_list(value, field, recruitment_id) if url]
    return " ; ".join(urls) if urls else None


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


MONTH_BY_NAME = {
    "STYCZEN": 1,
    "LUTY": 2,
    "MARZEC": 3,
    "KWIECIEN": 4,
    "MAJ": 5,
    "CZERWIEC": 6,
    "LIPIEC": 7,
    "SIERPIEN": 8,
    "WRZESIEN": 9,
    "PAZDZIERNIK": 10,
    "LISTOPAD": 11,
    "GRUDZIEN": 12,
}
ROMAN_QUARTER = {"I": 1, "II": 2, "III": 3, "IV": 4}


def planned_range_components(
    start_low_date: str | None,
    start_ceil_date: str | None,
    end_low_date: str | None,
    end_ceil_date: str | None,
    name: str,
) -> dict[str, int | None]:
    result: dict[str, int | None] = {
        "planned_start_low_year": None,
        "planned_start_ceil_year": None,
        "planned_start_low_month": None,
        "planned_start_ceil_month": None,
        "planned_start_low_week": None,
        "planned_start_ceil_week": None,
        "planned_start_low_quarter": None,
        "planned_start_ceil_quarter": None,
        "planned_end_low_year": None,
        "planned_end_ceil_year": None,
        "planned_end_low_month": None,
        "planned_end_ceil_month": None,
        "planned_end_low_week": None,
        "planned_end_ceil_week": None,
        "planned_end_low_quarter": None,
        "planned_end_ceil_quarter": None,
    }

    def apply_date(prefix: str, bound: str, value: str | None) -> None:
        if not value:
            return
        year, month, day = (int(part) for part in value.split("-"))
        result[f"{prefix}_{bound}_year"] = year
        result[f"{prefix}_{bound}_month"] = month
        result[f"{prefix}_{bound}_week"] = min(5, (day - 1) // 7 + 1)
        result[f"{prefix}_{bound}_quarter"] = (month - 1) // 3 + 1

    apply_date("planned_start", "low", start_low_date)
    apply_date("planned_start", "ceil", start_ceil_date)
    apply_date("planned_end", "low", end_low_date)
    apply_date("planned_end", "ceil", end_ceil_date)

    if not start_low_date and not start_ceil_date:
        normalized = common.normalize_key(name)
        years = sorted(set(re.findall(r"\b20\d{2}\b", name)))
        if len(years) == 1:
            year = int(years[0])
            result["planned_start_low_year"] = year
            result["planned_start_ceil_year"] = year
        months = [
            number
            for month_name, number in MONTH_BY_NAME.items()
            if month_name in normalized
        ]
        if len(set(months)) == 1:
            month = months[0]
            quarter = (month - 1) // 3 + 1
            result["planned_start_low_month"] = month
            result["planned_start_ceil_month"] = month
            result["planned_start_low_quarter"] = quarter
            result["planned_start_ceil_quarter"] = quarter
        quarter_match = re.search(
            r"(?:^|_)(I|II|III|IV)_KWARTAL(?:_|$)",
            normalized,
        )
        if quarter_match:
            quarter = ROMAN_QUARTER[quarter_match.group(1)]
            result["planned_start_low_quarter"] = quarter
            result["planned_start_ceil_quarter"] = quarter

    return result


def set_or_remove(values: dict[str, Any], key: str, value: Any) -> None:
    if value is None or value == "":
        values.pop(key, None)
    else:
        values[key] = value


def recruitment_source_url(row: dict[str, str]) -> str | None:
    recruitment_id = row["nabor_id"]
    direct = optional_url(row.get("link_nabor", ""), "link_nabor", recruitment_id)
    if direct:
        return direct
    data_urls = url_list(
        row.get("zrodlo_danych", ""),
        "zrodlo_danych",
        recruitment_id,
    )
    if data_urls:
        return data_urls[0]
    return optional_url(
        row.get("link_dokumenty", ""),
        "link_dokumenty",
        recruitment_id,
    )


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
        for field in ("link_nabor", "link_dokumenty"):
            optional_url(row[field], field, rid)
        for field in ("zrodlo_danych", "zrodlo_weryfikacji_finansow"):
            url_list(row[field], field, rid)
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

        planned_fields = (
            "planned_start_low_date",
            "planned_start_ceil_date",
            "planned_start_low_time",
            "planned_start_ceil_time",
            "planned_end_low_date",
            "planned_end_ceil_date",
            "planned_end_low_time",
            "planned_end_ceil_time",
            "planned_start_low_year",
            "planned_start_ceil_year",
            "planned_start_low_month",
            "planned_start_ceil_month",
            "planned_start_low_week",
            "planned_start_ceil_week",
            "planned_start_low_quarter",
            "planned_start_ceil_quarter",
            "planned_end_low_year",
            "planned_end_ceil_year",
            "planned_end_low_month",
            "planned_end_ceil_month",
            "planned_end_low_week",
            "planned_end_ceil_week",
            "planned_end_low_quarter",
            "planned_end_ceil_quarter",
        )
        legacy_planned_fields = (
            "planned_start_date",
            "planned_start_time",
            "planned_end_date",
            "planned_end_time",
            "planowanyStartRok",
            "planowanyStartMiesiac",
            "planowanyStartTydzien",
            "planowanyStartKwartal",
            "planowanyKoniecRok",
            "planowanyKoniecMiesiac",
            "planowanyKoniecTydzien",
            "planowanyKoniecKwartal",
        )
        if status == "PLANOWANY":
            for field in (
                "dataRozpoczeciaOd",
                "godzinaRozpoczecia",
                "dataRozpoczeciaDo",
                "dataZakonczeniaOd",
                "dataZakonczeniaDo",
                "godzinaZakonczenia",
            ):
                values.pop(field, None)
            for field in legacy_planned_fields:
                values.pop(field, None)

            start_low_date = optional_date(
                row.get("planowany_start_data_od", ""),
                "planowany_start_data_od",
                recruitment_key,
            ) or start_date
            start_ceil_date = optional_date(
                row.get("planowany_start_data_do", ""),
                "planowany_start_data_do",
                recruitment_key,
            ) or start_low_date
            end_low_date = optional_date(
                row.get("planowany_koniec_data_od", ""),
                "planowany_koniec_data_od",
                recruitment_key,
            ) or end_date
            end_ceil_date = optional_date(
                row.get("planowany_koniec_data_do", ""),
                "planowany_koniec_data_do",
                recruitment_key,
            ) or end_low_date

            set_or_remove(values, "planned_start_low_date", start_low_date)
            set_or_remove(values, "planned_start_ceil_date", start_ceil_date)
            set_or_remove(values, "planned_end_low_date", end_low_date)
            set_or_remove(values, "planned_end_ceil_date", end_ceil_date)
            legacy_start_time = optional_time(
                row.get("planowana_godzina_rozpoczecia", ""),
                "planowana_godzina_rozpoczecia",
                recruitment_key,
            )
            legacy_end_time = optional_time(
                row.get("planowana_godzina_zakonczenia", ""),
                "planowana_godzina_zakonczenia",
                recruitment_key,
            )
            start_low_time = optional_time(
                row.get("planowany_start_godzina_od", ""),
                "planowany_start_godzina_od",
                recruitment_key,
            )
            start_ceil_time = optional_time(
                row.get("planowany_start_godzina_do", ""),
                "planowany_start_godzina_do",
                recruitment_key,
            )
            end_low_time = optional_time(
                row.get("planowany_koniec_godzina_od", ""),
                "planowany_koniec_godzina_od",
                recruitment_key,
            )
            end_ceil_time = optional_time(
                row.get("planowany_koniec_godzina_do", ""),
                "planowany_koniec_godzina_do",
                recruitment_key,
            )
            if legacy_start_time and not start_low_time and not start_ceil_time:
                start_low_time = legacy_start_time
                start_ceil_time = legacy_start_time
            if legacy_end_time and not end_low_time and not end_ceil_time:
                end_low_time = legacy_end_time
                end_ceil_time = legacy_end_time

            set_or_remove(values, "planned_start_low_time", start_low_time)
            set_or_remove(values, "planned_start_ceil_time", start_ceil_time)
            set_or_remove(values, "planned_end_low_time", end_low_time)
            set_or_remove(values, "planned_end_ceil_time", end_ceil_time)

            components = planned_range_components(
                start_low_date,
                start_ceil_date,
                end_low_date,
                end_ceil_date,
                row["nabor_nazwa"],
            )
            explicit_component_columns = {
                "planned_start_low_year": ("planowany_start_rok_od", "planowany_start_rok", 1000, 9999),
                "planned_start_ceil_year": ("planowany_start_rok_do", "planowany_start_rok", 1000, 9999),
                "planned_start_low_month": ("planowany_start_miesiac_od", "planowany_start_miesiac", 1, 12),
                "planned_start_ceil_month": ("planowany_start_miesiac_do", "planowany_start_miesiac", 1, 12),
                "planned_start_low_week": ("planowany_start_tydzien_od", "planowany_start_tydzien", 1, 5),
                "planned_start_ceil_week": ("planowany_start_tydzien_do", "planowany_start_tydzien", 1, 5),
                "planned_start_low_quarter": ("planowany_start_kwartal_od", "planowany_start_kwartal", 1, 4),
                "planned_start_ceil_quarter": ("planowany_start_kwartal_do", "planowany_start_kwartal", 1, 4),
                "planned_end_low_year": ("planowany_koniec_rok_od", "planowany_koniec_rok", 1000, 9999),
                "planned_end_ceil_year": ("planowany_koniec_rok_do", "planowany_koniec_rok", 1000, 9999),
                "planned_end_low_month": ("planowany_koniec_miesiac_od", "planowany_koniec_miesiac", 1, 12),
                "planned_end_ceil_month": ("planowany_koniec_miesiac_do", "planowany_koniec_miesiac", 1, 12),
                "planned_end_low_week": ("planowany_koniec_tydzien_od", "planowany_koniec_tydzien", 1, 5),
                "planned_end_ceil_week": ("planowany_koniec_tydzien_do", "planowany_koniec_tydzien", 1, 5),
                "planned_end_low_quarter": ("planowany_koniec_kwartal_od", "planowany_koniec_kwartal", 1, 4),
                "planned_end_ceil_quarter": ("planowany_koniec_kwartal_do", "planowany_koniec_kwartal", 1, 4),
            }
            for field, (column, legacy_column, minimum, maximum) in explicit_component_columns.items():
                raw = row.get(column, "") or row.get(legacy_column, "")
                explicit = optional_int_range(
                    raw,
                    column if row.get(column, "") else legacy_column,
                    recruitment_key,
                    minimum,
                    maximum,
                )
                set_or_remove(
                    values,
                    field,
                    explicit if explicit is not None else components[field],
                )
        else:
            for field in planned_fields + legacy_planned_fields:
                values.pop(field, None)
            values.pop("dataRozpoczeciaDo", None)
            values.pop("dataZakonczeniaOd", None)
            set_or_remove(values, "dataRozpoczeciaOd", start_date)
            set_or_remove(
                values,
                "godzinaRozpoczecia",
                optional_time(
                    row.get("godzina_rozpoczecia", ""),
                    "godzina_rozpoczecia",
                    recruitment_key,
                ),
            )
            set_or_remove(values, "dataZakonczeniaDo", end_date)
            set_or_remove(
                values,
                "godzinaZakonczenia",
                optional_time(
                    row.get("godzina_zakonczenia", ""),
                    "godzina_zakonczenia",
                    recruitment_key,
                ),
            )

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
            normalized_url_list(
                row["zrodlo_danych"], "zrodlo_danych", recruitment_key
            ),
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
            normalized_url_list(
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
        default=os.environ.get("BURBOT_DB_URL", "http://127.0.0.1:8765"),
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
