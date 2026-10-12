import { describe, expect, it } from "vitest";
import { CP437_TABLE, decodeCp437, encodeCp437, isCp437Encodable } from "./cp437";

describe("CP437 table", () => {
  it("has 256 distinct entries", () => {
    expect(CP437_TABLE).toHaveLength(256);
    expect(new Set(CP437_TABLE).size).toBe(256);
    for (const char of CP437_TABLE) expect(char).toHaveLength(1);
  });

  it("maps the low half to ASCII, keeping control characters", () => {
    for (let b = 0; b < 0x80; b++) expect(CP437_TABLE[b]).toBe(String.fromCharCode(b));
    expect(decodeCp437(new Uint8Array([0x09, 0x0d, 0x0a]))).toBe("\t\r\n");
  });

  it.each([
    [0x80, "Ç"],
    [0x81, "ü"],
    [0x82, "é"],
    [0x84, "ä"],
    [0x86, "å"],
    [0x8e, "Ä"],
    [0x8f, "Å"],
    [0x90, "É"],
    [0x94, "ö"],
    [0x99, "Ö"],
    [0x9a, "Ü"],
    [0x9b, "¢"],
    [0x9e, "₧"],
    [0x9f, "ƒ"],
    [0xa5, "Ñ"],
    [0xb0, "░"],
    [0xb3, "│"],
    [0xc4, "─"],
    [0xc5, "┼"],
    [0xcd, "═"],
    [0xdb, "█"],
    [0xe0, "α"],
    [0xe1, "ß"],
    [0xe4, "Σ"],
    [0xe5, "σ"],
    [0xe6, "µ"],
    [0xe9, "Θ"],
    [0xf6, "÷"],
    [0xf8, "°"],
    [0xfd, "²"],
    [0xfe, "■"],
    [0xff, " "],
  ])("decodes byte %i to %s", (byte, char) => {
    expect(decodeCp437(new Uint8Array([byte]))).toBe(char);
  });
});

describe("decodeCp437 / encodeCp437", () => {
  it("decodes Swedish account names", () => {
    const bytes = new Uint8Array([
      0x46, 0x94, 0x72, 0x73, 0x84, 0x6c, 0x6a, 0x6e, 0x69, 0x6e, 0x67, 0x20, 0x8f, 0x8e, 0x99,
      0x86,
    ]);
    expect(decodeCp437(bytes)).toBe("Försäljning ÅÄÖå");
  });

  it("round-trips every byte", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(encodeCp437(decodeCp437(all))).toEqual(all);
  });

  it("round-trips text", () => {
    const text = '#KONTO 7010 "Löner till kollektivanställda"\r\n#OBJEKT 1 "8" "Överhead"';
    expect(decodeCp437(encodeCp437(text))).toBe(text);
  });

  it("decodes long inputs across chunk boundaries", () => {
    const bytes = new Uint8Array(20_000).fill(0x86);
    const text = decodeCp437(bytes);
    expect(text).toHaveLength(20_000);
    expect(text).toBe("å".repeat(20_000));
  });

  it("decodes an empty input", () => {
    expect(decodeCp437(new Uint8Array())).toBe("");
  });

  it("refuses characters outside the code page", () => {
    expect(() => encodeCp437("€")).toThrow(/U\+20AC/);
    expect(() => encodeCp437("😀")).toThrow(RangeError);
    expect(isCp437Encodable("åäö ÅÄÖ é")).toBe(true);
    expect(isCp437Encodable("–")).toBe(false);
  });
});
