// CSV reading via papaparse. Every cell stays a string: interpreting Swedish
// numbers and dates is the job of later stages, which report what failed.
import Papa from "papaparse";
import type { RawCell } from "@/lib/contracts";
import { EMPTY_CELL } from "../cells";

/** Candidate delimiters in tie-break order: Swedish exports use ";" (comma is the decimal sign). */
export const CSV_DELIMITERS = [";", "\t", ","] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

const SNIFF_ROWS = 50;

interface DelimiterScore {
  delimiter: CsvDelimiter;
  /** Rows having the most common field count (> 1). */
  consistent: number;
  fields: number;
}

function scoreDelimiter(text: string, delimiter: CsvDelimiter): DelimiterScore {
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    preview: SNIFF_ROWS,
    skipEmptyLines: "greedy",
  });
  const counts = new Map<number, number>();
  for (const row of parsed.data) {
    if (row.length > 1) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }
  let fields = 0;
  let consistent = 0;
  for (const [n, c] of counts) {
    if (c > consistent || (c === consistent && n > fields)) {
      fields = n;
      consistent = c;
    }
  }
  return { delimiter, consistent, fields };
}

/**
 * Pick the delimiter that splits most rows into the same number of fields
 * (quotes respected). Ties go to ";" before tab before ",": a comma is the
 * Swedish decimal sign and appears in names ("Andersson, Anna"), so extra
 * fields from splitting on it are no evidence.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  let best: DelimiterScore = { delimiter: ";", consistent: 0, fields: 0 };
  for (const d of CSV_DELIMITERS) {
    const s = scoreDelimiter(text, d);
    if (s.consistent > best.consistent) best = s;
  }
  return best.delimiter;
}

export interface CsvResult {
  rows: RawCell[][];
  delimiter: CsvDelimiter;
}

function toCell(value: string): RawCell {
  return value === "" ? EMPTY_CELL : { v: value, w: value, t: "s" };
}

/** Excel's first-line delimiter hint ("sep=;"), written by some CSV exports. */
const SEP_HINT = /^sep=([;,\t])[ \t]*(?:\r\n|\n|\r|$)/i;

/** Parse decoded CSV text into string cells. Never throws; malformed quotes keep what was read. */
export function parseCsv(text: string, delimiter?: CsvDelimiter): CsvResult {
  const hint = SEP_HINT.exec(text);
  if (hint) text = text.slice(hint[0].length);
  const d = delimiter ?? (hint?.[1] as CsvDelimiter | undefined) ?? sniffDelimiter(text);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: d,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    quoteChar: '"',
  });
  const rows = parsed.data.map((row) => row.map((v) => toCell(String(v ?? ""))));
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.t === "z")) rows.pop();
  return { rows, delimiter: d };
}
