// XLSX, XLS (BIFF), SpreadsheetML and HTML-table reading via the vendored
// SheetJS build. Cells keep raw value, display text and number format; nothing
// Swedish is interpreted here.
import * as XLSX from "xlsx";
import type { CellRange, RawCell, RawSheet } from "@/lib/contracts";
import { EMPTY_CELL } from "../cells";
import { hasDateTokens } from "../formats";

export interface SheetJsResult {
  sheets: RawSheet[];
  date1904: boolean;
}

const BASE_OPTS = {
  cellDates: false,
  cellNF: true,
  cellText: true,
  dense: true,
} as const;

/** Milliseconds between the 1900-system epoch (1899-12-30) and the Unix epoch. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt || fmt === "General") return false;
  try {
    return Boolean(XLSX.SSF.is_date(fmt)) && hasDateTokens(fmt);
  } catch {
    return false;
  }
}

function errorText(cell: XLSX.CellObject): string {
  if (cell.w) return cell.w;
  return typeof cell.v === "string" ? cell.v : "#FEL";
}

export function toRawCell(cell: XLSX.CellObject | null | undefined, date1904: boolean): RawCell {
  if (!cell) return EMPTY_CELL;
  const fmt = typeof cell.z === "string" && cell.z !== "General" ? cell.z : undefined;
  const w = typeof cell.w === "string" ? cell.w : undefined;
  const withMeta = (base: RawCell): RawCell => {
    const out: RawCell = { ...base };
    if (w !== undefined) out.w = w;
    if (fmt !== undefined) out.f = fmt;
    return out;
  };
  switch (cell.t) {
    case "z":
      return EMPTY_CELL;
    case "e":
      return withMeta({ v: errorText(cell), t: "e" });
    case "b":
      return withMeta({ v: Boolean(cell.v), t: "b" });
    case "n": {
      const v = typeof cell.v === "number" ? cell.v : Number(cell.v);
      if (!Number.isFinite(v)) return withMeta({ v: w ?? "#FEL", t: "e" });
      return withMeta({ v, t: isDateFormat(fmt) ? "d" : "n" });
    }
    case "d": {
      // Only produced when a reader returns Date objects; convert back to a serial.
      const date = cell.v instanceof Date ? cell.v : new Date(String(cell.v));
      if (Number.isNaN(date.getTime())) return withMeta({ v: w ?? "#FEL", t: "e" });
      const serial = (date.getTime() - EXCEL_EPOCH_MS) / 86_400_000 - (date1904 ? 1462 : 0);
      return withMeta({ v: serial, t: "d" });
    }
    case "s":
    default: {
      const v = cell.v === undefined || cell.v === null ? "" : String(cell.v);
      if (v === "") return EMPTY_CELL;
      return withMeta({ v, t: "s" });
    }
  }
}

function sheetRows(ws: XLSX.WorkSheet, date1904: boolean): RawCell[][] {
  const data = (ws["!data"] ?? []) as (XLSX.CellObject[] | undefined)[];
  const rows: RawCell[][] = [];
  for (let r = 0; r < data.length; r++) {
    const src = data[r];
    if (!src) {
      rows.push([]);
      continue;
    }
    const row: RawCell[] = new Array<RawCell>(src.length);
    for (let c = 0; c < src.length; c++) row[c] = toRawCell(src[c], date1904);
    while (row.length > 0 && row[row.length - 1]!.t === "z") row.pop();
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();
  return rows;
}

function sheetMerges(ws: XLSX.WorkSheet): CellRange[] {
  const merges = (ws["!merges"] ?? []) as XLSX.Range[];
  return merges.map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }));
}

function toResult(wb: XLSX.WorkBook): SheetJsResult {
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const meta = wb.Workbook?.Sheets ?? [];
  const sheets = wb.SheetNames.map((name, i): RawSheet => {
    const ws = wb.Sheets[name];
    const info = meta.find((s) => s.name === name) ?? meta[i];
    return {
      name,
      hidden: info?.Hidden === 1 || info?.Hidden === 2,
      rows: ws ? sheetRows(ws, date1904) : [],
      merges: ws ? sheetMerges(ws) : [],
    };
  });
  return { sheets, date1904 };
}

/** Binary workbooks (XLSX zip, XLS BIFF/CFB). Throws on unreadable files. */
export function readBinaryWorkbook(bytes: Uint8Array): SheetJsResult {
  return toResult(XLSX.read(bytes, { ...BASE_OPTS, type: "array" }));
}

/**
 * HTML tables saved as ".xls". raw:true keeps every cell as the text shown:
 * SheetJS would otherwise read "8,5" as 85 and guess US dates.
 */
export function readHtmlWorkbook(html: string): SheetJsResult {
  return toResult(XLSX.read(html, { ...BASE_OPTS, type: "string", raw: true }));
}

/** Excel 2003 SpreadsheetML: typed cells, so no raw mode. */
export function readXmlWorkbook(xml: string): SheetJsResult {
  return toResult(XLSX.read(xml, { ...BASE_OPTS, type: "string" }));
}
