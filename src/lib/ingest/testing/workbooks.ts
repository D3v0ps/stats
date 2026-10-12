// Test-only helpers that build spreadsheet files in memory with SheetJS.
// Not imported by production code.
import * as XLSX from "xlsx";
import type { RawCell, RawSheet } from "@/lib/contracts";

export interface SheetSpec {
  name: string;
  rows: (string | number | boolean | null)[][];
  merges?: string[];
  /** A1 address -> number format, e.g. { B5: "yyyy-mm-dd" }. */
  formats?: Record<string, string>;
  hidden?: boolean;
}

export function buildWorkbook(sheets: SheetSpec[], opts: { date1904?: boolean } = {}) {
  const wb = XLSX.utils.book_new();
  for (const spec of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(spec.rows);
    if (spec.merges) ws["!merges"] = spec.merges.map((m) => XLSX.utils.decode_range(m));
    for (const [addr, fmt] of Object.entries(spec.formats ?? {})) {
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (cell) cell.z = fmt;
    }
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }
  wb.Workbook = {
    Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })),
    WBProps: { date1904: opts.date1904 ?? false },
  };
  return wb;
}

export function xlsxBytes(sheets: SheetSpec[], opts: { date1904?: boolean } = {}): Uint8Array {
  const out = XLSX.write(buildWorkbook(sheets, opts), { type: "array", bookType: "xlsx" });
  return new Uint8Array(out as ArrayBuffer);
}

export function xlsBytes(sheets: SheetSpec[]): Uint8Array {
  const out = XLSX.write(buildWorkbook(sheets), { type: "array", bookType: "biff8" });
  return new Uint8Array(out as ArrayBuffer);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Build a RawSheet directly from values (strings become text cells). */
export function rawSheet(
  rows: (string | number | null)[][],
  opts: { name?: string; merges?: RawSheet["merges"]; hidden?: boolean } = {},
): RawSheet {
  return {
    name: opts.name ?? "Blad1",
    hidden: opts.hidden ?? false,
    merges: opts.merges ?? [],
    rows: rows.map((row) =>
      row.map((v): RawCell => {
        if (v === null || v === "") return { v: null, t: "z" };
        if (typeof v === "number") return { v, t: "n", w: String(v) };
        return { v, t: "s", w: v };
      }),
    ),
  };
}
