#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

PROJECT_HEADERS = [
    "projekt_id",
    "nazwa_projektu",
    "typ_odbiorcy",
    "data_start",
    "data_koniec",
    "status_projektu",
    "link_do_harmonogramu",
    "link_do_dokumentow",
    "operator_id",
]
GEO_DICT_HEADERS = [
    "geo_id",
    "parent_geo_id",
    "poziom",
    "geo_typ",
    "nazwa",
    "canonical_geo_id",
]
GEO_PROJECT_HEADERS = ["geo_projekt_id", "projekt_id", "geo_id"]

STATUS_MAP = {
    "aktywny": "AKTYWNY",
    "active": "AKTYWNY",
    "planowany": "PLANOWANY",
    "planned": "PLANOWANY",
    "zawieszony": "ZAWIESZONY",
    "suspended": "ZAWIESZONY",
    "zakończony": "ZAKONCZONY",
    "zakonczony": "ZAKONCZONY",
    "closed": "ZAKONCZONY",
}

DIACRITICS = str.maketrans(
    {
        "ą": "a",
        "ć": "c",
        "ę": "e",
        "ł": "l",
        "ń": "n",
        "ó": "o",
        "ś": "s",
        "ź": "z",
        "ż": "z",
        "Ą": "A",
        "Ć": "C",
        "Ę": "E",
        "Ł": "L",
        "Ń": "N",
        "Ó": "O",
        "Ś": "S",
        "Ź": "Z",
        "Ż": "Z",
    }
)


def col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return value - 1


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    out: list[str] = []
    for si in root.findall(f"{{{NS_MAIN}}}si"):
        out.append("".join(t.text or "" for t in si.iter(f"{{{NS_MAIN}}}t")))
    return out


def workbook_sheet_paths(zf: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{NS_PKG_REL}}}Relationship")
    }
    result: dict[str, str] = {}
    for sheet in workbook.findall(f".//{{{NS_MAIN}}}sheet"):
        name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(f"{{{NS_REL}}}id", "")
        target = rel_targets.get(rel_id)
        if not target:
            continue
        result[name] = (
            target.lstrip("/")
            if target.startswith("/")
            else "xl/" + target.lstrip("./")
        )
    return result


def cell_value(cell: ET.Element, shared: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(f"{{{NS_MAIN}}}t"))
    value_node = cell.find(f"{{{NS_MAIN}}}v")
    raw = "" if value_node is None or value_node.text is None else value_node.text
    if cell_type == "s" and raw:
        index = int(raw)
        return shared[index] if 0 <= index < len(shared) else ""
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def read_sheet(zf: zipfile.ZipFile, sheet_path: str, shared: list[str]) -> list[list[str]]:
    root = ET.fromstring(zf.read(sheet_path))
    rows: list[list[str]] = []
    for row in root.findall(f".//{{{NS_MAIN}}}row"):
        values: dict[int, str] = {}
        for cell in row.findall(f"{{{NS_MAIN}}}c"):
            ref = cell.attrib.get("r", "A1")
            values[col_index(ref)] = cell_value(cell, shared).strip()
        if values:
            width = max(values) + 1
            rows.append([values.get(i, "") for i in range(width)])
    return rows


def rows_as_records(rows: list[list[str]], expected: list[str], label: str) -> list[dict[str, str]]:
    if not rows:
        raise ValueError(f"{label} sheet is empty.")
    headers = [str(value).strip() for value in rows[0]]
    missing = [header for header in expected if header not in headers]
    if missing:
        raise ValueError(f"{label} is missing columns: {', '.join(missing)}.")
    records: list[dict[str, str]] = []
    for raw in rows[1:]:
        row = raw + [""] * (len(headers) - len(raw))
        if not any(value.strip() for value in row):
            continue
        records.append({headers[i]: row[i].strip() for i in range(len(headers))})
    return records


