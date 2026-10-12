// IBM code page 437 ("PC8" in SIE files). Fortnox and most Swedish accounting
// programs write SIE4 in this DOS code page, where å is 0x86, ä 0x84 and ö 0x94.
// WHATWG TextDecoder does not support it, so the table lives here. Bytes
// 0x00-0x7F decode to ASCII (control characters stay control characters, as in
// the Unicode consortium's CP437.TXT mapping), so tabs and line breaks survive.

/** Unicode code points for bytes 0x80-0xFF. */
// prettier-ignore
const CP437_HIGH: readonly number[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, // 0x80
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5, // 0x88
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9, // 0x90
  0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192, // 0x98
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba, // 0xA0
  0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb, // 0xA8
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, // 0xB0
  0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510, // 0xB8
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f, // 0xC0
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, // 0xC8
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b, // 0xD0
  0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580, // 0xD8
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4, // 0xE0
  0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229, // 0xE8
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248, // 0xF0
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0, // 0xF8
];

/** The full 256-entry table: index = byte, value = the decoded character. */
export const CP437_TABLE: readonly string[] = Array.from({ length: 256 }, (_, byte) =>
  String.fromCharCode(byte < 0x80 ? byte : (CP437_HIGH[byte - 0x80] ?? 0xfffd)),
);

const ENCODE_MAP: ReadonlyMap<string, number> = new Map(
  CP437_TABLE.map((char, byte) => [char, byte] as const),
);

export function decodeCp437(bytes: Uint8Array): string {
  // Chunked join keeps memory flat for multi-megabyte SIE files.
  const parts: string[] = [];
  const chunk = 8192;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length);
    let s = "";
    for (let i = start; i < end; i++) s += CP437_TABLE[bytes[i] as number];
    parts.push(s);
  }
  return parts.join("");
}

/** True when every character of `text` exists in code page 437. */
export function isCp437Encodable(text: string): boolean {
  for (const char of text) if (!ENCODE_MAP.has(char)) return false;
  return true;
}

/**
 * Encode text as CP437 (used to build SIE test files). Throws on characters
 * that do not exist in the code page instead of silently writing "?".
 */
export function encodeCp437(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const char of text) {
    const byte = ENCODE_MAP.get(char);
    if (byte === undefined) {
      const cp = char.codePointAt(0) ?? 0;
      throw new RangeError(
        `Character U+${cp.toString(16).toUpperCase().padStart(4, "0")} cannot be encoded as CP437`,
      );
    }
    out[n++] = byte;
  }
  return out.subarray(0, n);
}
