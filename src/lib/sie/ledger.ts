// Monthly ledger rows for result accounts (3000-8999) from a parsed SIE file.
// Source per fiscal year: #PSALDO when the year has period balances for result
// accounts, otherwise the vouchers (#VER/#TRANS). Totals (dimNo null) and object
// rows are produced side by side and must never be added together: the object
// rows are a breakdown of the totals, with an implicit "ofördelat" remainder.
// All arithmetic is in integer öre so sums are exact.
import type { CompanyCode, LedgerRow } from "@/lib/contracts";
import { dateToMonth } from "@/lib/core/month";
import type { SieFile, SieFiscalYear, SiePeriodBalance, SieTrans } from "./parse";

export const RESULT_ACCOUNT_MIN = 3000;
export const RESULT_ACCOUNT_MAX = 8999;

/** Fiscal years that become ledger rows: the file's own year and the one before it. */
export const LEDGER_YEARS = [
  { yearNo: 0, yearOffset: 0 },
  { yearNo: -1, yearOffset: -1 },
] as const;

/** Below this difference (in öre) two amounts are considered equal: 1 kr. */
const TOLERANCE_ORE = 100;

export type PsaldoMode = "movement" | "cumulative" | "none";

export interface LedgerOptions {
  /** SIE dimension numbers kept as object rows (1 = kostnadsställe). */
  objectDims?: number[];
}

export interface LedgerYearInfo {
  yearNo: number;
  yearOffset: number;
  source: "psaldo" | "trans" | "none";
}

export interface LedgerDiagnostics {
  years: LedgerYearInfo[];
  /** #PSALDO rows with more than one object (cross breakdowns); ignored. */
  multiObjectRowsIgnored: number;
  /** #PSALDO rows with one object in a dimension outside objectDims; ignored. */
  otherDimRowsIgnored: number;
  /** True when #RES could not tell movement from cumulative and movement was assumed. */
  psaldoModeAssumed: boolean;
  /** Transactions whose transdate lies outside the voucher's fiscal year (voucher date used). */
  transDateOutsideYear: number;
  /** Vouchers without a valid date (their rows are skipped). */
  vouchersWithoutDate: number;
  /** Vouchers dated outside every #RAR year handled here. */
  vouchersOutsideYears: number;
}

export interface LedgerResult {
  rows: LedgerRow[];
  usedTransFallback: boolean;
  psaldoMode: PsaldoMode;
  diagnostics: LedgerDiagnostics;
}

export function isResultAccount(account: number): boolean {
  return account >= RESULT_ACCOUNT_MIN && account <= RESULT_ACCOUNT_MAX;
}

export function toOre(amount: number): number {
  return Math.round(amount * 100);
}

export function fromOre(ore: number): number {
  return ore === 0 ? 0 : ore / 100;
}

/** Transactions that make up the balance: #TRANS and #RTRANS, never #BTRANS or the #RTRANS echo. */
export function countsInBalance(t: SieTrans): boolean {
  if (t.kind === "btrans") return false;
  if (t.kind === "trans" && t.rtransDuplicate) return false;
  return true;
}

interface SeriesKey {
  account: number;
  dimNo: number | null;
  objectCode: string | null;
}

/** Sums öre per (month, account, object). */
class Accumulator {
  private readonly sums = new Map<string, { month: string } & SeriesKey & { ore: number }>();

  add(month: string, key: SeriesKey, ore: number): void {
    const k = `${month}|${key.account}|${key.dimNo ?? ""}|${key.objectCode ?? ""}`;
    const cur = this.sums.get(k);
    if (cur) cur.ore += ore;
    else this.sums.set(k, { month, ...key, ore });
  }

  rows(company: CompanyCode, yearOffset: number, source: LedgerRow["source"]): LedgerRow[] {
    const out: LedgerRow[] = [];
    for (const s of this.sums.values()) {
      if (s.ore === 0) continue;
      out.push({
        company,
        month: s.month,
        account: s.account,
        dimNo: s.dimNo,
        objectCode: s.objectCode,
        amount: fromOre(s.ore),
        yearOffset,
        source,
      });
    }
    return out;
  }
}

