// The working table: what mapping steps operate on. Columns are named by the
// normalized source header (de-duplicated); cells are plain JS values.
import type { DetectedTable, RawCell } from "@/lib/contracts";
import { parseDateSv } from "@/lib/core/dates-sv";
import { columnLetter } from "./cells";
import { isPercentFormat, isTimeOnlyFormat } from "./formats";

export type CellValue = string | number | boolean | null;

export interface WorkingRow {
  /** 1-based source row (several rows can share one after unpivot). */
  sourceRow: number;
  values: Record<string, CellValue>;
}

export interface WorkingTable {
  columns: string[];
  rows: WorkingRow[];
  /** Display text per column (the original header with its case), where known. */
  headers?: Record<string, string>;
}

/** Names that would collide with Object.prototype when used as record keys. */
const RESERVED_NAMES = ["__proto__"];

export function isSafeColumnName(name: string): boolean {
  return name.trim() !== "" && !RESERVED_NAMES.includes(name);
}

/** De-duplicate names: ["kund", "kund"] -> ["kund", "kund (2)"]. */
export function uniqueColumnNames(names: string[]): string[] {
  const used = new Set<string>(RESERVED_NAMES);
  return names.map((n) => {
    const base = n.trim() === "" ? "kolumn" : n;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base} (${k})`;
    used.add(name);
    return name;
  });
}

/**
 * Convert one raw cell:
 * - date-formatted numbers (t:"d") -> ISO date string (display text if invalid)
 * - time-formatted numbers ("[h]:mm") -> hours (Excel stores fractions of a day)
 * - percent-formatted numbers ("0.0%") -> percent units (0.125 -> 12.5)
 * - text -> trimmed string, empty -> null; error cells keep their text ("#N/A")
 */
export function convertCell(cell: RawCell | undefined, date1904: boolean): CellValue {
  if (!cell || cell.v === null) return null;
  switch (cell.t) {
    case "z":
      return null;
    case "d": {
      if (typeof cell.v !== "number") return String(cell.v).trim() || null;
      const r = parseDateSv(cell.v, { isExcelDate: true, date1904 });
      if (r.ok && "date" in r) return r.date;
      return cell.w?.trim() || String(cell.v);
    }
    case "n": {
      if (typeof cell.v !== "number") return String(cell.v).trim() || null;
      if (isTimeOnlyFormat(cell.f)) return Math.round(cell.v * 24 * 1e6) / 1e6;
      if (isPercentFormat(cell.f)) return Number((cell.v * 100).toPrecision(15));
      return cell.v;
    }
    case "b":
      return Boolean(cell.v);
    case "e":
      return String(cell.v);
    case "s":
    default: {
      const s = String(cell.v).trim();
      return s === "" ? null : s;
    }
  }
}

/** Build the working table from a detected table. */
export function fromDetected(table: DetectedTable, opts: { date1904: boolean }): WorkingTable {
  const columns = uniqueColumnNames(
    table.columns.map((c) => c.normalized || `kolumn ${columnLetter(c.index).toLowerCase()}`),
  );
  const headers: Record<string, string> = {};
  columns.forEach((name, i) => {
    headers[name] = table.columns[i]?.header ?? name;
  });
  const rows = table.rows.map((row) => {
    const values: Record<string, CellValue> = {};
    columns.forEach((name, i) => {
      values[name] = convertCell(row.cells[i], opts.date1904);
    });
    return { sourceRow: row.sourceRow, values };
  });
  return { columns, rows, headers };
}

/** Non-empty values of one column, in row order. */
export function columnValues(table: WorkingTable, column: string): CellValue[] {
  const out: CellValue[] = [];
  for (const row of table.rows) {
    const v = row.values[column];
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) continue;
    out.push(v);
  }
  return out;
}

/** Display text of a value as used for labels and matching. */
export function valueText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value);
}
