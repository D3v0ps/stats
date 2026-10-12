// Parsing of numbers as Swedish (and some foreign) exports write them. The rule
// is "never guess": when a value could mean two different numbers ("1.234" =
// 1234 or 1,234?) the result is ok:false with ambiguous:true, unless the caller
// passes column-level evidence (see detectDecimalSeparator).
//
// Messages are Swedish because they surface verbatim in the import review.

export type NumberKind = "number" | "amount" | "hours" | "percent";

export type ParseNumberResult =
  { ok: true; value: number | null } | { ok: false; reason: string; ambiguous?: boolean };

export type DecimalSeparator = "," | ".";

export interface ParseNumberOptions {
  /**
   * The decimal separator used by the rest of the column. Resolves values that
   * are ambiguous on their own ("1.234" is 1234 when the column uses ",").
   */
  decimalSeparator?: DecimalSeparator;
}

const KIND_LABELS: Record<NumberKind, string> = {
  number: "Tal",
  amount: "Belopp",
  hours: "Timmar",
  percent: "Procent",
};

/** Cell texts that mean "no value". Compared after trim + lowercase. */
const EMPTY_MARKERS = new Set(["", "-", "–", "—", "−", "#n/a", "n/a", "#saknas!", "#saknas"]);

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
/** Characters used as thousands separators: space, NBSP, narrow NBSP, thin/figure/punctuation/hair space. */
const GROUP_SPACE_CLASS = "[ \\u00A0\\u202F\\u2009\\u2007\\u2008\\u200A]";
const GROUP_SPACE = new RegExp(GROUP_SPACE_CLASS, "g");
const HAS_GROUP_SPACE = new RegExp(GROUP_SPACE_CLASS);

/** Hyphen, minus sign, en dash, figure dash, small/full-width hyphen-minus. */
const LEADING_SIGN = /^([+\-−–‒﹣－])\s*(.+)$/u;
const TRAILING_MINUS = /^(.+?)\s*[-−]$/u;
const PARENS = /^\((.+)\)$/u;

interface UnitRule {
  re: RegExp;
  /** Power of ten applied to the value (tkr = 3). */
  exp: number;
  kinds: NumberKind[];
  label: string;
}

// Longest first so "tkr" is not read as "t" + "kr".
const SUFFIX_UNITS: UnitRule[] = [
  { re: /^(.+?)\s*(?:mnkr|mkr|msek|mn kr)$/iu, exp: 6, kinds: ["number", "amount"], label: "mkr" },
  { re: /^(.+?)\s*(?:tkr|tsek|ksek)$/iu, exp: 3, kinds: ["number", "amount"], label: "tkr" },
  {
    re: /^(.+?)\s*(?:kronor|kr\.?|sek|:-|,-|\.-)$/iu,
    exp: 0,
    kinds: ["number", "amount"],
    label: "kr",
  },
  { re: /^(.+?)\s*(?:%|procent)$/iu, exp: 0, kinds: ["percent"], label: "%" },
  { re: /^(.+?)\s*(?:timmar|timme|tim\.?|h)$/iu, exp: 0, kinds: ["hours"], label: "h" },
  { re: /^(.+?)\s*(?:st\.?|stk|styck)$/iu, exp: 0, kinds: ["number"], label: "st" },
];

const PREFIX_UNITS: UnitRule[] = [
  { re: /^(?:sek|kr)\s*(.+)$/iu, exp: 0, kinds: ["number", "amount"], label: "kr" },
];

interface Analysis {
  result: ParseNumberResult;
  /** Decimal separator implied by an unambiguous parse, if any. */
  decimal: DecimalSeparator | null;
}

const fail = (reason: string, ambiguous = false): ParseNumberResult =>
  ambiguous ? { ok: false, reason, ambiguous: true } : { ok: false, reason };

function ambiguousReason(text: string, sep: string): string {
  return `Tvetydigt tal "${text}": oklart om "${sep}" är tusentalsavgränsare eller decimaltecken`;
}

interface BodyParse {
  /** Canonical decimal string ("1234.5"), or null with a failure. */
  canon: string | null;
  decimal: DecimalSeparator | null;
  failure?: ParseNumberResult;
}