/** The series a #PSALDO line feeds, or null when the line is ignored (counted in diag). */
function classify(
  p: SiePeriodBalance,
  objectDims: ReadonlySet<number>,
  diag: LedgerDiagnostics,
): SeriesKey | null {
  const [first, ...rest] = p.objects;
  if (!first) return { account: p.account, dimNo: null, objectCode: null };
  if (rest.length > 0) {
    diag.multiObjectRowsIgnored++;
    return null;
  }
  if (!objectDims.has(first[0])) {
    diag.otherDimRowsIgnored++;
    return null;
  }
  return { account: p.account, dimNo: first[0], objectCode: first[1] };
}

/**
 * Decides whether #PSALDO holds monthly movements or cumulative (year-to-date)
 * balances by comparing each account's totals with #RES: movements sum to #RES,
 * cumulative balances end at #RES. Accounts where both hold (a single period)
 * do not vote.
 */
export function detectPsaldoMode(
  sie: SieFile,
  yearNos: readonly number[],
): {
  mode: "movement" | "cumulative";
  assumed: boolean;
  votes: { movement: number; cumulative: number };
} {
  const votes = { movement: 0, cumulative: 0 };
  for (const yearNo of yearNos) {
    const res = new Map<number, number>();
    for (const r of sie.res) if (r.yearNo === yearNo) res.set(r.account, toOre(r.amount));
    const perAccount = new Map<number, Map<string, number>>();
    for (const p of sie.psaldo) {
      if (p.yearNo !== yearNo || p.objects.length > 0 || !isResultAccount(p.account)) continue;
      const periods = perAccount.get(p.account) ?? new Map<string, number>();
      periods.set(p.period, (periods.get(p.period) ?? 0) + toOre(p.amount));
      perAccount.set(p.account, periods);
    }
    for (const [account, periods] of perAccount) {
      const target = res.get(account);
      if (target === undefined) continue;
      const sorted = [...periods.entries()].sort(([a], [b]) => cmp(a, b));
      const sum = sorted.reduce((acc, [, v]) => acc + v, 0);
      const last = sorted.at(-1)?.[1] ?? 0;
      const sumOk = Math.abs(sum - target) < TOLERANCE_ORE;
      const lastOk = Math.abs(last - target) < TOLERANCE_ORE;
      if (sumOk && !lastOk) votes.movement++;
      else if (lastOk && !sumOk) votes.cumulative++;
    }
  }
  if (votes.movement === 0 && votes.cumulative === 0) {
    return { mode: "movement", assumed: true, votes };
  }
  return {
    mode: votes.cumulative > votes.movement ? "cumulative" : "movement",
    assumed: false,
    votes,
  };
}

function psaldoRows(
  sie: SieFile,
  yearNo: number,
  mode: "movement" | "cumulative",
  objectDims: ReadonlySet<number>,
  diag: LedgerDiagnostics,
): Accumulator {
  const acc = new Accumulator();
  // series key -> period -> öre (duplicate lines for one period are added)
  const series = new Map<string, { key: SeriesKey; periods: Map<string, number> }>();
  for (const p of sie.psaldo) {
    if (p.yearNo !== yearNo || !isResultAccount(p.account)) continue;
    const key = classify(p, objectDims, diag);
    if (!key) continue;
    const k = `${key.account}|${key.dimNo ?? ""}|${key.objectCode ?? ""}`;
    const s = series.get(k) ?? { key, periods: new Map<string, number>() };
    s.periods.set(p.period, (s.periods.get(p.period) ?? 0) + toOre(p.amount));
    series.set(k, s);
  }
  for (const { key, periods } of series.values()) {
    const sorted = [...periods.entries()].sort(([a], [b]) => cmp(a, b));
    // Result accounts start every fiscal year at zero, so the first cumulative
    // value is that month's movement. A missing month means "unchanged".
    let previous = 0;
    for (const [period, ore] of sorted) {
      acc.add(period, key, mode === "movement" ? ore : ore - previous);
      previous = ore;
    }
  }
  return acc;
}

function inYear(date: string, year: SieFiscalYear | undefined): boolean {
  return year === undefined || (date >= year.start && date <= year.end);
}

