import { describe, expect, it } from "vitest";
import { decodeText } from "./encoding";

const utf8 = (s: string) => new TextEncoder().encode(s);

function utf16(s: string, endian: "le" | "be", bom = false): Uint8Array {
  const out: number[] = bom ? (endian === "le" ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (endian === "le") out.push(c & 0xff, c >> 8);
    else out.push(c >> 8, c & 0xff);
  }
  return new Uint8Array(out);
}

const SAMPLE = "Kund;Ort;Timmar\nÅkesson AB;Malmö;8,5\nÄngby Bygg;Göteborg;7\n";

describe("decodeText", () => {
  it("decodes UTF-8 with BOM and strips the BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SAMPLE)]);
    expect(decodeText(bytes)).toEqual({ text: SAMPLE, encoding: "utf-8" });
  });

  it("decodes plain UTF-8", () => {
    expect(decodeText(utf8(SAMPLE))).toEqual({ text: SAMPLE, encoding: "utf-8" });
  });

  it("falls back to Windows-1252 for åäö bytes that are not UTF-8", () => {
    // "Kö;Malmö;Åre;€" in Windows-1252
    const bytes = new Uint8Array([
      0x4b, 0xf6, 0x3b, 0x4d, 0x61, 0x6c, 0x6d, 0xf6, 0x3b, 0xc5, 0x72, 0x65, 0x3b, 0x80,
    ]);
    expect(decodeText(bytes)).toEqual({ text: "Kö;Malmö;Åre;€", encoding: "windows-1252" });
  });

  it("maps the Windows-1252 range 0x80–0x9F like browsers do", () => {
    // "–12" with an en dash (0x96), smart quotes 0x93/0x94, ellipsis 0x85
    const bytes = new Uint8Array([0x96, 0x31, 0x32, 0x3b, 0x93, 0x78, 0x94, 0x85, 0xe5]);
    expect(decodeText(bytes).text).toBe("–12;“x”…å");
  });

  it("decodes large Windows-1252 input in chunks", () => {
    const bytes = new Uint8Array(20_000).fill(0xe4);
    const { text, encoding } = decodeText(bytes);
    expect(encoding).toBe("windows-1252");
    expect(text).toBe("ä".repeat(20_000));
  });

  it("decodes UTF-16LE with BOM", () => {
    expect(decodeText(utf16(SAMPLE, "le", true))).toEqual({ text: SAMPLE, encoding: "utf-16le" });
  });

  it("decodes UTF-16LE without BOM by zero-byte heuristics", () => {
    expect(decodeText(utf16(SAMPLE, "le"))).toEqual({ text: SAMPLE, encoding: "utf-16le" });
  });

  it("decodes UTF-16BE with and without BOM", () => {
    expect(decodeText(utf16(SAMPLE, "be", true))).toEqual({ text: SAMPLE, encoding: "utf-16be" });
    expect(decodeText(utf16(SAMPLE, "be"))).toEqual({ text: SAMPLE, encoding: "utf-16be" });
  });

  it("handles empty input and pure ASCII", () => {
    expect(decodeText(new Uint8Array())).toEqual({ text: "", encoding: "utf-8" });
    expect(decodeText(utf8("a;b"))).toEqual({ text: "a;b", encoding: "utf-8" });
  });

  it("does not mistake UTF-8 for UTF-16", () => {
    expect(decodeText(utf8("Åre;Öland;Ystad\n1;2;3\n")).encoding).toBe("utf-8");
  });
});
