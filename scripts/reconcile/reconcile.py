#!/usr/bin/env python3
"""Clean-room reconciliation of MB Stats imports against the raw source files.

Avstämning: räknar om totaler direkt ur originalfilen (xlsx, csv, html-"xls") med en egen,
liten JSON-konfiguration per filtyp och jämför dem med appens fakta (JSON-export, samma form
som fixtures/truth). Delar ingen kod med appen: inga importer från src/lib.

Usage:
  reconcile.py --config configs/intelliplan_timmar.json --file timmar.xlsx --app app.json
               [--tolerance 0.01] [--dim kund] [--company MBAB] [--month 2026-09]
               [--from-month 2025-01] [--to-month 2026-09] [--all]
  reconcile.py --selftest

Exit codes: 0 = no differences, 1 = differences, 2 = error (unreadable file, bad config).
"""

from __future__ import annotations

import argparse
import calendar
import copy
import csv
import io
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONFIG_DIR = HERE / "configs"
FIXTURE_FILES = ROOT / "fixtures" / "files"
FIXTURE_TRUTH = ROOT / "fixtures" / "truth"

MISSING = "(saknas)"
COMPANIES = ("MBAB", "MBR")
FALSY = {"", "nej", "no", "n", "0", "false", "falskt", "-", "–", "ej", "ingen", "inget"}
AVG_DAYS_PER_MONTH = 365.25 / 12

# Fixture -> config used by --selftest. Every file in fixtures/files must be listed.
SELFTEST_CASES: list[tuple[str, str]] = [
    ("budget_2026.xlsx", "budget.json"),
    ("fortnox_kundforsaljning_MBAB_2026.xlsx", "fortnox_kundforsaljning.json"),
    ("intelliplan_fakturering_MBAB_2026-09.xlsx", "intelliplan_fakturering.json"),
    ("intelliplan_franvaro_MBAB_2026-09.csv", "intelliplan_franvaro.json"),
    ("intelliplan_konsulter_MBAB.xlsx", "intelliplan_konsulter.json"),
    ("intelliplan_kundlista.xls", "intelliplan_kundlista.json"),
    ("intelliplan_timmar_MBAB_2026-08.xlsx", "intelliplan_timmar.json"),
    ("intelliplan_timmar_MBAB_2026-09.xlsx", "intelliplan_timmar.json"),
    ("intelliplan_timmar_MBAB_2026-09_andrad.xlsx", "intelliplan_timmar.json"),
    ("intelliplan_timmar_MBAB_2026-09_utf16.csv", "intelliplan_timmar.json"),
    ("workbuster_deltagare_MBAB.xlsx", "workbuster_deltagare.json"),
    ("workbuster_deltagare_MBR.xlsx", "workbuster_deltagare.json"),
    ("workbuster_ordrar_MBAB.xlsx", "workbuster_ordrar.json"),
]


class ReconcileError(Exception):
    """A problem with the file, the config or the app export (exit code 2)."""


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return isinstance(value, str) and value.strip() == ""


def label(value: Any) -> str:
    """Display text of a cell: whitespace collapsed, integral numbers without decimals."""
    if is_blank(value):
        return ""
    if isinstance(value, bool):
        return "Ja" if value else "Nej"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = unicodedata.normalize("NFC", str(value))
    return re.sub(r"\s+", " ", text).strip()


def norm(value: Any) -> str:
    """Comparison key: like label() but lowercased."""
    return label(value).lower()


# ---------------------------------------------------------------------------
# Reading files into plain grids
# ---------------------------------------------------------------------------


@dataclass
class Sheet:
    name: str
    rows: list[list[Any]]


def read_workbook(path: Path) -> list[Sheet]:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ReconcileError(f"Kan inte läsa filen / cannot read file {path}: {exc.strerror or exc}") from exc
    if data.startswith(b"PK\x03\x04"):
        return read_xlsx(path)
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return read_xls_biff(path)
    text = decode_text(data)
    if re.match(r"\s*<(!doctype|html|table|\?xml)", text, re.IGNORECASE):
        return [read_html(text)]
    return [read_csv(text)]


def read_xlsx(path: Path) -> list[Sheet]:
    frames = pd.read_excel(path, sheet_name=None, header=None, dtype=object, engine="openpyxl")
    return [Sheet(str(name), frame_rows(frame)) for name, frame in frames.items()]


def read_xls_biff(path: Path) -> list[Sheet]:
    try:
        frames = pd.read_excel(path, sheet_name=None, header=None, dtype=object, engine="xlrd")
    except ImportError as exc:  # xlrd is optional
        raise ReconcileError(
            "Äldre .xls (BIFF) kräver paketet xlrd / legacy .xls needs xlrd: pip install xlrd"
        ) from exc
    return [Sheet(str(name), frame_rows(frame)) for name, frame in frames.items()]


