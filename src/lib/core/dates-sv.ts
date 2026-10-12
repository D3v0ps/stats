// Parsing of dates and months as Swedish exports write them. Day/month order
// is always Swedish (d/m); impossible dates are rejected, never corrected.
// Excel serials are converted with UTC arithmetic so the result never depends
// on the time zone of the machine running the import.

import { isMonth } from "./month";

export type ParseDateResult =
  | { ok: true; date: string }
  | { ok: true; month: string }
  | { ok: false; reason: string; ambiguous?: boolean };

export interface ParseDateOptions {
  /** Workbook uses the 1904 date system (old Mac Excel). */
  date1904?: boolean;
  /** The number is an Excel serial (the cell was date-formatted). */
  isExcelDate?: boolean;
}

export interface MonthCandidate {
  month: string;
  /** 0..1 */
  confidence: number;
}

const DAY_MS = 86_400_000;
/** 9999-12-31, the last date Excel can represent. */
const MAX_SERIAL = 2_958_465;
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

/** Swedish and English month names and abbreviations (lowercase, without trailing dot). */
const MONTH_WORDS: Record<string, number> = {
  januari: 1,
  january: 1,
  jan: 1,
  februari: 2,
  february: 2,
  feb: 2,
  mars: 3,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  maj: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  augusti: 8,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_WORD_PATTERN = Object.keys(MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const pad2 = (n: number) => String(n).padStart(2, "0");

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar date within the supported year range. */
export function isValidYmd(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysIn(year, month)
  );
}

function dateResult(year: number, month: number, day: number, text: string): ParseDateResult {
  if (!isValidYmd(year, month, day)) {
    return { ok: false, reason: `Datumet "${text}" finns inte` };
  }
  return { ok: true, date: `${year}-${pad2(month)}-${pad2(day)}` };
}

function monthResult(year: number, month: number, text: string): ParseDateResult {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    return { ok: false, reason: `Månaden "${text}" finns inte` };
  }
  return { ok: true, month: `${year}-${pad2(month)}` };
}

/** Two-digit years follow Excel's rule: 00–29 -> 2000s, 30–99 -> 1900s. */
function expandYear(y: string): number {
  const n = Number(y);
  if (y.length === 4) return n;
  return n < 30 ? 2000 + n : 1900 + n;
}

/**
 * Excel serial -> "YYYY-MM-DD". The time-of-day fraction is ignored.
 * 1900 system: serial 1 = 1900-01-01; serial 60 is Excel's fictitious
 * 1900-02-29 (Lotus leap-year bug) and is rejected; later serials are offset.
 * 1904 system: serial 0 = 1904-01-01.
 */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  // Round to the second first so 46295.99999999 (float noise) stays on its day.
  const day = Math.floor(Math.round(serial * 86_400) / 86_400);
  let ms: number;
  if (date1904) {
    if (day < 0 || day > MAX_SERIAL - 1462) return null;
    ms = Date.UTC(1904, 0, 1) + day * DAY_MS;
  } else {
    if (day < 1 || day === 60 || day > MAX_SERIAL) return null;
    ms = day < 60 ? Date.UTC(1899, 11, 31) + day * DAY_MS : Date.UTC(1899, 11, 30) + day * DAY_MS;
  }
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseNumberInput(n: number, opts: ParseDateOptions): ParseDateResult {
  if (opts.isExcelDate) {
    const iso = excelSerialToIso(n, opts.date1904 ?? false);
    if (!iso) return { ok: false, reason: `Excel-datumet ${n} finns inte` };
    const year = Number(iso.slice(0, 4));
    if (year < MIN_YEAR || year > MAX_YEAR) {
      return { ok: false, reason: `Excel-datumet ${n} ligger utanför tillåtna år` };
    }
    return { ok: true, date: iso };
  }
  if (Number.isInteger(n) && n > 0) {
    const s = String(n);
    if (s.length === 8) return parseDateSv(s);
    if (s.length === 6) return parseDateSv(s);
  }
  return { ok: false, reason: `Talet ${n} är inget datum` };
}

const TIME_SUFFIX = String.raw`(?:(?:t|\s+)\d{1,2}[:.]\d{2}(?:[:.]\d{2}(?:[.,]\d+)?)?\s*(?:z|[+-]\d{2}(?::?\d{2})?)?)?`;

