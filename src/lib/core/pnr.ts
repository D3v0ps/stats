// Detection of Swedish personal identity numbers and other personal data in
// imported columns. Personnummer must never leave the browser: columns that
// contain them are removed and can't be re-enabled, and aggregation refuses to
// produce facts from them. The DB trigger repeats the personnummer check.

import { normalizeHeader } from "./normalize";

export type PersonalKind = "pnr" | "name" | "email" | "phone" | "address" | "birthdate";

export interface PersonalDetection {
  kind: PersonalKind | null;
  /** 0..1 */
  confidence: number;
}

/** Luhn (mod 10) check over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Characters allowed between the birth date and the serial: "-", "+" (100 years or
 * older), a space, a no-break space or a narrow no-break space ("811218 9876", as typed
 * in forms or produced by number formatting).
 */
export const PNR_SEPARATORS = "-+ \u00A0\u202F";
const SEP = `[${PNR_SEPARATORS}]`;

const PNR_RE = new RegExp(`^(\\d{2})?(\\d{2})(\\d{2})(\\d{2})${SEP}?(\\d{4})$`);

export interface PersonnummerParts {
  /** "19"/"20" (or anything else) for 12-digit forms; undefined for 10 digits. */
  century: string | undefined;
  yy: string;
  mm: string;
  dd: string;
  serial: string;
}

/** Split a personnummer-shaped string (no other text around it) into its parts. */
export function personnummerParts(input: string): PersonnummerParts | null {
  const m = PNR_RE.exec(input.trim());
  if (!m) return null;
  return { century: m[1], yy: m[2]!, mm: m[3]!, dd: m[4]!, serial: m[5]! };
}

/**
 * The birth date exists (day + 60 for samordningsnummer) and a written century is
 * 18, 19 or 20. Organisation numbers fail here: their month digits are 20 or more.
 */
export function hasValidBirthDate(p: PersonnummerParts): boolean {
  if (p.century !== undefined && !["18", "19", "20"].includes(p.century)) return false;
  const month = Number(p.mm);
  let day = Number(p.dd);
  if (day > 60) day -= 60;
  // Without a century the leap-day check must accept either century.
  const years = p.century ? [Number(p.century + p.yy)] : [1900 + Number(p.yy), 2000 + Number(p.yy)];
  return years.some((y) => isRealDate(y, month, day));
}

/**
 * Personnummer or samordningsnummer: YYMMDD-NNNN, YYMMDD+NNNN, YYMMDD NNNN, YYMMDDNNNN,
 * YYYYMMDD-NNNN, YYYYMMDD NNNN or YYYYMMDDNNNN (a no-break space counts as a space). The
 * date must exist (day + 60 for samordningsnummer) and the last ten digits must pass
 * Luhn. Organisation numbers have month digits >= 20 and are therefore never matched.
 */
export function isPersonnummer(input: string): boolean {
  const p = personnummerParts(input);
  if (!p || !hasValidBirthDate(p)) return false;
  return luhnValid(`${p.yy}${p.mm}${p.dd}${p.serial}`);
}

/**
 * Swedish organisation number: 10 digits (optionally "16" prefix or a dash
 * after six digits) with the third and fourth digit >= 20, passing Luhn.
 */
export function isOrgNr(input: string): boolean {
  const m = /^(?:16)?(\d{6})-?(\d{4})$/.exec(input.trim());
  if (!m) return false;
  const digits = `${m[1]}${m[2]}`;
  if (Number(digits.slice(2, 4)) < 20) return false;
  return luhnValid(digits);
}

// Digit runs that could be a personnummer, allowing the usual separators.
const PNR_SCAN_SOURCE = `(?<!\\d)(?:\\d{6}|\\d{8})${SEP}?\\d{4}(?!\\d)`;

/** A fresh global regex finding personnummer-shaped digit runs (no date or Luhn check). */
export function personnummerScanner(): RegExp {
  return new RegExp(PNR_SCAN_SOURCE, "g");
}

const PNR_SCAN = personnummerScanner();

/** True when the text contains at least one valid personnummer/samordningsnummer. */
export function containsPersonnummer(text: string): boolean {
  if (!/\d{6}/.test(text)) return false;
  for (const m of text.matchAll(PNR_SCAN)) {
    if (isPersonnummer(m[0])) return true;
  }
  return false;
}

