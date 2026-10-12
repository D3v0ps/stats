// Windows-1252 as defined by the WHATWG Encoding Standard: Latin-1 except for
// 0x80-0x9F, where five undefined bytes decode to the C1 control with the same
// value. Kept local (instead of TextDecoder) so decoding never depends on the
// ICU data bundled with the runtime.

// prettier-ignore
const HIGH_C1: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, // 0x80
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, // 0x88
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, // 0x90
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178, // 0x98
];

function codePointFor(byte: number): number {
  return byte >= 0x80 && byte < 0xa0 ? (HIGH_C1[byte - 0x80] ?? byte) : byte;
}

export function decodeWindows1252(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = 8192;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(start + chunk, bytes.length);
    let s = "";
    for (let i = start; i < end; i++) s += String.fromCharCode(codePointFor(bytes[i] as number));
    parts.push(s);
  }
  return parts.join("");
}

const ENCODE_MAP: ReadonlyMap<number, number> = new Map(
  Array.from({ length: 256 }, (_, byte) => [codePointFor(byte), byte] as const),
);

/** Encode text as Windows-1252 (test helper). Throws on unmappable characters. */
export function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const byte = ENCODE_MAP.get(cp);
    if (byte === undefined) {
      throw new RangeError(
        `Character U+${cp.toString(16).toUpperCase().padStart(4, "0")} cannot be encoded as Windows-1252`,
      );
    }
    out[n++] = byte;
  }
  return out.subarray(0, n);
}