/** Parse the bare digits/separators part, e.g. "1.234.567,50". */
function parseBody(body: string, hint: DecimalSeparator | undefined, original: string): BodyParse {
  const bad = (): BodyParse => ({
    canon: null,
    decimal: null,
    failure: fail(`"${original}" är inte ett tal`),
  });
  const ambiguous = (sep: string): BodyParse => ({
    canon: null,
    decimal: null,
    failure: fail(ambiguousReason(original, sep), true),
  });

  // Scientific notation as Excel writes large numbers in CSV ("1,23E+11").
  const sci = /^(\d+)(?:[.,](\d+))?[eE]([+-]?\d+)$/.exec(body);
  if (sci) {
    return { canon: `${sci[1]}.${sci[2] ?? "0"}e${sci[3]}`, decimal: null };
  }

  if (HAS_GROUP_SPACE.test(body)) {
    // Space-grouped thousands: any remaining separator must be the decimal one.
    const unified = body.replace(GROUP_SPACE, " ");
    const m = /^(\d{1,3}(?: \d{3})+)(?:([.,])(\d+))?$/.exec(unified);
    if (!m) return bad();
    const intPart = m[1]!.replace(/ /g, "");
    const sep = (m[2] ?? null) as DecimalSeparator | null;
    if (sep && hint && sep !== hint) return bad();
    return { canon: m[3] ? `${intPart}.${m[3]}` : intPart, decimal: sep };
  }

  if (/^\d+$/.test(body)) return { canon: body, decimal: null };
  const leadingSep = /^([.,])(\d+)$/.exec(body);
  if (leadingSep) {
    const sep = leadingSep[1] as DecimalSeparator;
    if (hint && sep !== hint) return bad();
    return { canon: `0.${leadingSep[2]}`, decimal: sep };
  }

  const hasDot = body.includes(".");
  const hasComma = body.includes(",");
  if (hasDot && hasComma) {
    const dec: DecimalSeparator = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const grp = dec === "," ? "\\." : ",";
    const re = new RegExp(`^(\\d{1,3}(?:${grp}\\d{3})+)\\${dec}(\\d+)$`);
    const m = re.exec(body);
    if (!m) return bad();
    const canon = `${m[1]!.replace(/[.,]/g, "")}.${m[2]}`;
    if (dec === ",") {
      // "1.234.567,50": dot thousands + comma decimal (continental/Swedish convention).
      if (hint === ".") return bad();
      return { canon, decimal: "," };
    }
    // "1,234.50" (English convention) is never assumed in a Swedish file.
    if (hint === ".") return { canon, decimal: "." };
    if (hint === ",") return bad();
    return ambiguous(",");
  }

  const sep: DecimalSeparator | null = hasComma ? "," : hasDot ? "." : null;
  if (!sep) return bad();
  const parts = body.split(sep);
  if (!parts.every((p) => /^\d+$/.test(p))) return bad();
  const other: DecimalSeparator = sep === "," ? "." : ",";

  if (parts.length > 2) {
    // Several separators can only be thousands grouping.
    const grouped = parts.slice(1).every((p) => p.length === 3) && parts[0]!.length <= 3;
    if (!grouped) return bad();
    const canon = parts.join("");
    if (sep === ".") {
      // "1.234.567": dot thousands implies comma decimals.
      if (hint === ".") return bad();
      return { canon, decimal: "," };
    }
    // "1,234,567": English grouping.
    if (hint === ".") return { canon, decimal: "." };
    if (hint === ",") return bad();
    return ambiguous(",");
  }

  const [intPart, frac] = parts as [string, string];
  const canBeThousands = frac.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart);
  if (!canBeThousands) {
    if (hint && hint !== sep) return bad();
    return { canon: `${intPart}.${frac}`, decimal: sep };
  }
  if (hint === sep) return { canon: `${intPart}.${frac}`, decimal: sep };
  if (hint === other) return { canon: `${intPart}${frac}`, decimal: other };
  return ambiguous(sep);
}

/** "8:30" -> 8.5, "7:45:00" -> 7.75, "8 h 30 min" -> 8.5, "45 min" -> 0.75. */
function parseClockHours(s: string): number | null {
  const clock = /^(\d{1,5}):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
  if (clock) {
    return Number(clock[1]) + Number(clock[2]) / 60 + Number(clock[3] ?? 0) / 3600;
  }
  const hm = /^(\d{1,5})\s*(?:h|tim)\s*(\d{1,2})\s*(?:m|min)$/iu.exec(s);
  if (hm && Number(hm[2]) < 60) return Number(hm[1]) + Number(hm[2]) / 60;
  const min = /^(\d{1,6})\s*min$/iu.exec(s);
  if (min) return Number(min[1]) / 60;
  return null;
}

function knownUnitLabel(s: string): string | null {
  for (const rule of SUFFIX_UNITS) if (rule.re.test(s)) return rule.label;
  for (const rule of PREFIX_UNITS) if (rule.re.test(s)) return rule.label;
  return null;
}