/** Written instead of a personnummer in texts that leave the browser (reports, file names). */
export const PNR_PLACEHOLDER = "ÅÅMMDD-XXXX";

/** Replace every valid personnummer/samordningsnummer in a text with PNR_PLACEHOLDER. */
export function redactPersonnummer(text: string): string {
  if (!/\d{6}/.test(text)) return text;
  return text.replace(PNR_SCAN, (m) => (isPersonnummer(m) ? PNR_PLACEHOLDER : m));
}

/** containsPersonnummer for any cell value (numbers are checked as digit strings). */
export function valueContainsPersonnummer(value: unknown): boolean {
  if (typeof value === "string") return containsPersonnummer(value);
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return containsPersonnummer(String(value));
  }
  return false;
}

/**
 * A 9-digit integer as "0" + digits: Excel drops the leading zero when a
 * 10-digit personnummer of someone born 2000–2009 lands in a number cell.
 */
function zeroPadded(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1e8 && value < 1e9 ? `0${value}` : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    return /^\d{9}$/.test(t) ? `0${t}` : null;
  }
  return null;
}

const isZeroLostPersonnummer = (value: unknown): boolean => {
  const padded = zeroPadded(value);
  return padded !== null && isPersonnummer(padded);
};

/** Share of non-empty values that must be personnummer before a column counts as one. */
const PNR_SHARE = 0.3;

/**
 * True when a column holds personnummer: any value with a 10/12-digit
 * personnummer, or >= 30 % of the values being 9-digit numbers that are
 * personnummer with the leading zero restored. The share keeps 9-digit id
 * columns, where an occasional value passes the check by chance, usable.
 */
export function columnContainsPersonnummer(values: Iterable<unknown>): boolean {
  let nonEmpty = 0;
  let zeroLost = 0;
  for (const v of values) {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) continue;
    if (valueContainsPersonnummer(v)) return true;
    nonEmpty++;
    if (isZeroLostPersonnummer(v)) zeroLost++;
  }
  return zeroLost > 0 && zeroLost / nonEmpty >= PNR_SHARE;
}

// ---- Column classification -------------------------------------------------

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/iu;
// Swedish numbers: trunk 0 (or +46/0046) followed by a non-zero area/mobile prefix.
const PHONE_RE = /^(?:\+46|0046|0)[\s\-–()]*[1-9](?:[\s\-–()]*\d){6,10}$/u;
const POSTAL_RE = /^(?:se-)?\d{3}\s?\d{2}(?:\s+\p{L}[\p{L}\s-]*)?$/iu;
const STREET_RE =
  /^\p{L}[\p{L}\s.-]*(?:gatan|gata|vägen|väg|gränd|torget|torg|plan|allén|allé|backe|backen|stigen|leden|stråket|esplanaden|promenaden)\s+\d+\s*\p{L}?(?:\s|,|$)/iu;
const PERSON_NAME_RE =
  /^\p{Lu}[\p{Ll}'’-]+(?:[ -]\p{Lu}[\p{Ll}'’-]+)*(?:, ?| )\p{Lu}[\p{Ll}'’-]+(?:[ -]\p{Lu}[\p{Ll}'’-]+)*$/u;

type Rule = { kind: PersonalKind; re: RegExp; confidence: number };

// Header keyword rules, checked against the normalized header.
const HEADER_RULES: Rule[] = [
  {
    kind: "pnr",
    re: /(?:^|[^\p{L}])(?:personnummer|personnr|person nr|pers\.? ?nr|pnr|ssn|samordningsnummer|social security|personal (?:id|identity) number)(?:$|[^\p{L}])/u,
    confidence: 0.95,
  },
  {
    kind: "birthdate",
    re: /(?:födelsedatum|födelsedag|födelseår|^född$|birth ?date|date of birth|^dob$|birthday)/u,
    confidence: 0.9,
  },
  {
    kind: "email",
    re: /(?:e-post|epost|e-mail|email|^mail$|mailadress|mejl|e-postadress)/u,
    confidence: 0.9,
  },
  {
    kind: "phone",
    re: /(?:telefon|mobil|(?:^|[^\p{L}])tel(?:\.|$|[^\p{L}])|tel\.?nr|phone|mobile|(?:^|[^\p{L}])cell(?:$|[^\p{L}]))/u,
    confidence: 0.9,
  },
  {
    kind: "address",
    re: /(?:adress|address|postnummer|postnr|post nr|postort|c\/o|(?:^|[^\p{L}])co(?:$|[^\p{L}])|street|zip ?code|^zip$)/u,
    confidence: 0.85,
  },
  {
    kind: "name",
    re: /(?:(?:^|[^\p{L}])(?:namn|name)(?:$|[^\p{L}])|förnamn|efternamn|tilltalsnamn|mellannamn|konsultnamn|deltagarnamn|personnamn|anställds namn|first ?name|last ?name|surname|full ?name|kontaktperson|handläggare)/u,
    confidence: 0.85,
  },
];