def frame_rows(frame: pd.DataFrame) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for row in frame.itertuples(index=False):
        out: list[Any] = []
        for v in row:
            if isinstance(v, pd.Timestamp):
                v = v.to_pydatetime()
            out.append(None if is_blank(v) else v)
        rows.append(out)
    return rows


def decode_text(data: bytes) -> str:
    if data.startswith(b"\xff\xfe"):
        return data[2:].decode("utf-16-le")
    if data.startswith(b"\xfe\xff"):
        return data[2:].decode("utf-16-be")
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252")


def sniff_delimiter(lines: list[str]) -> str:
    """The delimiter that splits the most lines into the same number of fields.

    Title lines above the header have no delimiter and are ignored; a comma inside quoted
    names ("Efternamn, Förnamn") appears on fewer lines than the real delimiter.
    """
    best: tuple[tuple[int, int, int], str] | None = None
    for rank, candidate in enumerate([";", "\t", ","]):
        counts = [n for n in (line.count(candidate) for line in lines) if n > 0]
        if not counts:
            continue
        fields, lines_with = Counter(counts).most_common(1)[0]
        score = (lines_with, fields, -rank)
        if best is None or score > best[0]:
            best = (score, candidate)
    return best[1] if best else ";"


def read_csv(text: str) -> Sheet:
    lines = [line for line in text.splitlines() if line.strip()]
    hint = re.fullmatch(r"\s*sep=(.)\s*", lines[0], re.IGNORECASE) if lines else None
    if hint:  # Excel's "sep=;" first line names the delimiter and is not data
        delimiter = hint.group(1)
        text = re.sub(r"^\s*sep=.[ \t]*(\r?\n|$)", "", text, count=1, flags=re.IGNORECASE)
    else:
        delimiter = sniff_delimiter(lines[:50])
    rows = [
        [cell if cell.strip() else None for cell in row]
        for row in csv.reader(io.StringIO(text), delimiter=delimiter)
    ]
    return Sheet("csv", rows)


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[Any]] = []
        self._row: list[Any] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            text = label("".join(self._cell))
            self._row.append(text or None)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def read_html(text: str) -> Sheet:
    parser = _TableParser()
    parser.feed(text)
    return Sheet("html", parser.rows)


# ---------------------------------------------------------------------------
# Swedish numbers and dates
# ---------------------------------------------------------------------------