function transRows(
  sie: SieFile,
  year: SieFiscalYear | undefined,
  objectDims: ReadonlySet<number>,
  diag: LedgerDiagnostics,
): { acc: Accumulator; vouchers: number } {
  const acc = new Accumulator();
  let vouchers = 0;
  for (const v of sie.ver) {
    if (v.date === null || !inYear(v.date, year)) continue;
    vouchers++;
    for (const t of v.trans) {
      if (!countsInBalance(t) || !isResultAccount(t.account)) continue;
      let date = t.transdate ?? v.date;
      if (t.transdate && !inYear(t.transdate, year)) {
        // The voucher date decides the fiscal year; a transdate in another year
        // would move the amount out of the year that #RES reconciles against.
        diag.transDateOutsideYear++;
        date = v.date;
      }
      const month = dateToMonth(date);
      const ore = toOre(t.amount);
      acc.add(month, { account: t.account, dimNo: null, objectCode: null }, ore);
      const seenDims = new Set<number>();
      for (const [dimNo, code] of t.objects) {
        if (!objectDims.has(dimNo) || seenDims.has(dimNo)) continue;
        seenDims.add(dimNo);
        acc.add(month, { account: t.account, dimNo, objectCode: code }, ore);
      }
    }
  }
  return { acc, vouchers };
}

function compareRows(a: LedgerRow, b: LedgerRow): number {
  return (
    b.yearOffset - a.yearOffset ||
    cmp(a.month, b.month) ||
    a.account - b.account ||
    (a.dimNo ?? 0) - (b.dimNo ?? 0) ||
    cmp(a.objectCode ?? "", b.objectCode ?? "")
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toLedger(
  sie: SieFile,
  company: CompanyCode,
  opts: LedgerOptions = {},
): LedgerResult {
  const objectDims = new Set(opts.objectDims ?? [1]);
  const diag: LedgerDiagnostics = {
    years: [],
    multiObjectRowsIgnored: 0,
    otherDimRowsIgnored: 0,
    psaldoModeAssumed: false,
    transDateOutsideYear: 0,
    vouchersWithoutDate: sie.ver.filter((v) => v.date === null).length,
    vouchersOutsideYears: 0,
  };

  const psaldoYears = LEDGER_YEARS.map((y) => y.yearNo).filter((yearNo) =>
    sie.psaldo.some((p) => p.yearNo === yearNo && isResultAccount(p.account)),
  );
  let psaldoMode: PsaldoMode = "none";
  if (psaldoYears.length > 0) {
    const detected = detectPsaldoMode(sie, psaldoYears);
    psaldoMode = detected.mode;
    diag.psaldoModeAssumed = detected.assumed;
  }

  const hasRar = sie.rar.length > 0;
  const rows: LedgerRow[] = [];
  let usedTransFallback = false;
  for (const { yearNo, yearOffset } of LEDGER_YEARS) {
    if (psaldoMode !== "none" && psaldoYears.includes(yearNo)) {
      rows.push(
        ...psaldoRows(sie, yearNo, psaldoMode, objectDims, diag).rows(
          company,
          yearOffset,
          "psaldo",
        ),
      );
      diag.years.push({ yearNo, yearOffset, source: "psaldo" });
      continue;
    }
    const year = sie.rar.find((r) => r.yearNo === yearNo);
    // Without any #RAR every voucher is taken as the current year's.
    if (!year && (hasRar || yearNo !== 0)) {
      diag.years.push({ yearNo, yearOffset, source: "none" });
      continue;
    }
    const { acc, vouchers } = transRows(sie, year, objectDims, diag);
    if (vouchers === 0) {
      diag.years.push({ yearNo, yearOffset, source: "none" });
      continue;
    }
    usedTransFallback = true;
    rows.push(...acc.rows(company, yearOffset, "trans"));
    diag.years.push({ yearNo, yearOffset, source: "trans" });
  }

  if (hasRar) {
    const handled = sie.rar.filter((r) => LEDGER_YEARS.some((y) => y.yearNo === r.yearNo));
    diag.vouchersOutsideYears = sie.ver.filter(
      (v) => v.date !== null && !handled.some((r) => inYear(v.date as string, r)),
    ).length;
  }

  rows.sort(compareRows);
  return { rows, usedTransFallback, psaldoMode, diagnostics: diag };
}
