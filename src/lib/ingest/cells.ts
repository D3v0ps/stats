// Helpers for reading RawCells consistently across header detection, working
// tables and recognition.
import type { RawCell } from "@/lib/contracts";
import { parseDateSv } from "@/lib/core/dates-sv";
import { parseNumberSv } from "@/lib/core/num-sv";

/** Shared placeholder for empty cells; frozen because many rows reference it. */
export const EMPTY_CELL: RawCell = Object.freeze({ v: null, t: "z" });

export type CellClass = "empty" | "text" | "number" | "date";

/** Display text of a cell, trimmed. Empty cells give "". */
export function cellText(cell: RawCell | undefined | null): string {
  if (!cell || cell.t === "z" || cell.v === null) return "";
  if (cell.t === "s") return String(cell.v).trim();
  if (cell.w !== undefined && cell.w.trim() !== "") return cell.w.trim();
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v).trim();
}

export function isEmptyCell(cell: RawCell | undefined | null): boolean {
  return cellText(cell) === "";
}

/** True when text reads as a number in any supported notation (incl. ambiguous ones). */
export function looksNumeric(text: string): boolean {
  for (const kind of ["amount", "percent", "hours"] as const) {
    const r = parseNumberSv(text, kind);
    if (r.ok ? r.value !== null : r.ambiguous === true) return true;
  }
  return false;
}

/** True when text reads as a date or month. */
export function looksDate(text: string): boolean {
  return /\d/.test(text) && parseDateSv(text).ok;
}

/**
 * Classify a cell for layout heuristics. Text cells (CSV/HTML) are classified
 * by content so "8,5" counts as a number and "2026-09-30" as a date.
 */
export function classifyCell(cell: RawCell | undefined | null): CellClass {
  const text = cellText(cell);
  if (text === "") return "empty";
  if (!cell) return "empty";
  switch (cell.t) {
    case "n":
      return "number";
    case "d":
      return "date";
    case "b":
    case "e":
      return "text";
    default:
      // Plain years/ids are numbers; anything with date separators or month names is a date.
      if (/^\d{1,5}$/.test(text)) return "number";
      if (looksDate(text)) return "date";
      if (looksNumeric(text)) return "number";
      return "text";
  }
}

/** Excel-style column letter: 0 -> A, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