def parse_number(value: Any) -> float | None:
    if is_blank(value):
        return None
    if isinstance(value, bool):
        raise ReconcileError(f"Sanningsvärde där tal väntades / boolean where number expected: {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    for space in (" ", " ", " ", " "):
        text = text.replace(space, " ")
    text = text.replace("−", "-")
    text = re.sub(r"(?i)\s*(kr|sek|tim|h|st|%)\.?$", "", text).strip()
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    text = text.replace(" ", "")
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    if not re.fullmatch(r"[-+]?\d+(\.\d+)?", text):
        raise ReconcileError(f"Kan inte tolka talet / cannot parse number: {value!r}")
    number = float(text)
    return -number if negative else number


def parse_date(value: Any) -> date | None:
    if is_blank(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 1 < value < 2958466:
            return date(1899, 12, 30) + timedelta(days=int(value))
        raise ReconcileError(f"Inget datum / not a date: {value!r}")
    text = label(value)
    patterns = [
        (r"(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?", (1, 2, 3)),
        (r"(\d{1,2})/(\d{1,2})[ -](\d{4})", (3, 2, 1)),
        (r"(\d{1,2})\.(\d{1,2})\.(\d{4})", (3, 2, 1)),
        (r"(\d{4})(\d{2})(\d{2})", (1, 2, 3)),
    ]
    for pattern, (yi, mi, di) in patterns:
        m = re.fullmatch(pattern, text)
        if m:
            try:
                return date(int(m.group(yi)), int(m.group(mi)), int(m.group(di)))
            except ValueError as exc:
                raise ReconcileError(f"Ogiltigt datum / invalid date: {value!r}") from exc
    raise ReconcileError(f"Kan inte tolka datumet / cannot parse date: {value!r}")


def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_end(month: str) -> date:
    year, mon = int(month[:4]), int(month[5:7])
    return date(year, mon, calendar.monthrange(year, mon)[1])


def add_months(month: str, n: int) -> str:
    index = int(month[:4]) * 12 + int(month[5:7]) - 1 + n
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def month_range(first: str, last: str) -> list[str]:
    out: list[str] = []
    current = first
    while current <= last:
        out.append(current)
        current = add_months(current, 1)
    return out


# ---------------------------------------------------------------------------
# Locating the table and extracting records
# ---------------------------------------------------------------------------


@dataclass
class Table:
    sheet: Sheet
    header_index: int
    columns: dict[str, int | None]
    meta: str


@dataclass
class ExtractInfo:
    sheet: str = ""
    header_row: int = 0
    data_rows: int = 0
    used_rows: int = 0
    skipped_empty: int = 0
    skipped_rules: Counter = field(default_factory=Counter)
    excluded: Counter = field(default_factory=Counter)
    duplicates: int = 0
    warnings: list[str] = field(default_factory=list)


def find_table(sheet: Sheet, cfg: dict[str, Any]) -> Table:
    required = [norm(h) for h in cfg["header"]]
    for i, row in enumerate(sheet.rows):
        cells = {norm(c) for c in row}
        if all(r in cells for r in required):
            header = [norm(c) for c in row]
            columns: dict[str, int | None] = {}
            optional = set(cfg.get("optional_columns", []))
            for logical, candidates in cfg.get("columns", {}).items():
                idx = next((header.index(norm(c)) for c in candidates if norm(c) in header), None)
                if idx is None and logical not in optional:
                    raise ReconcileError(
                        f"Kolumnen saknas / column missing: {logical} (sökte / looked for {candidates})"
                    )
                columns[logical] = idx
            meta = "\n".join(" ".join(label(c) for c in r if not is_blank(c)) for r in sheet.rows[:i])
            return Table(sheet, i, columns, meta)
    raise ReconcileError(f"Hittar ingen rubrikrad med / no header row containing {required} in {sheet.name}")


def rule_matches(rule: dict[str, Any], record: dict[str, Any]) -> bool:
    value = record.get(rule["column"])
    text = norm(value)
    if "equals" in rule:
        return text == norm(rule["equals"])
    if "in" in rule:
        return text in {norm(v) for v in rule["in"]}
    if "regex" in rule:
        return re.search(rule["regex"], text) is not None
    if rule.get("empty"):
        return text == ""
    raise ReconcileError(f"Okänd regel / unknown rule: {rule}")


def extract_records(table: Table, cfg: dict[str, Any], info: ExtractInfo) -> list[dict[str, Any]]:
    info.sheet = table.sheet.name
    info.header_row = table.header_index + 1
    records: list[dict[str, Any]] = []
    last: dict[str, Any] = {}
    for row in table.sheet.rows[table.header_index + 1 :]:
        if all(is_blank(c) for c in row):
            info.skipped_empty += 1
            continue
        record = {
            k: (row[i] if i is not None and i < len(row) else None) for k, i in table.columns.items()
        }
        skip = next((r for r in cfg.get("skip", []) if rule_matches(r, record)), None)
        if skip is not None:
            info.skipped_rules[skip.get("label", skip.get("regex", "skip"))] += 1
            continue
        info.data_rows += 1
        for column in cfg.get("fill_down", []):
            if is_blank(record.get(column)):
                record[column] = last.get(column)
            else:
                last[column] = record[column]
        excluded = next((r for r in cfg.get("exclude", []) if rule_matches(r, record)), None)
        if excluded is not None:
            info.excluded[excluded.get("label", excluded["column"])] += 1
            continue
        records.append(record)
    info.used_rows = len(records)
    return records


# ---------------------------------------------------------------------------
# Company, period and dimensions
# ---------------------------------------------------------------------------


@dataclass
class Context:
    path: Path
    company: str | None = None
    month: str | None = None
    from_month: str | None = None
    to_month: str | None = None


def resolve_company(cfg: dict[str, Any], ctx: Context, sheet_company: str | None = None) -> str:
    # A sheet mapped to a company in the config (budget: one sheet per company) wins over
    # --company, which is meant for single-company files whose name does not say it.
    if sheet_company:
        return sheet_company
    if ctx.company:
        return ctx.company
    spec = cfg.get("company", {})
    if "fixed" in spec:
        return spec["fixed"]
    if "filename_regex" in spec:
        m = re.search(spec["filename_regex"], ctx.path.name)
        if m and m.group(1) in COMPANIES:
            return m.group(1)
    raise ReconcileError("Kan inte avgöra bolag / cannot determine company: use --company")


def regex_month(spec: dict[str, Any], text: str) -> str | None:
    m = re.search(spec["meta_regex"] if "meta_regex" in spec else spec["filename_regex"], text, re.I)
    if not m:
        return None
    found = m.group(1)
    month = month_of(parse_date(found)) if len(found) > 7 else found
    return add_months(month, int(spec.get("offset_months", 0)))


def fixed_period(cfg: dict[str, Any], ctx: Context, table: Table) -> str | None:
    """Month for files without a date column (per-upload period)."""
    if ctx.month:
        return ctx.month
    spec = cfg.get("period", {})
    if "fixed" in spec:
        return spec["fixed"]
    if "meta_regex" in spec:
        return regex_month(spec, table.meta)
    if "filename_regex" in spec:
        return regex_month(spec, ctx.path.name)
    return None


def dim_value(spec: Any, record: dict[str, Any], aliases: dict[str, str]) -> str:
    if isinstance(spec, dict) and "const" in spec:
        text = spec["const"]
    else:
        column = spec["column"] if isinstance(spec, dict) else spec
        text = label(record.get(column))
        if isinstance(spec, dict) and "regex" in spec and text:
            m = re.search(spec["regex"], text)
            text = label(m.group(1)) if m else text
    if not text:
        return MISSING
    return aliases.get(norm(text), text)


def record_dims(cfg: dict[str, Any], record: dict[str, Any]) -> dict[str, str]:
    aliases = cfg.get("aliases", {})
    return {
        dim: dim_value(spec, record, {norm(k): v for k, v in aliases.get(dim, {}).items()})
        for dim, spec in cfg.get("dims", {}).items()
    }


# ---------------------------------------------------------------------------
# Recompute facts per kind
# ---------------------------------------------------------------------------

Fact = dict[str, Any]


def facts_from_rows(rows: list[dict[str, Any]]) -> list[Fact]:
    if not rows:
        return []
    frame = pd.DataFrame(rows)
    grouped = frame.groupby(["metricKey", "company", "month", "dims"], as_index=False)["value"].sum()
    return [
        {
            "metricKey": r.metricKey,
            "company": r.company,
            "month": r.month,
            "dims": json.loads(r.dims),
            "value": float(r.value),
        }
        for r in grouped.itertuples(index=False)
    ]


def dims_key(dims: dict[str, str]) -> str:
    return json.dumps(dims, sort_keys=True, ensure_ascii=False)


def pick_sheet(sheets: list[Sheet], cfg: dict[str, Any]) -> Sheet:
    wanted = cfg.get("sheet")
    if wanted is None:
        return sheets[0]
    for sheet in sheets:
        if norm(sheet.name) == norm(wanted):
            return sheet
    raise ReconcileError(f"Bladet saknas / sheet missing: {wanted}")


def recompute_table(cfg: dict[str, Any], sheets: list[Sheet], ctx: Context, info: ExtractInfo) -> list[Fact]:
    table = find_table(pick_sheet(sheets, cfg), cfg)
    records = extract_records(table, cfg, info)
    company = resolve_company(cfg, ctx)
    period_column = cfg.get("period", {}).get("column")
    fixed = None if period_column else fixed_period(cfg, ctx, table)
    if not period_column and not fixed:
        raise ReconcileError("Ingen period / no period: use --month")
    rows: list[dict[str, Any]] = []
    for record in records:
        if period_column:
            d = parse_date(record.get(period_column))
            if d is None:
                raise ReconcileError(f"Datum saknas / date missing in row: {record}")
            month = month_of(d)
        else:
            month = fixed
        dims = dims_key(record_dims(cfg, record))
        for metric in cfg["metrics"]:
            if metric.get("count_rows"):
                value = 1.0
            else:
                value = parse_number(record.get(metric["sum"]))
                if value is None:
                    continue
            rows.append({"metricKey": metric["key"], "company": company, "month": month, "dims": dims, "value": value})
    return facts_from_rows(rows)


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not is_blank(value):
        return value != 0
    return norm(value) not in FALSY


def case_month_bounds(cases_cfg: dict[str, Any], ctx: Context, table: Table, starts: list[date]) -> tuple[str, str]:
    first: Any = ctx.from_month or cases_cfg.get("from_month", "earliest_start")
    if first == "earliest_start":
        first = month_of(min(starts))
    last: Any = ctx.to_month or cases_cfg.get("to_month")
    if isinstance(last, dict):
        last = regex_month(last, table.meta)
    if not last:
        raise ReconcileError("Sista månad saknas / last month unknown: use --to-month")
    return first, last


def recompute_cases(cfg: dict[str, Any], sheets: list[Sheet], ctx: Context, info: ExtractInfo) -> list[Fact]:
    table = find_table(pick_sheet(sheets, cfg), cfg)
    records = extract_records(table, cfg, info)
    company = resolve_company(cfg, ctx)
    cc = cfg["cases"]
    result_map = {norm(k): v for k, v in cc.get("result_map", {}).items()}
    cases: list[dict[str, Any]] = []
    seen: set[tuple[str, str, date]] = set()
    for record in records:
        start = parse_date(record.get(cc["start"]))
        if start is None:
            raise ReconcileError(f"Startdatum saknas / start date missing: {record}")
        end = parse_date(record.get(cc["end"])) if cc.get("end") else None
        interrupted = truthy(record.get(cc["interrupt"])) if cc.get("interrupt") else False
        if interrupted and end is None:
            info.warnings.append("Avbrott utan slutdatum räknas som pågående / interruption without end date")
            interrupted = False
        raw_result = norm(record.get(cc["result"])) if cc.get("result") else ""
        result = result_map.get(raw_result) if raw_result else None
        result_date = parse_date(record.get(cc["result_date"])) if cc.get("result_date") else None
        key = (company, norm(record.get(cc["key"])), start) if cc.get("key") else None
        if key is not None and key[1]:
            if key in seen:
                info.duplicates += 1
                continue
            seen.add(key)
        cases.append(
            {
                "dims": dims_key(record_dims(cfg, record)),
                "start": start,
                "end": end,
                "interrupted": interrupted,
                "result": result,
                "result_date": result_date or end,
            }
        )
    if not cases:
        return []
    first, last = case_month_bounds(cc, ctx, table, [c["start"] for c in cases])
    metrics = cc["metrics"]
    rows: list[dict[str, Any]] = []
    for month in month_range(first, last):
        me = month_end(month)
        tenure: dict[str, list[float]] = defaultdict(list)
        for c in cases:
            dims = c["dims"]
            gone = c["end"] is not None and (c["end"] < me or (c["interrupted"] and c["end"] <= me))
            active = c["start"] <= me and not gone

            def emit(metric: str | None, value: float, d: str = dims) -> None:
                if metric:
                    rows.append({"metricKey": metric, "company": company, "month": month, "dims": d, "value": value})

            if active:
                emit(metrics.get("active"), 1.0)
                if metrics.get("tenure"):
                    tenure[dims].append((me - c["start"]).days / AVG_DAYS_PER_MONTH)
            if month_of(c["start"]) == month:
                emit(metrics.get("started"), 1.0)
            if c["end"] is not None and month_of(c["end"]) == month:
                emit(metrics.get("ended"), 1.0)
                if c["interrupted"]:
                    emit(metrics.get("interrupted"), 1.0)
            if c["result"] and c["result_date"] is not None and month_of(c["result_date"]) == month:
                with_result = json.loads(dims)
                with_result["resultattyp"] = c["result"]
                emit(metrics.get("results"), 1.0, dims_key(with_result))
        for dims, values in tenure.items():
            rows.append(
                {
                    "metricKey": metrics["tenure"],
                    "company": company,
                    "month": month,
                    "dims": dims,
                    "value": sum(values) / len(values),
                }
            )
    return facts_from_rows(rows)


def recompute_wide(cfg: dict[str, Any], sheets: list[Sheet], ctx: Context, info: ExtractInfo) -> list[Fact]:
    wide = cfg["wide"]
    year_spec = wide["year"]
    if isinstance(year_spec, dict):
        m = re.search(year_spec["filename_regex"], ctx.path.name)
        if not m:
            raise ReconcileError("Kan inte läsa år ur filnamnet / cannot read year from file name")
        year = int(m.group(1))
    else:
        year = int(year_spec)
    row_map = {norm(k): v for k, v in wide["rows"].items()}
    ignore = {norm(r) for r in wide.get("ignore_rows", [])}
    rows: list[dict[str, Any]] = []
    by_name = {norm(s.name): s for s in sheets}
    for sheet_name, sheet_company in cfg["sheets"].items():
        sheet = by_name.get(norm(sheet_name))
        if sheet is None:
            raise ReconcileError(f"Bladet saknas / sheet missing: {sheet_name}")
        table = find_table(sheet, cfg)
        info.sheet = ", ".join(filter(None, [info.sheet, sheet.name]))
        info.header_row = table.header_index + 1
        header = [norm(c) for c in sheet.rows[table.header_index]]
        label_index = next(header.index(norm(c)) for c in wide["label_column"] if norm(c) in header)
        month_columns = {i + 1: header.index(norm(m)) for i, m in enumerate(wide["months"])}
        company = resolve_company(cfg, ctx, sheet_company)
        for row in sheet.rows[table.header_index + 1 :]:
            if all(is_blank(c) for c in row):
                info.skipped_empty += 1
                continue
            name = norm(row[label_index] if label_index < len(row) else None)
            if name in ignore:
                info.skipped_rules[name] += 1
                continue
            if name not in row_map:
                raise ReconcileError(f"Okänd budgetrad / unknown budget row: {name!r} ({sheet_name})")
            info.data_rows += 1
            dims = dims_key({wide["dim"]: row_map[name]})
            for month_no, column in month_columns.items():
                value = parse_number(row[column] if column < len(row) else None)
                if value is None:
                    continue
                rows.append(
                    {
                        "metricKey": wide["metric"],
                        "company": company,
                        "month": f"{year:04d}-{month_no:02d}",
                        "dims": dims,
                        "value": -value if wide.get("negate") else value,
                    }
                )
    info.used_rows = info.data_rows
    return facts_from_rows(rows)


def recompute_reference(cfg: dict[str, Any], sheets: list[Sheet], ctx: Context, info: ExtractInfo) -> list[Fact]:
    table = find_table(pick_sheet(sheets, cfg), cfg)
    records = extract_records(table, cfg, info)
    if len(records) < int(cfg.get("expect_min_rows", 1)):
        raise ReconcileError(f"För få rader / too few rows: {len(records)}")
    return []


RECOMPUTE = {
    "table": recompute_table,
    "cases": recompute_cases,
    "wide": recompute_wide,
    "reference": recompute_reference,
}


def recompute(cfg: dict[str, Any], ctx: Context) -> tuple[list[Fact], ExtractInfo]:
    info = ExtractInfo()
    kind = cfg.get("kind")
    if kind not in RECOMPUTE:
        raise ReconcileError(f"Okänd konfigurationstyp / unknown config kind: {kind}")
    sheets = read_workbook(ctx.path)
    return RECOMPUTE[kind](cfg, sheets, ctx, info), info


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


@dataclass
class Diff:
    metric: str
    company: str
    month: str
    group: str
    file_value: float | None
    app_value: float | None

    @property
    def delta(self) -> float:
        return (self.file_value or 0.0) - (self.app_value or 0.0)


def load_facts(path: Path) -> list[Fact]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReconcileError(f"Kan inte läsa / cannot read {path}: {exc}") from exc
    if isinstance(data, dict) and isinstance(data.get("facts"), list):
        data = data["facts"]  # an IngestResult export works as-is
    if not isinstance(data, list):
        raise ReconcileError(f"{path}: väntade en lista med fakta / expected a list of facts")
    for f in data:
        missing = {"metricKey", "company", "month", "dims", "value"} - set(f)
        if missing:
            raise ReconcileError(f"{path}: fakta saknar / fact missing {sorted(missing)}: {f}")
    return data


def canonical_dims(fact: Fact, cfg: dict[str, Any]) -> dict[str, str]:
    aliases = cfg.get("compare_aliases", {})
    out: dict[str, str] = {}
    for dim, value in fact["dims"].items():
        text = label(value) or MISSING
        table = {norm(k): v for k, v in aliases.get(dim, {}).items()}
        out[dim] = table.get(norm(text), text)
    return out


Key = tuple[str, str, str, str]


def aggregate(facts: list[Fact], level: str | None, cfg: dict[str, Any], display: dict[str, str]) -> dict[Key, float]:
    """Sum facts to metric x company x month (x one dimension, or x all dimensions).

    Groups match case-insensitively; `display` collects a readable label per group key.
    """
    rollups = cfg.get("rollups", {})
    canon = [(f, canonical_dims(f, cfg)) for f in facts]
    index = {(f["metricKey"], f["company"], f["month"], dims_key(d)): float(f["value"]) for f, d in canon}
    sums: dict[Key, float] = defaultdict(float)
    weights: dict[Key, float] = defaultdict(float)
    for f, dims in canon:
        if level is None:
            group, shown = "", ""
        elif level == "all":
            group = dims_key({k: norm(v) for k, v in dims.items()})
            shown = ", ".join(f"{k}={v}" for k, v in sorted(dims.items()))
        else:
            shown = dims.get(level, MISSING)
            group = norm(shown)
        display.setdefault(group, shown)
        key = (f["metricKey"], f["company"], f["month"], group)
        rollup = rollups.get(f["metricKey"])
        if rollup:
            w = index.get((rollup["weighted_by"], f["company"], f["month"], dims_key(dims)), 0.0)
            sums[key] += float(f["value"]) * w
            weights[key] += w
        else:
            sums[key] += float(f["value"])
    return {k: (v / weights[k] if weights[k] else 0.0) if k in weights else v for k, v in sums.items()}


def compare(
    file_facts: list[Fact],
    app_facts: list[Fact],
    cfg: dict[str, Any],
    level: str | None,
    tolerance: float,
    window: tuple[str | None, str | None] = (None, None),
) -> tuple[list[Diff], int, int]:
    """Returns (differences, compared keys, ignored facts outside the month window)."""
    lo, hi = window

    def inside(f: Fact) -> bool:
        return (lo is None or f["month"] >= lo) and (hi is None or f["month"] <= hi)

    ignored = sum(1 for f in file_facts + app_facts if not inside(f))
    display: dict[str, str] = {}
    a = aggregate([f for f in file_facts if inside(f)], level, cfg, display)
    b = aggregate([f for f in app_facts if inside(f)], level, cfg, display)
    diffs: list[Diff] = []
    keys = sorted(set(a) | set(b))
    for key in keys:
        fv, av = a.get(key), b.get(key)
        if abs((fv or 0.0) - (av or 0.0)) > tolerance:
            diffs.append(Diff(key[0], key[1], key[2], display.get(key[3], key[3]), fv, av))
    return diffs, len(keys), ignored


def fmt(value: float | None) -> str:
    if value is None:
        return "–"
    text = f"{value:,.2f}".replace(",", " ").replace(".", ",")
    return text[:-3] if text.endswith(",00") else text


def print_report(title: str, level: str | None, diffs: list[Diff], compared: int, ignored: int, show_all_rows: list[Diff] | None = None) -> None:
    level_text = "bolag × månad / company × month" + (f" × {level}" if level else "")
    print(f"\n{title}")
    print(f"Nivå / Level: {level_text}")
    rows = show_all_rows if show_all_rows is not None else diffs
    if rows:
        headers = ["Mått/Metric", "Bolag/Company", "Månad/Month", "Grupp/Group", "Fil/File", "App", "Diff"]
        table = [[d.metric, d.company, d.month, d.group or "–", fmt(d.file_value), fmt(d.app_value), fmt(d.delta)] for d in rows]
        widths = [max(len(str(r[i])) for r in [headers, *table]) for i in range(len(headers))]
        for r in [headers, ["-" * w for w in widths], *table]:
            print("  ".join(str(c).ljust(widths[i]) if i < 4 else str(c).rjust(widths[i]) for i, c in enumerate(r)))
    if ignored:
        print(f"Utanför jämförelsefönstret / outside the comparison window: {ignored} fakta / facts")
    if diffs:
        print(f"AVVIKELSER / DIFFERENCES: {len(diffs)} av / of {compared}")
    else:
        print(f"OK – inga avvikelser / no differences ({compared} jämförda / compared)")


def print_info(info: ExtractInfo) -> None:
    parts = [
        f"blad/sheet={info.sheet or '-'}",
        f"rubrikrad/header row={info.header_row}",
        f"datarader/data rows={info.data_rows}",
        f"använda/used={info.used_rows}",
    ]
    if info.skipped_empty:
        parts.append(f"tomma/empty={info.skipped_empty}")
    for name, n in sorted(info.skipped_rules.items()):
        parts.append(f"hoppade/skipped[{name}]={n}")
    for name, n in sorted(info.excluded.items()):
        parts.append(f"bortfiltrerade/filtered[{name}]={n}")
    if info.duplicates:
        parts.append(f"dubbletter/duplicates={info.duplicates}")
    print("Fil / File: " + ", ".join(parts))
    for w in sorted(set(info.warnings)):
        print(f"Varning / Warning: {w}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists() and (CONFIG_DIR / path.name).exists():
        path = CONFIG_DIR / path.name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReconcileError(f"Kan inte läsa konfigurationen / cannot read config {path}: {exc}") from exc


def run_cli(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config).expanduser())
    app_path = Path(args.app).expanduser()
    ctx = Context(
        path=Path(args.file).expanduser(),
        company=args.company,
        month=args.month,
        from_month=args.from_month,
        to_month=args.to_month,
    )
    file_facts, info = recompute(cfg, ctx)
    app_facts = load_facts(app_path)
    print(f"Avstämning / Reconciliation: {ctx.path.name} ({cfg.get('name', args.config)}) mot / vs {app_path.name}")
    print_info(info)
    window = (args.from_month, args.to_month)
    diffs, compared, ignored = compare(file_facts, app_facts, cfg, args.dim, args.tolerance, window)
    shown = None
    if args.all:
        everything, _, _ = compare(file_facts, app_facts, cfg, args.dim, -1.0, window)
        shown = everything
    print_report("Resultat / Result", args.dim, diffs, compared, ignored, shown)
    return 1 if diffs else 0


def selftest() -> int:
    failures: list[str] = []
    listed = {file for file, _ in SELFTEST_CASES}
    on_disk = {p.name for p in FIXTURE_FILES.iterdir() if p.is_file()}
    for name in sorted(on_disk - listed):
        failures.append(f"{name}: saknas i SELFTEST_CASES / not covered by the selftest")
    for name in sorted(listed - on_disk):
        failures.append(f"{name}: filen saknas / fixture missing")

    for file, config_name in SELFTEST_CASES:
        raw = FIXTURE_FILES / file
        truth_path = FIXTURE_TRUTH / f"{raw.stem}.json"
        if not raw.exists() or not truth_path.exists():
            continue
        cfg = load_config(CONFIG_DIR / config_name)
        try:
            file_facts, info = recompute(cfg, Context(path=raw))
            truth = load_facts(truth_path)
        except ReconcileError as exc:
            failures.append(f"{file}: {exc}")
            continue
        levels: list[str | None] = [None, *sorted({d for f in truth for d in f["dims"]}), "all"]
        problems = []
        for level in levels:
            diffs, compared, _ = compare(file_facts, truth, cfg, level, 1e-6)
            if diffs:
                problems.append(f"nivå/level {level or 'total'}: {len(diffs)} avvikelser/differences")
                print_report(f"{file} (nivå/level {level or 'total'})", level, diffs[:20], compared, 0)
        # The comparison must not be vacuous: deliberate errors in the truth must be caught.
        for name, mutated in mutations(truth):
            diffs, _, _ = compare(file_facts, mutated, cfg, "all", 0.01)
            if not diffs:
                problems.append(f"mutation '{name}' upptäcktes inte / was not detected")
        status = "OK " if not problems else "FEL"
        skipped = sum(info.skipped_rules.values())
        excluded = sum(info.excluded.values())
        print(
            f"{status} {file:46} {len(truth):5} fakta/facts  rader/rows {info.data_rows:4}"
            f"  hoppade/skipped {skipped:3}  filtrerade/filtered {excluded:3}  dubbletter/dupes {info.duplicates}"
        )
        failures.extend(f"{file}: {p}" for p in problems)

    if failures:
        print("\nSJÄLVTEST MISSLYCKADES / SELFTEST FAILED")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nSJÄLVTEST OK / SELFTEST PASSED ({len(SELFTEST_CASES)} filer/files)")
    return 0


def mutations(truth: list[Fact]) -> list[tuple[str, list[Fact]]]:
    nonzero = [i for i, f in enumerate(truth) if float(f["value"]) != 0]
    if not nonzero:
        return []
    i = nonzero[len(nonzero) // 2]
    bumped = copy.deepcopy(truth)
    bumped[i]["value"] = float(bumped[i]["value"]) + 1
    dropped = [f for j, f in enumerate(truth) if j != i]
    relabeled = copy.deepcopy(truth)
    if relabeled[i]["dims"]:
        dim = sorted(relabeled[i]["dims"])[0]
        relabeled[i]["dims"][dim] = "Okänd grupp (mutation)"
    else:
        relabeled[i]["month"] = add_months(relabeled[i]["month"], 1)
    return [("value+1", bumped), ("missing fact", dropped), ("wrong group", relabeled)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", help="JSON-konfiguration / config (scripts/reconcile/configs/*.json)")
    parser.add_argument("--file", help="Originalfilen / the raw source file")
    parser.add_argument("--app", help="Appens fakta som JSON / the app's facts as JSON")
    parser.add_argument("--tolerance", type=float, default=0.01)
    parser.add_argument("--dim", help="Jämför även per dimension / also break down by this dimension (or 'all')")
    parser.add_argument("--company", choices=COMPANIES, help="Bolag om filen inte visar det / company override")
    parser.add_argument("--month", help="Månad för filer utan datumkolumn / month for per-upload periods")
    parser.add_argument("--from-month", help="Första månad att jämföra / first month to compare")
    parser.add_argument("--to-month", help="Sista månad att jämföra / last month to compare")
    parser.add_argument("--all", action="store_true", help="Visa alla rader, inte bara avvikelser / show all rows")
    parser.add_argument("--selftest", action="store_true", help="Stäm av alla fixtures mot facit / reconcile all fixtures")
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            return selftest()
        if not (args.config and args.file and args.app):
            parser.error("--config, --file och --app krävs / are required (or --selftest)")
        return run_cli(args)
    except ReconcileError as exc:
        print(f"FEL / ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(f"FEL / ERROR: konfigurationen saknar / config is missing {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - exit 1 must only ever mean "differences found"
        print(f"FEL / ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
