// What the mapping view shows of the file: display text of cells, example
// values per column, distinct values (for company and result mappings) and the
// sums row per measure under the live preview.
import type { ColumnType } from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { detectDecimalSeparator, parseNumberSv, type NumberKind } from "@/lib/core/num-sv";
import { redactPersonnummer } from "@/lib/core/pnr";
import { roundSum } from "@/lib/ingest/aggregate";
import { valueText, type CellValue, type WorkingTable } from "@/lib/ingest/working";

/** Cell text as shown in the preview: Swedish numbers, Ja/Nej, personnummer masked. */
export function displayValue(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Ja" : "Nej";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    const decimals = Number.isInteger(v) ? 0 : Math.min(4, (String(v).split(".")[1] ?? "").length);
    return formatNumber(v, decimals);
  }
  return redactPersonnummer(v);
}

/** Up to `max` distinct non-empty display values of a column, in row order. */
export function distinctValues(table: WorkingTable, column: string, max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const text = displayValue(row.values[column]).trim();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Distinct raw texts (unformatted, for mapping tables keyed by the cell text). */
export function distinctRawValues(table: WorkingTable, column: string, max = 100): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const text = valueText(row.values[column]);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push(redactPersonnummer(text));
    if (out.length >= max) break;
  }
  return out;
}

const KIND_BY_TYPE: Record<ColumnType, NumberKind> = {
  number: "number",
  amount: "amount",
  hours: "hours",
  percent: "percent",
  text: "number",
  date: "number",
};

export interface MeasureSum {
  /** Sum of the readable cells; null when no cell could be read as a number. */
  sum: number | null;
  /** Non-empty cells that are not numbers. */
  unreadable: number;
}

/** Sums row under the preview, parsed the same way aggregation parses measures. */
export function measureSums(
  table: WorkingTable,
  measures: readonly { column: string; type: ColumnType }[],
): Record<string, MeasureSum> {
  const out: Record<string, MeasureSum> = {};
  for (const m of measures) {
    if (!table.columns.includes(m.column)) continue;
    const kind = KIND_BY_TYPE[m.type];
    const values = table.rows.map((r) => r.values[m.column]);
    const hint = detectDecimalSeparator(values, kind) ?? undefined;
    let sum = 0;
    let any = false;
    let unreadable = 0;
    for (const v of values) {
      if (typeof v === "number") {
        if (Number.isFinite(v)) {
          sum += v;
          any = true;
        }
        continue;
      }
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) continue;
      if (typeof v === "boolean") {
        unreadable++;
        continue;
      }
      const r = parseNumberSv(v, kind, { decimalSeparator: hint });
      if (r.ok && r.value !== null) {
        sum += r.value;
        any = true;
      } else if (!r.ok) unreadable++;
    }
    out[m.column] = { sum: any ? roundSum(sum) : null, unreadable };
  }
  return out;
}
