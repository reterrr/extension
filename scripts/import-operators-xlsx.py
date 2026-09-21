#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REQUIRED_HEADERS = ["operator_id", "nazwa_operatora", "NIP", "strona_www"]


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
        text = "".join(t.text or "" for t in si.iter(f"{{{NS_MAIN}}}t"))
        out.append(text)
    return out


def first_sheet_path(zf: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    sheet = workbook.find(f".//{{{NS_MAIN}}}sheet")
    if sheet is None:
        raise ValueError("XLSX does not contain any worksheet.")
    rel_id = sheet.attrib.get(f"{{{NS_REL}}}id")
    if not rel_id:
        raise ValueError("Could not resolve the first worksheet relationship.")
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rels.findall(f"{{{NS_PKG_REL}}}Relationship"):
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib.get("Target", "")
            if target.startswith("/"):
                return target.lstrip("/")
            return "xl/" + target.lstrip("./")
    raise ValueError("Could not resolve the first worksheet path.")


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


def read_xlsx(path: Path) -> list[dict[str, str | None]]:
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        sheet_path = first_sheet_path(zf)
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

    if not rows:
        raise ValueError("XLSX first worksheet is empty.")
    headers = [str(v).strip() for v in rows[0]]
    missing = [header for header in REQUIRED_HEADERS if header not in headers]
    if missing:
        raise ValueError(
            "Missing required columns: " + ", ".join(missing) +
            f"; got: {headers}"
        )
    positions = {header: headers.index(header) for header in REQUIRED_HEADERS}

    records: list[dict[str, str | None]] = []
    for row_no, row in enumerate(rows[1:], start=2):
        row = row + [""] * (len(headers) - len(row))
        selected = [row[positions[header]].strip() for header in REQUIRED_HEADERS]
        if not any(selected):
            continue
        operator_id, name, nip, website = selected
        if not operator_id or not name or not nip:
            raise ValueError(f"Row {row_no}: operator_id, name and NIP are required.")
        if not re.fullmatch(r"\d{10}", nip):
            raise ValueError(f"Row {row_no}: NIP must contain exactly 10 digits: {nip!r}.")
        urls = [part.strip() for part in website.split(";") if part.strip()]
        for url in urls:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"Row {row_no}: invalid HTTP(S) URL: {url!r}.")
        records.append({
            "operator_id": operator_id,
            "name": name,
            "nip": nip,
            "website": website or None,
            "source_url": urls[0] if urls else None,
        })

    seen: set[str] = set()
    for record in records:
        operator_id = str(record["operator_id"])
        if operator_id in seen:
            raise ValueError(f"Duplicate operator_id: {operator_id}.")
        seen.add(operator_id)
    return records


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
            f"Cannot reach Burbot DB service at {base_url}. Start it with `npm run db`."
        ) from exc
    if state.get("version") != 1 or not isinstance(state.get("objects"), list):
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


def find_existing(objects: list[dict[str, Any]], record: dict[str, str | None]) -> dict[str, Any] | None:
    operator_id = record["operator_id"]
    for obj in objects:
        if obj.get("type") == "operator" and obj.get("id") == operator_id:
            return obj
    for obj in objects:
        if obj.get("type") == "operator" and obj.get("importKey") == operator_id:
            return obj
    exact = [
        obj for obj in objects
        if obj.get("type") == "operator"
        and (obj.get("values") or {}).get("nip") == record["nip"]
        and (obj.get("values") or {}).get("name") == record["name"]
    ]
    return exact[0] if len(exact) == 1 else None


def merge_operators(state: dict[str, Any], records: list[dict[str, str | None]], source_name: str) -> dict[str, int]:
    objects = state.setdefault("objects", [])
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    created = 0
    updated = 0
    matched_existing_id = 0

    for record in records:
        existing = find_existing(objects, record)
        if existing is None:
            existing = {
                "id": record["operator_id"],
                "type": "operator",
                "label": record["name"],
                "values": {},
                "createdAt": now,
                "creationNote": f"Imported from {source_name}",
            }
            objects.append(existing)
            created += 1
        else:
            updated += 1
            if existing.get("id") != record["operator_id"]:
                matched_existing_id += 1

        values = existing.setdefault("values", {})
        values["name"] = record["name"]
        values["nip"] = record["nip"]
        if record["website"]:
            values["website"] = record["website"]
        else:
            values.pop("website", None)
        values["last_checked_at"] = now

        existing["type"] = "operator"
        existing["label"] = record["name"]
        existing["importKey"] = record["operator_id"]
        existing["updatedAt"] = now
        if record["source_url"]:
            existing["sourceUrl"] = record["source_url"]
        else:
            existing.pop("sourceUrl", None)

    state["revision"] = int(state.get("revision", 0)) + 1
    return {
        "created": created,
        "updated": updated,
        "matched_existing_id": matched_existing_id,
        "total": len(records),
        "revision": state["revision"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Import BUR operators from XLSX into Burbot SQLite via the local DB service.")
    parser.add_argument("xlsx", type=Path, help="Path to operatorzy.xlsx")
    parser.add_argument("--db-url", default=os.environ.get("BURBOT_DB_URL", "http://127.0.0.1:8765"))
    parser.add_argument("--dry-run", action="store_true", help="Validate XLSX only; do not contact or modify the DB service.")
    args = parser.parse_args()

    if not args.xlsx.is_file():
        raise SystemExit(f"File does not exist: {args.xlsx}")

    records = read_xlsx(args.xlsx)
    by_nip: dict[str, list[str]] = {}
    for record in records:
        by_nip.setdefault(str(record["nip"]), []).append(str(record["operator_id"]))
    duplicate_nips = {nip: ids for nip, ids in by_nip.items() if len(ids) > 1}

    print(f"Validated {len(records)} operators from {args.xlsx.name}.")
    print(f"Operators with no website: {sum(not r['website'] for r in records)}.")
    print(f"Duplicate NIP groups kept as separate operators: {len(duplicate_nips)}.")
    for nip, ids in duplicate_nips.items():
        print(f"  NIP {nip}: {', '.join(ids)}")

    if args.dry_run:
        print("Dry run complete; database was not modified.")
        return 0

    state = get_state(args.db_url)
    summary = merge_operators(state, records, args.xlsx.name)
    put_state(args.db_url, state)
    print(
        "Imported {total} operators: {created} created, {updated} updated; "
        "workspace revision {revision}.".format(**summary)
    )
    if summary["matched_existing_id"]:
        print(
            f"Matched {summary['matched_existing_id']} existing operator objects by import key/name+NIP and preserved their internal IDs."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
