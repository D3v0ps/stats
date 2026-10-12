// Month arithmetic and period windows. All data in MB Stats is monthly, so a
// "Month" is an ISO year-month string ("2026-09"). Everything here is pure and
// timezone-free except currentMonth(), which is explicit about Europe/Stockholm.

export type Month = string;

export type PeriodGrain = "month" | "quarter" | "year" | "ytd" | "r12";

export interface PeriodSelection {
  grain: PeriodGrain;
  /** The month the period is anchored on, normally the latest complete month. */
  anchor: Month;
}

export interface PeriodWindow {
  grain: PeriodGrain;
  anchor: Month;
  from: Month;
  to: Month;
  /** Every month in [from, to], in order. */
  months: Month[];
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const MONTH_NAMES_SV = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
] as const;

export const MONTH_ABBR_SV = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

export function isMonth(value: unknown): value is Month {
  return typeof value === "string" && MONTH_RE.test(value);
}

export function parseMonth(month: Month): { year: number; month: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function toMonth(year: number, month: number): Month {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid year/month: ${year}-${month}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Index of a month on a continuous scale (useful for differences). */
export function monthIndex(month: Month): number {
  const { year, month: m } = parseMonth(month);
  return year * 12 + (m - 1);
}

export function fromMonthIndex(index: number): Month {
  return toMonth(Math.floor(index / 12), (index % 12) + 1);
}

export function addMonths(month: Month, n: number): Month {
  return fromMonthIndex(monthIndex(month) + n);
}

export function compareMonths(a: Month, b: Month): number {
  return monthIndex(a) - monthIndex(b);
}

export function monthsBetween(from: Month, to: Month): number {
  return monthIndex(to) - monthIndex(from);
}

/** Inclusive range. Empty when from > to. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(fromMonthIndex(i));
  return out;
}

/** "2026-09" -> "2026-09-01" (the date Postgres stores). */
export function monthToDate(month: Month): string {
  parseMonth(month);
  return `${month}-01`;
}

/** "2026-09-30" or "2026-09-01T..." -> "2026-09". */
export function dateToMonth(date: string): Month {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m || !isMonth(`${m[1]}-${m[2]}`)) throw new Error(`Invalid date: ${date}`);
  return `${m[1]}-${m[2]}`;
}

export function daysInMonth(month: Month): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Last calendar day of the month as ISO date. */
export function monthEndDate(month: Month): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/** The current month in Europe/Stockholm for the given instant. */
export function currentMonth(now: Date): Month {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/** The latest month that has fully ended in Europe/Stockholm. */
export function lastClosedMonth(now: Date): Month {
  return addMonths(currentMonth(now), -1);
}

/** First month of the fiscal year containing `month`. */
export function fiscalYearStart(month: Month, fiscalStartMonth = 1): Month {
  const { year, month: m } = parseMonth(month);
  const startYear = m >= fiscalStartMonth ? year : year - 1;
  return toMonth(startYear, fiscalStartMonth);
}

/** First month of the (fiscal) quarter containing `month`. */
export function quarterStart(month: Month, fiscalStartMonth = 1): Month {
  const fy = fiscalYearStart(month, fiscalStartMonth);
  const offset = monthsBetween(fy, month);
  return addMonths(fy, Math.floor(offset / 3) * 3);
}

/**
 * Resolve a period selection to concrete months.
 * - month: the anchor month
 * - quarter: the full (fiscal) quarter containing the anchor
 * - year: the full fiscal year containing the anchor
 * - ytd: fiscal year start .. anchor
 * - r12: the 12 months ending at the anchor
 * Months after the anchor in quarter/year simply have no data yet; coverage
 * reporting (see metrics engine) makes that visible instead of hiding it.
 */
export function resolvePeriod(sel: PeriodSelection, fiscalStartMonth = 1): PeriodWindow {
  const { grain, anchor } = sel;
  let from: Month;
  let to: Month;
  switch (grain) {
    case "month":
      from = anchor;
      to = anchor;
      break;
    case "quarter":
      from = quarterStart(anchor, fiscalStartMonth);
      to = addMonths(from, 2);
      break;
    case "year":
      from = fiscalYearStart(anchor, fiscalStartMonth);
      to = addMonths(from, 11);
      break;
    case "ytd":
      from = fiscalYearStart(anchor, fiscalStartMonth);
      to = anchor;
      break;
    case "r12":
      from = addMonths(anchor, -11);
      to = anchor;
      break;
  }
  return { grain, anchor, from, to, months: monthRange(from, to) };
}

/**
 * The window immediately before, of the same shape. Returns null for YTD, where
 * "previous period" has no sensible meaning (use the previous year instead).
 */
export function previousPeriod(window: PeriodWindow, fiscalStartMonth = 1): PeriodWindow | null {
  switch (window.grain) {
    case "month":
      return resolvePeriod(
        { grain: "month", anchor: addMonths(window.anchor, -1) },
        fiscalStartMonth,
      );
    case "quarter":
      return resolvePeriod(
        { grain: "quarter", anchor: addMonths(window.from, -1) },
        fiscalStartMonth,
      );
    case "year":
      return resolvePeriod({ grain: "year", anchor: addMonths(window.from, -1) }, fiscalStartMonth);
    case "r12":
      return resolvePeriod(
        { grain: "r12", anchor: addMonths(window.anchor, -12) },
        fiscalStartMonth,
      );
    case "ytd":
      return null;
  }
}

/** The same window shifted back twelve months. */
export function previousYear(window: PeriodWindow, fiscalStartMonth = 1): PeriodWindow {
  return resolvePeriod(
    { grain: window.grain, anchor: addMonths(window.anchor, -12) },
    fiscalStartMonth,
  );
}

export function formatMonthLong(month: Month): string {
  const { year, month: m } = parseMonth(month);
  return `${MONTH_NAMES_SV[m - 1]} ${year}`;
}

export function formatMonthShort(month: Month): string {
  const { year, month: m } = parseMonth(month);
  return `${MONTH_ABBR_SV[m - 1]} ${year}`;
}

/** Human label for a window, e.g. "september 2026", "kv 3 2026", "jan–sep 2026". */
export function formatPeriodLabel(window: PeriodWindow, fiscalStartMonth = 1): string {
  const from = parseMonth(window.from);
  const to = parseMonth(window.to);
  switch (window.grain) {
    case "month":
      return formatMonthLong(window.anchor);
    case "quarter": {
      const fy = fiscalYearStart(window.from, fiscalStartMonth);
      const q = Math.floor(monthsBetween(fy, window.from) / 3) + 1;
      return fiscalStartMonth === 1 ? `kv ${q} ${from.year}` : `kv ${q} ${fiscalYearLabel(fy)}`;
    }
    case "year":
      return fiscalStartMonth === 1 ? String(from.year) : fiscalYearLabel(window.from);
    case "ytd":
    case "r12":
      if (from.year === to.year) {
        return `${MONTH_ABBR_SV[from.month - 1]}–${MONTH_ABBR_SV[to.month - 1]} ${to.year}`;
      }
      return `${formatMonthShort(window.from)}–${formatMonthShort(window.to)}`;
  }
}

function fiscalYearLabel(fyStart: Month): string {
  const { year } = parseMonth(fyStart);
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}