function analyze(
  input: string | number | boolean | null | undefined,
  kind: NumberKind,
  opts: ParseNumberOptions,
): Analysis {
  const done = (result: ParseNumberResult, decimal: DecimalSeparator | null = null): Analysis => ({
    result,
    decimal,
  });
  if (input === null || input === undefined) return done({ ok: true, value: null });
  if (typeof input === "number") {
    return done(Number.isFinite(input) ? { ok: true, value: input } : fail("Ogiltigt tal"));
  }
  if (typeof input === "boolean") return done(fail("Sant/falskt är inte ett tal"));

  const original = input.normalize("NFC").replace(ZERO_WIDTH, "").trim();
  if (EMPTY_MARKERS.has(original.toLocaleLowerCase("sv"))) return done({ ok: true, value: null });
  if (/^#[\p{L}\d/]+[!?]?$/u.test(original)) {
    return done(fail(`Felvärde från Excel (${original})`));
  }

  let s = original;
  let negatives = 0;
  let exp = 0;
  let unit: string | null = null;
  let clock: number | null = null;

  for (let guard = 0; guard < 8; guard++) {
    const before = s;
    const paren = PARENS.exec(s);
    if (paren) {
      negatives++;
      s = paren[1]!.trim();
    }
    const lead = LEADING_SIGN.exec(s);
    if (lead) {
      if (lead[1] !== "+") negatives++;
      s = lead[2]!.trim();
    }
    if (kind === "hours") {
      clock = parseClockHours(s);
      if (clock !== null) break;
    }
    if (unit === null) {
      for (const rule of SUFFIX_UNITS) {
        if (!rule.kinds.includes(kind)) continue;
        const m = rule.re.exec(s);
        if (m) {
          unit = rule.label;
          exp = rule.exp;
          s = m[1]!.trim();
          break;
        }
      }
    }
    if (unit === null) {
      for (const rule of PREFIX_UNITS) {
        if (!rule.kinds.includes(kind)) continue;
        const m = rule.re.exec(s);
        if (m) {
          unit = rule.label;
          exp = rule.exp;
          s = m[1]!.trim();
          break;
        }
      }
    }
    const trail = TRAILING_MINUS.exec(s);
    if (trail) {
      negatives++;
      s = trail[1]!.trim();
    }
    if (s === before) break;
  }

  if (negatives > 1) return done(fail(`Flera minustecken i "${original}"`));

  let value: number;
  let decimal: DecimalSeparator | null = null;
  if (clock !== null) {
    value = clock;
  } else {
    const scientific = /^\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(s);
    if (!scientific && (!/^[\d.,\s   - ]+$/u.test(s) || !/\d/.test(s))) {
      const foreign = knownUnitLabel(s);
      if (foreign) return done(fail(`Enheten "${foreign}" passar inte typen ${KIND_LABELS[kind]}`));
      return done(fail(`"${original}" är inte ett tal`));
    }
    const body = parseBody(s, opts.decimalSeparator, original);
    if (body.failure || body.canon === null) {
      return done(body.failure ?? fail(`"${original}" är inte ett tal`));
    }
    // Scale through the decimal string ("1.2e3") so tkr/mkr add no float noise.
    value = body.canon.includes("e")
      ? Number(body.canon) * 10 ** exp
      : Number(exp ? `${body.canon}e${exp}` : body.canon);
    decimal = body.decimal;
    if (!Number.isFinite(value)) return done(fail(`"${original}" är inte ett tal`));
  }
  if (negatives === 1) value = -value;
  if (Object.is(value, -0)) value = 0;
  return done({ ok: true, value }, decimal);
}

/**
 * Parse a cell as a number of the given kind.
 * - empty, "-", "–", "—", "−", "#N/A", "N/A" -> ok null
 * - "1 234 567,50" (space/NBSP/thin space thousands), "1.234.567,50", "1234,5", "1234.5"
 * - "1,234.50", "1.234", "1,234" -> ambiguous unless opts.decimalSeparator decides
 * - negatives: "-1", "−1", "–1", "1 200-", "(1 200)"
 * - units: kr/SEK/":-" (amount, number), tkr ×1000, mkr ×1e6, % (percent, kept in
 *   percent units), h/tim/timmar and "h:mm" (hours). Excel time fractions are
 *   numbers and pass through unchanged; the caller decides how to read them.
 */
export function parseNumberSv(
  input: string | number | boolean | null | undefined,
  kind: NumberKind,
  opts: ParseNumberOptions = {},
): ParseNumberResult {
  return analyze(input, kind, opts).result;
}

/**
 * Infer the decimal separator of a column from its unambiguous values
 * ("1 234,50" proves ","; "1234.5" proves "."). null when there is no evidence
 * or the evidence conflicts.
 */
export function detectDecimalSeparator(
  values: Iterable<unknown>,
  kind: NumberKind = "number",
): DecimalSeparator | null {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const { decimal } = analyze(v, kind, {});
    if (decimal === ",") comma++;
    else if (decimal === ".") dot++;
  }
  if (comma > 0 && dot === 0) return ",";
  if (dot > 0 && comma === 0) return ".";
  return null;
}