// Qualifiers that make a name/address header about an organisation, not a person.
const ORG_QUALIFIER =
  /(?:kund|företag|bolag|uppdrag|projekt|konto|enhet|arbetsställe|arbetsplats|leverans|faktura|(?:^|[^\p{L}])(?:ort|fil|org|site)(?:$|[^\p{L}])|tjänst|artikel|produkt|objekt|kostnadsställe|organisation|avdelning|program|verksamhet|customer|company|project|account|client)/u;

// Ids that identify a person only together with other systems. Not personal by default.
const NON_PERSONAL_ID =
  /(?:anställnings ?-?id|anställningsnummer|anst\.? ?nr|(?:^|[^\p{L}])gen(?:[- ]?(?:nummer|nr))?(?:$|[^\p{L}])|referens|ref ?nr|^id$|konsult ?-?id|deltagar ?-?id|kundnummer|uppdragsnummer)/u;

// Headers under which personal names commonly appear without saying "namn".
const PERSON_HINT =
  /^(?:konsult|deltagare|anställd|medarbetare|person|kandidat|arbetstagare|employee|participant|handläggare)$/u;

function ratio(samples: string[], test: (s: string) => boolean): number {
  if (samples.length === 0) return 0;
  return samples.filter(test).length / samples.length;
}

/**
 * Classify a column as personal data from its header and sample values.
 * - pnr: header keyword, or >= 30 % of non-empty samples are personnummer
 *   (also 9-digit ones that lost their leading zero in Excel; values win over
 *   the header: "Anställnings-id" holding personnummer is pnr)
 * - email/phone/address: header keyword or >= 50 % of samples match
 * - name: header keyword, or a person-ish header ("Konsult") with name-like values
 * - birthdate: header keyword only
 * Anställnings-id, GEN and other internal ids are not personal by default.
 */
export function detectPersonalColumn(header: string, samples: string[]): PersonalDetection {
  const h = normalizeHeader(header);
  const values = samples.map((s) => String(s).trim()).filter((s) => s !== "");

  const pnrShare = ratio(values, (s) => containsPersonnummer(s) || isZeroLostPersonnummer(s));
  if (pnrShare >= PNR_SHARE) return { kind: "pnr", confidence: Math.max(0.8, pnrShare) };

  const headerRule = HEADER_RULES.find((rule) => rule.re.test(h));
  if (headerRule?.kind === "pnr") return { kind: "pnr", confidence: headerRule.confidence };

  const idLike = NON_PERSONAL_ID.test(h);
  const orgQualified = ORG_QUALIFIER.test(h);

  if (headerRule && !idLike) {
    const qualifies =
      (headerRule.kind !== "name" && headerRule.kind !== "address") || !orgQualified;
    if (qualifies) return { kind: headerRule.kind, confidence: headerRule.confidence };
  }

  const emailShare = ratio(values, (s) => EMAIL_RE.test(s));
  if (emailShare >= 0.5) return { kind: "email", confidence: Math.min(0.95, 0.5 + emailShare / 2) };

  const phoneShare = ratio(values, (s) => PHONE_RE.test(s));
  if (phoneShare >= 0.5 && !idLike) {
    return { kind: "phone", confidence: Math.min(0.9, 0.4 + phoneShare / 2) };
  }

  const addressShare = ratio(values, (s) => POSTAL_RE.test(s) || STREET_RE.test(s));
  if (addressShare >= 0.5 && !orgQualified && !idLike) {
    return { kind: "address", confidence: Math.min(0.85, 0.35 + addressShare / 2) };
  }

  if (PERSON_HINT.test(h)) {
    const nameShare = ratio(values, (s) => PERSON_NAME_RE.test(s));
    if (nameShare >= 0.5) return { kind: "name", confidence: Math.min(0.85, 0.35 + nameShare / 2) };
  }

  return { kind: null, confidence: 0 };
}