def read_workbook(path: Path) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]]]:
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        sheet_paths = workbook_sheet_paths(zf)
        for required in ("Projekty", "Geografia_Slownik", "Geografia_Projekty"):
            if required not in sheet_paths:
                raise ValueError(f"Workbook is missing worksheet {required!r}.")
        projects = rows_as_records(
            read_sheet(zf, sheet_paths["Projekty"], shared),
            PROJECT_HEADERS,
            "Projekty",
        )
        geo_dict = rows_as_records(
            read_sheet(zf, sheet_paths["Geografia_Slownik"], shared),
            GEO_DICT_HEADERS,
            "Geografia_Slownik",
        )
        geo_projects = rows_as_records(
            read_sheet(zf, sheet_paths["Geografia_Projekty"], shared),
            GEO_PROJECT_HEADERS,
            "Geografia_Projekty",
        )
    return projects, geo_dict, geo_projects


def excel_date(value: str, field: str, project_id: str) -> str:
    try:
        serial = float(value)
    except ValueError as exc:
        raise ValueError(f"{project_id}.{field}: expected Excel date serial, got {value!r}.") from exc
    date = datetime(1899, 12, 30) + timedelta(days=serial)
    return date.date().isoformat()


def valid_url(value: str, label: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label}: invalid HTTP(S) URL {value!r}.")
    return value


def best_source_url(project: dict[str, str]) -> str | None:
    candidates = [
        project.get("link_do_dokumentow", ""),
        project.get("Link do harmonogramu / naborów", ""),
        project.get("link_do_harmonogramu", ""),
    ]
    valid = [valid_url(value, project["projekt_id"]) for value in candidates if value.strip()]
    valid = [value for value in valid if value]
    html_like = [value for value in valid if not value.lower().split("?", 1)[0].endswith(".pdf")]
    return (html_like or valid or [None])[0]


def stable_url(project: dict[str, str]) -> str | None:
    for key in ("Link do harmonogramu / naborów", "link_do_harmonogramu"):
        value = project.get(key, "").strip()
        if value:
            return valid_url(value, f"{project['projekt_id']}.{key}")
    return None


def normalize_key(value: str) -> str:
    value = value.translate(DIACRITICS)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_")
    return value.upper()


def strip_city_prefix(value: str) -> str:
    text = value.strip()
    for prefix in ("m.st. ", "m. ", "miasto "):
        if text.casefold().startswith(prefix.casefold()):
            return text[len(prefix):].strip()
    return text


def strip_locality_prefix(value: str) -> str:
    text = value.strip()
    for prefix in ("gmina ", "m.st. ", "m. ", "miasto "):
        if text.casefold().startswith(prefix.casefold()):
            return text[len(prefix):].strip()
    return text


def parse_enum(source: str, enum_name: str) -> dict[str, str]:
    match = re.search(
        rf"export\\s+enum\\s+{re.escape(enum_name)}\\s*\\{{(.*?)\\n\\}}",
        source,
        flags=re.S,
    )
    if not match:
        raise ValueError(f"Could not parse enum {enum_name} from geography.ts.")
    entries: dict[str, str] = {}
    entry_pattern = re.compile(r'\\s*([A-Z0-9_]+)\\s*=\\s*"([^"]+)"\\s*,?\\s*')
    for line in match.group(1).splitlines():
        entry = entry_pattern.fullmatch(line)
        if entry:
            entries[entry.group(1)] = entry.group(2)
    if not entries:
        raise ValueError(f"Enum {enum_name} is empty.")
    return entries

