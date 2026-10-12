// Personal data guards for SIE ingest. Personnummer must never leave the
// browser (CLAUDE.md data rules), yet SIE files can carry them: #ORGNR of a sole
// trader, object codes of an "Anställd" dimension, free text that ends up in
// parse issues. Everything ingest returns passes through these helpers.
//
// Shapes, separators ("-", "+", space, no-break space) and the birth-date rule come
// from src/lib/core/pnr.ts. Deliberately broader than that module and the database
// trigger: no Luhn check, because masking a mistyped personnummer or an odd reference
// number is harmless and storing a real one is not. Organisation numbers never match
// because their month digits are 20 or more.
import {
  PNR_PLACEHOLDER,
  hasValidBirthDate,
  personnummerParts,
  personnummerScanner,
} from "@/lib/core/pnr";

/** Shown in place of a personnummer. */
export const PNR_MASK = PNR_PLACEHOLDER;

function personnummerMatches(text: string): RegExpExecArray[] {
  if (!/\d{6}/.test(text)) return [];
  return [...text.matchAll(personnummerScanner())].filter((m) => {
    const parts = personnummerParts(m[0]);
    return parts !== null && hasValidBirthDate(parts);
  });
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
