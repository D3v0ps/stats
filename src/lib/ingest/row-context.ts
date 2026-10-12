// Per-row company and period resolution shared by table aggregation and cases.
import type { CompanyCode, CompanySource, ParseIssue, PeriodSource } from "@/lib/contracts";
import { parseDateSv, resultMonth } from "@/lib/core/dates-sv";
import { normalizeValue } from "@/lib/core/normalize";
import { valueText, type WorkingRow, type WorkingTable } from "./working";

export type Resolved<T> = { ok: true; value: T } | { ok: false; detail: string };

export type RowResolver<T> = (row: WorkingRow) => Resolved<T>;

const KNOWN_COMPANY_NAMES = new Map<string, CompanyCode>([
  ["mbab", "MBAB"],
  ["mbr", "MBR"],
  ["mb ab", "MBAB"],
  ["mb restart", "MBR"],
  ["miljonbemanning ab", "MBAB"],
  ["miljonbemanning restart ab", "MBR"],
  ["556959-9318", "MBAB"],
  ["5569599318", "MBAB"],
  ["559208-9071", "MBR"],
  ["5592089071", "MBR"],
]);

/**
 * Build the company resolver for a template. Returns null (with an issue)
 * when the company can't be determined for any row, e.g. per-upload without a choice.
 */
export function companyResolver(
  source: CompanySource,
  table: WorkingTable,
  chosen: CompanyCode | undefined,
  issues: ParseIssue[],
): RowResolver<CompanyCode> | null {
  switch (source.kind) {
    case "fixed":
      return () => ({ ok: true, value: source.company });
    case "per_upload":
      if (!chosen) {
        issues.push(globalIssue("", "Bolag är inte valt för filen."));
        return null;
      }
      return () => ({ ok: true, value: chosen });
    case "column": {
      if (!table.columns.includes(source.column)) {
        issues.push(globalIssue(source.column, `Bolagskolumnen "${source.column}" finns inte.`));
        return null;
      }
      const byNorm = new Map<string, CompanyCode>();
      for (const [label, code] of Object.entries(source.mapping))
        byNorm.set(normalizeValue(label), code);
      return (row) => {
        const text = valueText(row.values[source.column]);
        if (text === "") return { ok: false, detail: "Bolag saknas" };
        const key = normalizeValue(text);
        const code = byNorm.get(key) ?? KNOWN_COMPANY_NAMES.get(key);
        return code ? { ok: true, value: code } : { ok: false, detail: `Okänt bolag "${text}"` };
      };
    }
  }
}

/** Build the month resolver for a table template. */
export function periodResolver(
  source: PeriodSource,
  table: WorkingTable,
  chosen: string | undefined,
  issues: ParseIssue[],
): RowResolver<string> | null {
  if (source.kind === "per_upload") {
    if (!chosen) {
      issues.push(globalIssue("", "Månad är inte vald för filen."));
      return null;
    }
    return () => ({ ok: true, value: chosen });
  }
  if (!table.columns.includes(source.column)) {
    issues.push(globalIssue(source.column, `Periodkolumnen "${source.column}" finns inte.`));
    return null;
  }
  return (row) => {
    const v = row.values[source.column];
    const text = valueText(v);
    if (text === "") return { ok: false, detail: "Datum/period saknas" };
    const month = resultMonth(parseDateSv(typeof v === "number" ? v : text));
    return month ? { ok: true, value: month } : { ok: false, detail: `Ogiltigt datum "${text}"` };
  };
}

export function globalIssue(column: string, message: string): ParseIssue {
  return { sourceRow: 0, column, value: "", message, severity: "error" };
}