class GeographyCatalog:
    def __init__(self, source_path: Path):
        if not source_path.is_file():
            raise ValueError(f"Missing Burbot geography catalog: {source_path}")
        source = source_path.read_text(encoding="utf-8")
        self.values: dict[str, set[str]] = {}
        for enum_name, type_name in [
            ("Wojewodztwo", "WOJEWODZTWO"),
            ("Podregion", "PODREGION"),
            ("Powiat", "POWIAT"),
            ("Gmina", "GMINA"),
            ("MiastoNaPrawachPowiatu", "MIASTO_NA_PRAWACH_POWIATU"),
        ]:
            parsed = parse_enum(source, enum_name)
            self.values[type_name] = set(parsed.values())
            if enum_name == "Gmina":
                self.gmina_by_key = parsed

    def validate(self, type_name: str, value: str, label: str) -> tuple[str, str]:
        if value not in self.values.get(type_name, set()):
            raise ValueError(
                f"{label}: geography {type_name} value {value!r} is not present in Burbot geography catalog."
            )
        return type_name, value

    def gmina_value(self, woj: str, powiat: str, name: str, label: str) -> str:
        city = name.casefold().startswith("m.")
        locality = strip_locality_prefix(name)
        powiat_name = strip_city_prefix(powiat)
        prefix = (
            f"{normalize_key(woj)}_{normalize_key(powiat_name)}_{normalize_key(locality)}_"
        )
        candidates = [
            (key, value)
            for key, value in self.gmina_by_key.items()
            if key.startswith(prefix)
        ]
        if city:
            candidates = [(key, value) for key, value in candidates if key.endswith("_MIEJSKA")]
        else:
            non_city = [
                (key, value)
                for key, value in candidates
                if not key.endswith("_MIEJSKA")
            ]
            if non_city:
                candidates = non_city

        if len(candidates) != 1:
            rendered = ", ".join(key for key, _ in candidates) or "none"
            raise ValueError(
                f"{label}: could not resolve gmina {name!r} in {powiat!r}, {woj!r}; candidates: {rendered}."
            )
        return candidates[0][1]


