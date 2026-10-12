// Text decoding for CSV/HTML exports. Swedish systems export UTF-8 (with or
// without BOM), Windows-1252 ("ANSI" from Excel) and occasionally UTF-16
// ("Unicode text" from Excel). CP437 (SIE files) is handled by the SIE module.

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

/** Bytes inspected by the UTF-16 heuristic. */
const SNIFF_BYTES = 4096;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * UTF-16 without BOM: mostly-ASCII text has a zero byte in every other
 * position (odd positions for LE, even for BE). Returns null when unsure.
 */
function sniffUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length, SNIFF_BYTES) & ~1;
  if (n < 4) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) zeroEven++;
    if (bytes[i + 1] === 0) zeroOdd++;
  }
  const pairs = n / 2;
  if (zeroOdd / pairs > 0.3 && zeroEven / pairs < 0.05) return "utf-16le";
  if (zeroEven / pairs > 0.3 && zeroOdd / pairs < 0.05) return "utf-16be";
  return null;
}

// Windows-1252 bytes 0x80–0x9F (WHATWG index). Node's TextDecoder treats
// "windows-1252" as ISO-8859-1 there, browsers do not; decoding by hand keeps
// "–" (0x96, used as minus/empty) and "€" identical everywhere.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function decodeCp1252(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let out = "";
  const codes = new Array<number>(Math.min(CHUNK, bytes.length));
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    codes.length = end - start;
    for (let i = start; i < end; i++) {
      const b = bytes[i]!;
      codes[i - start] = b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80]! : b;
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

function decodeWith(encoding: TextEncodingName, bytes: Uint8Array, fatal = false): string {
  if (encoding === "windows-1252") return decodeCp1252(bytes);
  return new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(bytes);
}

/** Detect the encoding of a text file and decode it, without a BOM in the result. */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: stripBom(decodeWith("utf-8", bytes.subarray(3))), encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: stripBom(decodeWith("utf-16le", bytes.subarray(2))), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: stripBom(decodeWith("utf-16be", bytes.subarray(2))), encoding: "utf-16be" };
  }
  const utf16 = sniffUtf16(bytes);
  if (utf16) return { text: stripBom(decodeWith(utf16, bytes)), encoding: utf16 };
  try {
    return { text: stripBom(decodeWith("utf-8", bytes, true)), encoding: "utf-8" };
  } catch {
    // Not valid UTF-8: Windows-1252 decodes every byte, which is what Excel's
    // "CSV (semikolonavgränsad)" writes on Swedish Windows.
    return { text: stripBom(decodeWith("windows-1252", bytes)), encoding: "windows-1252" };
  }
}