const RE_ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME_SUFFIX}$`);
const RE_YMD_SLASH = new RegExp(String.raw`^(\d{4})[/.](\d{1,2})[/.](\d{1,2})${TIME_SUFFIX}$`);
const RE_YYYYMMDD = /^(\d{4})(\d{2})(\d{2})$/;
const RE_YYYYMM = /^(\d{4})(\d{2})$/;
const RE_YEAR_MONTH = /^(\d{4})[-/. _](\d{1,2})$/;
const RE_DMY = new RegExp(
  String.raw`^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]|\s+|,\s*)(\d{4}|\d{2})(?:\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)?$`,
);
const RE_MONTH_YEAR_NUM = /^(\d{1,2})[/\-._](\d{4})$/;
const RE_NAMED = new RegExp(
  String.raw`^(?:(\d{1,2})\.?[\s\-]*)?(${MONTH_WORD_PATTERN})\.?[\s,\-/_]*(\d{4})$`,
);
const RE_NAMED_YEAR_FIRST = new RegExp(String.raw`^(\d{4})[\s\-_]+(${MONTH_WORD_PATTERN})\.?$`);
const RE_NAMED_DAY_AFTER = new RegExp(
  String.raw`^(${MONTH_WORD_PATTERN})\.?\s+(\d{1,2}),?\s+(\d{4})$`,
);

/**
 * Parse a date or a month.
 * Dates: "2026-09-30", "2026-09-30 13:00", "30/9 2026", "30/9/2026", "30/9-2026",
 * "30.9.2026", "30-09-2026", "30 sep 2026", "30 september 2026", "20260930".
 * Months: "2026-09", "202609", "2026 09", "09-2026", "sep 2026", "Sept. 2026".
 * Numbers are Excel serials only with isExcelDate; otherwise 8/6-digit numbers
 * are read as YYYYMMDD/YYYYMM.
 */
export function parseDateSv(
  input: string | number | null | undefined,
  opts: ParseDateOptions = {},
): ParseDateResult {
  if (input === null || input === undefined) return { ok: false, reason: "Datum saknas" };
  if (typeof input === "number") return parseNumberInput(input, opts);

  const s = input.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("sv");
  if (s === "") return { ok: false, reason: "Datum saknas" };

  let m = RE_ISO.exec(s) ?? RE_YMD_SLASH.exec(s);
  if (m) return dateResult(Number(m[1]), Number(m[2]), Number(m[3]), input.trim());
  m = RE_YYYYMMDD.exec(s);
  if (m) return dateResult(Number(m[1]), Number(m[2]), Number(m[3]), input.trim());
  m = RE_YYYYMM.exec(s) ?? RE_YEAR_MONTH.exec(s);
  if (m) return monthResult(Number(m[1]), Number(m[2]), input.trim());
  m = RE_DMY.exec(s);
  if (m) return dateResult(expandYear(m[3]!), Number(m[2]), Number(m[1]), input.trim());
  m = RE_MONTH_YEAR_NUM.exec(s);
  if (m) return monthResult(Number(m[2]), Number(m[1]), input.trim());
  m = RE_NAMED.exec(s);
  if (m) {
    const month = MONTH_WORDS[m[2]!]!;
    if (m[1]) return dateResult(Number(m[3]), month, Number(m[1]), input.trim());
    return monthResult(Number(m[3]), month, input.trim());
  }
  m = RE_NAMED_YEAR_FIRST.exec(s);
  if (m) return monthResult(Number(m[1]), MONTH_WORDS[m[2]!]!, input.trim());
  m = RE_NAMED_DAY_AFTER.exec(s);
  if (m) return dateResult(Number(m[3]), MONTH_WORDS[m[1]!]!, Number(m[2]), input.trim());

  return { ok: false, reason: `"${input.trim()}" är inget datum` };
}

/** The month of a parse result ("2026-09"), or null for a failure. */
export function resultMonth(result: ParseDateResult): string | null {
  if (!result.ok) return null;
  return "date" in result ? result.date.slice(0, 7) : result.month;
}

// ---- Month candidates in free text (file names, report meta lines) ---------

interface Pattern {
  re: RegExp;
  confidence: number;
  read: (m: RegExpExecArray) => { year: number; month: number; day?: number } | null;
}

const D = String.raw`(?<!\d)`;
const ND = String.raw`(?!\d)`;
const NL = String.raw`(?<!\p{L})`;
const NNL = String.raw`(?!\p{L})`;

// Ordered by specificity; earlier matches consume their characters.
const CANDIDATE_PATTERNS: Pattern[] = [
  {
    // 2026-09-30, 2026_09_30, 2026.09.30
    re: new RegExp(String.raw`${D}(\d{4})([-_./])(\d{2})\2(\d{2})${ND}`, "gu"),
    confidence: 0.6,
    read: (m) => ({ year: Number(m[1]), month: Number(m[3]), day: Number(m[4]) }),
  },
  {
    // 30/9/2026, 30.09.2026, 30-09-2026, 30/9 2026, 30/9-2026
    re: new RegExp(String.raw`${D}(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]| )(\d{4})${ND}`, "gu"),
    confidence: 0.6,
    read: (m) => ({ year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) }),
  },
  {
    // 30 september 2026
    re: new RegExp(
      String.raw`${D}(\d{1,2})\.?[\s_\-]+(${MONTH_WORD_PATTERN})${NNL}\.?[\s_\-,]*(\d{4})${ND}`,
      "gu",
    ),
    confidence: 0.8,
    read: (m) => ({ year: Number(m[3]), month: MONTH_WORDS[m[2]!]!, day: Number(m[1]) }),
  },
  {
    // september 2026, Sept. 2026, sep_2026
    re: new RegExp(String.raw`${NL}(${MONTH_WORD_PATTERN})${NNL}\.?[\s_\-,]*(\d{4})${ND}`, "gu"),
    confidence: 0.95,
    read: (m) => ({ year: Number(m[2]), month: MONTH_WORDS[m[1]!]! }),
  },
  {
    // 2026 september
    re: new RegExp(String.raw`${D}(\d{4})[\s_\-]+(${MONTH_WORD_PATTERN})${NNL}`, "gu"),
    confidence: 0.9,
    read: (m) => ({ year: Number(m[1]), month: MONTH_WORDS[m[2]!]! }),
  },
  {
    // 2026-09, 2026_09, 2026.09
    re: new RegExp(String.raw`${D}(\d{4})[-_.](\d{2})${ND}`, "gu"),
    confidence: 0.9,
    read: (m) => ({ year: Number(m[1]), month: Number(m[2]) }),
  },
  {
    // 2026 09
    re: new RegExp(String.raw`${D}(\d{4}) (\d{2})${ND}`, "gu"),
    confidence: 0.7,
    read: (m) => ({ year: Number(m[1]), month: Number(m[2]) }),
  },
  {
    // 09-2026, 09_2026, 9/2026
    re: new RegExp(String.raw`${D}(\d{1,2})[-_/.](\d{4})${ND}`, "gu"),
    confidence: 0.8,
    read: (m) => ({ year: Number(m[2]), month: Number(m[1]) }),
  },
  {
    // 20260930
    re: new RegExp(String.raw`${D}(\d{4})(\d{2})(\d{2})${ND}`, "gu"),
    confidence: 0.5,
    read: (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }),
  },
  {
    // 202609
    re: new RegExp(String.raw`${D}(\d{4})(\d{2})${ND}`, "gu"),
    confidence: 0.7,
    read: (m) => ({ year: Number(m[1]), month: Number(m[2]) }),
  },
];

const CANDIDATE_MIN_YEAR = 1990;
const CANDIDATE_MAX_YEAR = 2100;

/**
 * Find month mentions in a file name or a report line, most likely first.
 * "intelliplan_timmar_MBAB_2026-09.xlsx" -> [{ month: "2026-09", confidence: 0.9 }].
 * Full dates count with lower confidence (they are often print dates); repeated
 * mentions of the same month raise its confidence slightly.
 */
export function extractMonthCandidates(text: string): MonthCandidate[] {
  const s = text.normalize("NFC").toLocaleLowerCase("sv");
  const consumed = new Array<boolean>(s.length).fill(false);
  const found = new Map<string, { best: number; count: number }>();

  for (const pattern of CANDIDATE_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.re.exec(s)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (consumed.slice(start, end).some(Boolean)) continue;
      const parts = pattern.read(m);
      if (!parts) continue;
      const { year, month, day } = parts;
      if (year < CANDIDATE_MIN_YEAR || year > CANDIDATE_MAX_YEAR) continue;
      if (day !== undefined ? !isValidYmd(year, month, day) : month < 1 || month > 12) continue;
      const key = `${year}-${pad2(month)}`;
      if (!isMonth(key)) continue;
      for (let i = start; i < end; i++) consumed[i] = true;
      const prev = found.get(key);
      if (prev) {
        prev.best = Math.max(prev.best, pattern.confidence);
        prev.count++;
      } else {
        found.set(key, { best: pattern.confidence, count: 1 });
      }
    }
  }

  return [...found.entries()]
    .map(([month, { best, count }]) => ({
      month,
      confidence: Math.min(0.99, Math.round((best + 0.05 * (count - 1)) * 100) / 100),
    }))
    .sort((a, b) => b.confidence - a.confidence || (a.month < b.month ? 1 : -1));
}
