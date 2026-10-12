// Personal data guards for SIE ingest. Personnummer must never leave the
// browser (CLAUDE.md data rules), yet SIE files can carry them: #ORGNR of a sole
// trader, object codes of an "Anställd" dimension, free text that ends up in
// parse issues. Everything ingest returns passes through these helpers.
//
// Deliberately broader than the database trigger (no Luhn check): masking a
// mistyped personnummer or an odd reference number is harmless, storing a real
// one is not. Organisation numbers never match because their month digits are
// 20 or more.

// [CC]YYMMDD, optional "-" or "+", four digits; not part of a longer number.
const PNR_RE = /(?<!\d)(\d{2})?(\d{2})(\d{2})(\d{2})[-+]?\d{4}(?!\d)/g;

/** Shown in place of a personnummer. */
export const PNR_MASK = "ÅÅMMDD-XXXX";

function isBirthDate(century: string | undefined, yy: string, mm: string, dd: string): boolean {
  if (century !== undefined && century !== "18" && century !== "19" && century !== "20") {
    return false;
  }
  const month = Number(mm);
  let day = Number(dd);
  if (day > 60) day -= 60; // samordningsnummer
  if (month < 1 || month > 12 || day < 1) return false;
  // Without a century 29 February must pass (00 may be 1900 or 2000), so use a leap year.
  const year = century === undefined ? 2000 : Number(century + yy);
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function personnummerMatches(text: string): RegExpExecArray[] {
  return [...text.matchAll(PNR_RE)].filter((m) =>
    isBirthDate(m[1], m[2] as string, m[3] as string, m[4] as string),
  );
}

/** True when `text` contains something shaped like a personnummer or samordningsnummer. */
export function containsPersonnummer(text: string): boolean {
  return personnummerMatches(text).length > 0;
}

/** Replaces every personnummer-shaped number in `text` with PNR_MASK. */
export function maskPersonnummer(text: string): string {
  let out = "";
  let last = 0;
  for (const m of personnummerMatches(text)) {
    out += text.slice(last, m.index) + PNR_MASK;
    last = m.index + m[0].length;
  }
  return last === 0 ? text : out + text.slice(last);
}

// SIE 4B reserves dimension 7 for "Anställd"; other dimensions are judged by their #DIM name.
const PERSONAL_DIM_NAME = /anst[äa]lld|konsult|medarbetare/i;

/** Dimensions whose objects are people. They never become ledger rows or objects. */
export function isPersonalDimension(dimNo: number, name: string | undefined): boolean {
  return dimNo === 7 || (name !== undefined && PERSONAL_DIM_NAME.test(name));
}
