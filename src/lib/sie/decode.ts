// Text decoding for SIE files. The SIE 4 spec mandates "#FORMAT PC8" (IBM code
// page 437), but real exports are sometimes Windows-1252 or UTF-8 while still
// declaring PC8. We decode with every candidate and pick the one whose result
// looks like Swedish accounting text: many å/ä/ö/é, no box drawing, Greek
// letters, C1 controls or Windows-1252 typographic marks (which is what å/ä/ö
// turn into under the wrong code page).
import { decodeCp437 } from "@/lib/core/cp437";
import { decodeWindows1252 } from "./windows1252";

export type SieEncoding = "cp437" | "windows-1252" | "utf-8";

export interface EncodingScore {
  encoding: SieEncoding;
  /** false when the bytes are not valid in this encoding (only possible for UTF-8). */
  valid: boolean;
  plausible: number;
  implausible: number;
  score: number;
}

export interface DecodedSie {
  text: string;
  encoding: SieEncoding;
  /** #FORMAT value as written in the file (quotes removed), or null when absent. */
  declaredFormat: string | null;
  /** Swedish, shown to the user in the review step. */
  warnings: string[];
  scores: EncodingScore[];
}

export const ENCODING_LABELS: Record<SieEncoding, string> = {
  cp437: "PC8 (IBM 437)",
  "windows-1252": "Windows-1252",
  "utf-8": "UTF-8",
};

const PLAUSIBLE = new Set("åäöÅÄÖé");

// What Swedish letters become under the wrong code page: CP437 bytes read as
// Windows-1252 give †„”‚Ž™ (and C1 controls); Windows-1252 bytes read as CP437
// give σΣ÷┼─╓Θ; UTF-8 read as Windows-1252 gives Ã¥ / Â.
const IMPLAUSIBLE = new Set("†‡„“”‚‰Š‹ŒŽ™š›œžŸ•˜ˆƒαΓπΣστΦΘΩδφε∞∩≡≥≤⌠⌡≈∙√ⁿ■₧⌐÷ÃÂ");

const FORMAT_ENCODINGS: Record<string, SieEncoding> = {
  PC8: "cp437",
  "UTF-8": "utf-8",
  UTF8: "utf-8",
  ANSI: "windows-1252",
  "WINDOWS-1252": "windows-1252",
  WINDOWS1252: "windows-1252",
  CP1252: "windows-1252",
};

/** Order used to break score ties after the declared encoding. */
const TIE_ORDER: SieEncoding[] = ["cp437", "utf-8", "windows-1252"];

export function scoreText(text: string): { plausible: number; implausible: number } {
  let plausible = 0;
  let implausible = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) continue;
    if (PLAUSIBLE.has(char)) plausible++;
    else if (
      (cp >= 0x80 && cp <= 0x9f) ||
      (cp >= 0x2500 && cp <= 0x259f) ||
      cp === 0xfffd ||
      IMPLAUSIBLE.has(char)
    ) {
      implausible++;
    }
  }
  return { plausible, implausible };
}

/** Reads the #FORMAT value from the raw bytes (the line itself is always ASCII). */
export function readDeclaredFormat(bytes: Uint8Array): string | null {
  const head = decodeCp437(bytes.subarray(0, 65536));
  const m = /^[ \t]*#FORMAT[ \t]+("((?:[^"\\\r\n]|\\.)*)"|[^\s]+)/im.exec(head);
  if (!m) return null;
  const value = m[2] ?? m[1] ?? "";
  return value.replace(/\\"/g, '"').trim() || null;
}

export function encodingForFormat(format: string): SieEncoding | null {
  return FORMAT_ENCODINGS[format.trim().toUpperCase()] ?? null;
}

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function decodeSie(bytes: Uint8Array): DecodedSie {
  const warnings: string[] = [];
  const bom = hasUtf8Bom(bytes);
  const body = bom ? bytes.subarray(3) : bytes;
  const declaredFormat = readDeclaredFormat(body);
  const declaredEncoding = declaredFormat ? encodingForFormat(declaredFormat) : null;

  const texts: Record<SieEncoding, string | null> = {
    "utf-8": tryUtf8(body),
    cp437: decodeCp437(body),
    "windows-1252": decodeWindows1252(body),
  };

  const scores: EncodingScore[] = (Object.keys(texts) as SieEncoding[]).map((encoding) => {
    const text = texts[encoding];
    if (text === null) {
      return { encoding, valid: false, plausible: 0, implausible: 0, score: -Infinity };
    }
    const { plausible, implausible } = scoreText(text);
    return { encoding, valid: true, plausible, implausible, score: plausible - 2 * implausible };
  });

  const preference = [
    ...(declaredEncoding ? [declaredEncoding] : []),
    ...TIE_ORDER.filter((e) => e !== declaredEncoding),
  ];
  const rank = (e: SieEncoding) => preference.indexOf(e);
  const valid = scores.filter((s) => s.valid);
  // A UTF-8 byte order mark is decisive when the bytes are valid UTF-8.
  const utf8 = valid.find((s) => s.encoding === "utf-8");
  const best =
    bom && utf8
      ? utf8
      : [...valid].sort((a, b) => b.score - a.score || rank(a.encoding) - rank(b.encoding))[0];
  // cp437 is always valid, so `best` exists; the fallback only satisfies the type checker.
  const encoding: SieEncoding = best?.encoding ?? "cp437";
  const text = texts[encoding] ?? texts.cp437 ?? "";

  const label = ENCODING_LABELS[encoding];
  if (declaredFormat === null) {
    warnings.push(`Filen saknar #FORMAT. Teckenkodningen har identifierats som ${label}.`);
  } else if (declaredEncoding === null) {
    warnings.push(
      `Okänt #FORMAT "${declaredFormat}". Teckenkodningen har identifierats som ${label}.`,
    );
  } else if (declaredEncoding !== encoding && texts[declaredEncoding] !== text) {
    warnings.push(
      `Filen anger #FORMAT ${declaredFormat} men är kodad som ${label}. ` +
        `Tecknen har tolkats som ${label}.`,
    );
  }
  if (best && best.score < 0) {
    warnings.push(
      "Teckenkodningen kunde inte fastställas säkert. Kontrollera å, ä och ö i konto- och objektnamnen.",
    );
  }

  return { text, encoding, declaredFormat, warnings, scores };
}
