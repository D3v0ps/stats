// Output of the file readers (CSV/XLSX/XLS/HTML-xls) and the header detector.
// Readers never interpret Swedish formats; they preserve raw value + display text
// so later stages can parse deliberately and report exactly what failed.
import { z } from "zod";

export const FileFormatSchema = z.enum(["csv", "xlsx", "xls", "html", "sie", "pdf"]);
export type FileFormat = z.infer<typeof FileFormatSchema>;

/**
 * One cell as read from the file.
 * - v: raw value (number for numeric cells, string for text, boolean, or null when empty)
 * - w: display text as the source showed it (formatted number/date), if any
 * - t: cell type: s=string n=number b=boolean d=date-formatted number e=error z=empty
 * - f: number format code from Excel (e.g. "yyyy-mm-dd", "0.00"), if any
 */
export interface RawCell {
  v: string | number | boolean | null;
  w?: string;
  t: "s" | "n" | "b" | "d" | "e" | "z";
  f?: string;
}

export interface CellRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface RawSheet {
  name: string;
  hidden: boolean;
  /** Dense row-major grid, 0-based. Row i corresponds to source row i + 1. */
  rows: RawCell[][];
  merges: CellRange[];
}

export interface RawWorkbook {
  fileName: string;
  format: FileFormat;
  /** Detected text encoding for text formats (utf-8, windows-1252, utf-16le, cp437). */
  encoding?: string;
  /** Detected delimiter for CSV. */
  delimiter?: string;
  /** Excel 1904 date system flag. */
  date1904: boolean;
  sheets: RawSheet[];
}

export const SkipReasonSchema = z.enum([
  "empty",
  "sum_row",
  "footer",
  "repeated_header",
  "filtered",
  "unparseable",
  "meta",
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export interface SkippedRow {
  /** 1-based row number as shown in Excel / the text file. */
  sourceRow: number;
  reason: SkipReason;
  detail?: string;
}

export interface ParseIssue {
  sourceRow: number;
  column: string;
  value: string;
  message: string;
  severity: "error" | "warning";
}

export interface DetectedColumn {
  /** 0-based column index in the sheet. */
  index: number;
  /** Header text as shown (multi-row headers joined with " "). */
  header: string;
  /** Normalized header used for signatures: lowercased, trimmed, collapsed whitespace. */
  normalized: string;
}

export interface DetectedRow {
  sourceRow: number;
  cells: RawCell[];
}

export interface DetectedTable {
  sheetName: string;
  /** 0-based indices of the header row(s) in the sheet. */
  headerRows: number[];
  columns: DetectedColumn[];
  rows: DetectedRow[];
  skipped: SkippedRow[];
  /** Non-empty text lines above the header (report title, period, company). Fed to recognition. */
  metaLines: string[];
  /** Confidence 0..1 of the header detection. Below 0.5 the UI asks the user to pick the header row. */
  confidence: number;
}