def ancestors(geo: dict[str, str], geo_by_id: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    current = geo
    seen: set[str] = set()
    while current.get("parent_geo_id"):
        parent_id = current["parent_geo_id"]
        if parent_id in seen:
            raise ValueError(f"Geography cycle detected at {parent_id}.")
        seen.add(parent_id)
        parent = geo_by_id.get(parent_id)
        if not parent:
            raise ValueError(f"Unknown parent geography {parent_id} for {geo['geo_id']}.")
        result.append(parent)
        current = parent
    return result


def canonical_geography(
    geo: dict[str, str],
    geo_by_id: dict[str, dict[str, str]],
    catalog: GeographyCatalog,
) -> tuple[str, str]:
    lineage = [geo, *ancestors(geo, geo_by_id)]
    woj = next((row for row in lineage if row["geo_typ"] == "wojewodztwo"), None)
    if not woj:
        raise ValueError(f"{geo['geo_id']}: geography has no wojewodztwo ancestor.")
    woj_name = woj["nazwa"].strip().casefold()
    type_name = geo["geo_typ"].strip().casefold()
    name = geo["nazwa"].strip()

    if type_name == "wojewodztwo":
        return catalog.validate("WOJEWODZTWO", woj_name, geo["geo_id"])

    if type_name == "podregion":
        return catalog.validate("PODREGION", name.casefold(), geo["geo_id"])

    if type_name == "powiat":
        if name.casefold().startswith(("m. ", "m.st. ", "miasto ")):
            city = strip_city_prefix(name)
            value = f"{woj_name}|miasto|{city}"
            return catalog.validate("MIASTO_NA_PRAWACH_POWIATU", value, geo["geo_id"])
        value = f"{woj_name}|powiat|{name.casefold()}"
        return catalog.validate("POWIAT", value, geo["geo_id"])

    if type_name == "miasto":
        city = strip_city_prefix(name)
        value = f"{woj_name}|miasto|{city}"
        return catalog.validate("MIASTO_NA_PRAWACH_POWIATU", value, geo["geo_id"])

    if type_name == "gmina":
        powiat = next((row for row in lineage if row["geo_typ"] == "powiat"), None)
        if not powiat:
            raise ValueError(f"{geo['geo_id']}: gmina has no powiat ancestor.")
        value = catalog.gmina_value(woj["nazwa"], powiat["nazwa"], name, geo["geo_id"])
        return catalog.validate("GMINA", value, geo["geo_id"])

    raise ValueError(f"{geo['geo_id']}: unsupported geography type {geo['geo_typ']!r}.")


def empty_state() -> dict[str, Any]:
    return {
        "version": 1,
        "revision": 0,
        "objects": [],
        "rules": [],
        "geographies": [],
        "fileSources": [],
        "importSources": [],
        "financingRules": [],
        "documentRequirements": [],
    }


def get_state(base_url: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(base_url.rstrip("/") + "/state") as response:
            if response.status == 204:
                return empty_state()
            state = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 204:
            return empty_state()
        raise RuntimeError(f"DB service GET /state failed: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach Burbot DB service at {base_url}. Start it with \`npm run db\`."
        ) from exc
    if (
        state.get("version") != 1
        or not isinstance(state.get("objects"), list)
        or not isinstance(state.get("geographies", []), list)
    ):
        raise RuntimeError("DB service returned an unsupported workspace state.")
    return state


def put_state(base_url: str, state: dict[str, Any]) -> None:
    payload = json.dumps(state, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + "/state",
        data=payload,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            if response.status != 200:
                raise RuntimeError(f"DB service PUT /state failed: HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DB service PUT /state failed: HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach Burbot DB service at {base_url}.") from exc


def find_by_stable_key(
    objects: list[dict[str, Any]],
    object_type: str,
    stable_key: str,
) -> dict[str, Any] | None:
    for obj in objects:
        if obj.get("type") == object_type and obj.get("id") == stable_key:
            return obj
    for obj in objects:
        if obj.get("type") == object_type and obj.get("importKey") == stable_key:
            return obj
    return None


def resolve_operator(objects: list[dict[str, Any]], operator_key: str) -> str:
    operator = find_by_stable_key(objects, "operator", operator_key)
    if not operator:
        raise ValueError(
            f"Project references missing operator {operator_key}. Import operators first."
        )
    return str(operator["id"])


def validate_input(
    projects: list[dict[str, str]],
    geo_dict: list[dict[str, str]],
    geo_projects: list[dict[str, str]],
    catalog: GeographyCatalog,
) -> dict[str, tuple[str, str]]:
    project_ids = [row["projekt_id"] for row in projects]
    if any(not value for value in project_ids):
        raise ValueError("Every project must have projekt_id.")
    if len(project_ids) != len(set(project_ids)):
        raise ValueError("Duplicate projekt_id in Projekty sheet.")

    geo_by_id = {row["geo_id"]: row for row in geo_dict}
    if len(geo_by_id) != len(geo_dict):
        raise ValueError("Duplicate geo_id in Geografia_Slownik.")

    link_ids = [row["geo_projekt_id"] for row in geo_projects]
    if len(link_ids) != len(set(link_ids)):
        raise ValueError("Duplicate geo_projekt_id in Geografia_Projekty.")

    project_set = set(project_ids)
    linked_projects: set[str] = set()
    used_geo_ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for row in geo_projects:
        project_id = row["projekt_id"]
        geo_id = row["geo_id"]
        if project_id not in project_set:
            raise ValueError(f"Unknown project in geography link: {project_id}.")
        if geo_id not in geo_by_id:
            raise ValueError(f"Unknown geo_id in geography link: {geo_id}.")
        pair = (project_id, geo_id)
        if pair in pairs:
            raise ValueError(f"Duplicate project/geography pair: {project_id} / {geo_id}.")
        pairs.add(pair)
        linked_projects.add(project_id)
        used_geo_ids.add(geo_id)

    missing = sorted(project_set - linked_projects)
    if missing:
        raise ValueError(
            f"{len(missing)} project(s) have no geography: {', '.join(missing[:10])}."
        )

    canonical = {
        geo_id: canonical_geography(geo_by_id[geo_id], geo_by_id, catalog)
        for geo_id in used_geo_ids
    }
    return canonical


def merge_projects(
    state: dict[str, Any],
    projects: list[dict[str, str]],
    geo_projects: list[dict[str, str]],
    canonical_geo: dict[str, tuple[str, str]],
    source_name: str,
) -> dict[str, int]:
    objects = state.setdefault("objects", [])
    geographies = state.setdefault("geographies", [])
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    project_objects: dict[str, dict[str, Any]] = {}
    created = 0
    updated = 0

    # Resolve every operator before mutating anything so the import is all-or-nothing
    # at the application layer.
    operator_ids = {
        row["projekt_id"]: resolve_operator(objects, row["operator_id"])
        for row in projects
    }

    for row in projects:
        project_key = row["projekt_id"]
        project = find_by_stable_key(objects, "project", project_key)
        if project is None:
            project = {
                "id": project_key,
                "type": "project",
                "label": row["nazwa_projektu"],
                "values": {},
                "createdAt": now,
                "creationNote": f"Imported from {source_name}",
            }
            objects.append(project)
            created += 1
        else:
            updated += 1

        type_value = row["typ_odbiorcy"].upper()
        if type_value not in {"B2B", "B2C"}:
            raise ValueError(f"{project_key}.typ_odbiorcy: unsupported value {type_value!r}.")

        status_key = row["status_projektu"].strip().casefold()
        if status_key not in STATUS_MAP:
            raise ValueError(
                f"{project_key}.status_projektu: unsupported value {row['status_projektu']!r}."
            )

        values = project.setdefault("values", {})
        values["name"] = row["nazwa_projektu"]
        values["operator_id"] = operator_ids[project_key]
        values["type"] = type_value
        values["status"] = STATUS_MAP[status_key]
        values["start_date"] = excel_date(row["data_start"], "data_start", project_key)
        values["end_date"] = excel_date(row["data_koniec"], "data_koniec", project_key)

        schedule_url = stable_url(row)
        if schedule_url:
            values["announcements_site_url"] = schedule_url
        else:
            values.pop("announcements_site_url", None)

        values["last_checked_at"] = now

        project["type"] = "project"
        project["label"] = row["nazwa_projektu"]
        project["importKey"] = project_key
        project["updatedAt"] = now
        source_url = best_source_url(row)
        if source_url:
            project["sourceUrl"] = source_url
        else:
            project.pop("sourceUrl", None)

        if row.get("uwagi") and not project.get("creationNote"):
            project["creationNote"] = f"Imported from {source_name}. {row['uwagi']}"

        project_objects[project_key] = project

    imported_object_ids = {str(project["id"]) for project in project_objects.values()}
    preserved = [
        row
        for row in geographies
        if str(row.get("objectId", "")) not in imported_object_ids
    ]
    imported_geographies: list[dict[str, Any]] = []

    for row in geo_projects:
        project = project_objects[row["projekt_id"]]
        geo_type, geo_value = canonical_geo[row["geo_id"]]
        imported_geographies.append(
            {
                "id": row["geo_projekt_id"],
                "objectId": str(project["id"]),
                "type": geo_type,
                "role": "OBEJMUJE",
                "value": geo_value,
            }
        )

    state["geographies"] = preserved + imported_geographies
    state["revision"] = int(state.get("revision", 0)) + 1

    return {
        "total_projects": len(projects),
        "created": created,
        "updated": updated,
        "geography_rows": len(imported_geographies),
        "revision": state["revision"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import BUR projects and their geography from XLSX into Burbot SQLite."
    )
    parser.add_argument("xlsx", type=Path, help="Path to bur_.xlsx")
    parser.add_argument(
        "--db-url",
        default=os.environ.get("BURBOT_DB_URL", "http://127.0.0.1:8765"),
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
        help="Validate XLSX and geography mapping only; do not modify SQLite.",
    )
    args = parser.parse_args()

    if not args.xlsx.is_file():
        raise SystemExit(f"File does not exist: {args.xlsx}")

    projects, geo_dict, geo_projects = read_workbook(args.xlsx)
    catalog = GeographyCatalog(args.geography_source)
    canonical_geo = validate_input(projects, geo_dict, geo_projects, catalog)

    geography_type_counts: dict[str, int] = {}
    for geo_type, _ in canonical_geo.values():
        geography_type_counts[geo_type] = geography_type_counts.get(geo_type, 0) + 1

    print(f"Validated {len(projects)} projects from {args.xlsx.name}.")
    print(f"Validated {len(geo_projects)} project/geography assignments.")
    print(
        "Canonical geography objects used: "
        + ", ".join(
            f"{key}={value}" for key, value in sorted(geography_type_counts.items())
        )
        + "."
    )

    if args.dry_run:
        print("Dry run complete; database was not modified.")
        return 0

    state = get_state(args.db_url)
    summary = merge_projects(
        state,
        projects,
        geo_projects,
        canonical_geo,
        args.xlsx.name,
    )
    put_state(args.db_url, state)

    print(
        "Imported {total_projects} projects: {created} created, {updated} updated; "
        "{geography_rows} geography rows; workspace revision {revision}.".format(
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
