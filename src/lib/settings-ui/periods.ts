// The Perioder table (months with data and closed months per company) and the fiscal year
// explanation shown under "Bolag och räkenskapsår".
import type { CompanyCode } from "@/lib/contracts/domain";
import { MONTH_NAMES_SV, compareMonths } from "@/lib/core/month";

export const COMPANY_ORDER: readonly CompanyCode[] = ["MBAB", "MBR"];

export interface MonthData {
  company: CompanyCode;
  month: string;
  /** Dataset keys with current data for the month. */
  datasets: string[];
}

export interface ClosedMonth {
  company: CompanyCode;
  month: string;
  closedAt: string;
}

export interface PeriodCell {
  /** Dataset names with data, in the order given by datasetNames. */
  datasets: string[];
  closedAt: string | null;
}

export interface PeriodRow {
  month: string;
  cells: Record<CompanyCode, PeriodCell>;
}

/** Every month with data or a close mark, newest first; both companies on every row. */
export function buildPeriodRows(
  withData: readonly MonthData[],
  closed: readonly ClosedMonth[],
  datasetNames: Readonly<Record<string, string>>,
): PeriodRow[] {
  const order = Object.keys(datasetNames);
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  const rows = new Map<string, PeriodRow>();
  const row = (month: string): PeriodRow => {
    let r = rows.get(month);
    if (!r) {
      r = {
        month,
        cells: {
          MBAB: { datasets: [], closedAt: null },
          MBR: { datasets: [], closedAt: null },
        },
      };
      rows.set(month, r);
    }
    return r;
  };
  for (const d of withData) {
    const cell = row(d.month).cells[d.company];
    const keys = [...new Set([...d.datasets])].sort((a, b) => rank(a) - rank(b));
    cell.datasets = keys.map((k) => datasetNames[k] ?? k);
  }
  for (const c of closed) row(c.month).cells[c.company].closedAt = c.closedAt;
  return [...rows.values()].sort((a, b) => compareMonths(b.month, a.month));
}

// ---- Fiscal year -------------------------------------------------------------------

const monthName = (m: number) => MONTH_NAMES_SV[(((m - 1) % 12) + 12) % 12]!;

/** "januari–december" (calendar year) or "juli–juni". */
export function fiscalYearSpan(startMonth: number): string {
  return `${monthName(startMonth)}–${monthName(startMonth + 11)}`;
}

/** Quarter spans for a fiscal start: ["juli–september", "oktober–december", …]. */
export function fiscalQuarters(startMonth: number): string[] {
  return [0, 3, 6, 9].map((o) => `${monthName(startMonth + o)}–${monthName(startMonth + o + 2)}`);
}

/** One-sentence explanation of what the fiscal start month changes. */
export function fiscalExplanation(startMonth: number): string {
  const quarters = fiscalQuarters(startMonth);
  return `Räkenskapsåret är ${fiscalYearSpan(startMonth)}. ”Hittills i år” räknas från ${monthName(startMonth)}, och kvartal 1 är ${quarters[0]}.`;
}

export const MONTH_OPTIONS: readonly { value: number; label: string }[] = MONTH_NAMES_SV.map(
  (name, i) => ({ value: i + 1, label: name.charAt(0).toLocaleUpperCase("sv") + name.slice(1) }),
);
