import { describe, expect, it } from "vitest";
import { encodeCp437 } from "@/lib/core/cp437";
import { decodeSie, encodingForFormat, readDeclaredFormat, scoreText } from "./decode";
import { readSieFixture as fixture } from "./test-fixtures";
import { decodeWindows1252, encodeWindows1252 } from "./windows1252";

const SAMPLE = [
  "#FLAGGA 0",
  "#FORMAT PC8",
  "#SIETYP 4",
  '#FNAMN "Miljonbemanning AB"',
  '#KONTO 3041 "Försäljning tjänster 25 %"',
  '#KONTO 7010 "Löner till kollektivanställda"',
  '#OBJEKT 1 "200" "Omställning"',
  '#OBJEKT 1 "300" "Café Åre"',
  "",
].join("\r\n");

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("windows-1252", () => {
  // Not compared with TextDecoder: Node builds without full ICU decode
  // "windows-1252" as Latin-1, which is exactly why the table is local.
  it("follows the WHATWG mapping for every byte", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const decoded = decodeWindows1252(all);
    expect(decoded).toHaveLength(256);
    expect(decoded.slice(0x80, 0xa0)).toBe(
      "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ",
    );
    for (let b = 0; b < 256; b++) {
      if (b < 0x80 || b >= 0xa0) expect(decoded.charCodeAt(b)).toBe(b);
    }
    expect(decodeWindows1252(new Uint8Array([0xe5, 0xe4, 0xf6, 0xc5, 0xc4, 0xd6, 0xe9]))).toBe(
      "åäöÅÄÖé",
    );
  });

  it("round-trips", () => {
    const text = "Försäljning – “tjänster” €";
    expect(decodeWindows1252(encodeWindows1252(text))).toBe(text);
    expect(() => encodeWindows1252("─")).toThrow(RangeError);
  });
});

describe("readDeclaredFormat", () => {
  it("reads bare and quoted values", () => {
    expect(readDeclaredFormat(utf8("#FLAGGA 0\r\n#FORMAT PC8\r\n"))).toBe("PC8");
    expect(readDeclaredFormat(utf8('#FORMAT "PC8"\n'))).toBe("PC8");
    expect(readDeclaredFormat(utf8("  #format\tutf8 \n"))).toBe("utf8");
    expect(readDeclaredFormat(utf8("#FLAGGA 0\n"))).toBeNull();
  });

  it("maps formats to encodings", () => {
    expect(encodingForFormat("PC8")).toBe("cp437");
    expect(encodingForFormat("pc8")).toBe("cp437");
    expect(encodingForFormat("UTF-8")).toBe("utf-8");
    expect(encodingForFormat("ANSI")).toBe("windows-1252");
    expect(encodingForFormat("EBCDIC")).toBeNull();
  });
});

describe("scoreText", () => {
  it("counts Swedish letters as plausible and mojibake as implausible", () => {
    expect(scoreText("åäöÅÄÖé abc")).toEqual({ plausible: 7, implausible: 0 });
    // Windows-1252 bytes of "åäöÅÄÖ" read as CP437
    expect(scoreText("σΣ÷┼─╓")).toEqual({ plausible: 0, implausible: 6 });
    // CP437 bytes of "åäöÄÖé" read as Windows-1252
    expect(scoreText("†„”Ž™‚")).toEqual({ plausible: 0, implausible: 6 });
    // UTF-8 read as Windows-1252
    expect(scoreText("Ã¥")).toEqual({ plausible: 0, implausible: 1 });
  });
});

describe("decodeSie", () => {
  it("decodes CP437 declared as PC8 without warnings", () => {
    const d = decodeSie(encodeCp437(SAMPLE));
    expect(d.encoding).toBe("cp437");
    expect(d.declaredFormat).toBe("PC8");
    expect(d.text).toBe(SAMPLE);
    expect(d.warnings).toEqual([]);
  });

  it("detects Windows-1252 mislabeled as PC8 and warns", () => {
    const d = decodeSie(encodeWindows1252(SAMPLE));
    expect(d.encoding).toBe("windows-1252");
    expect(d.declaredFormat).toBe("PC8");
    expect(d.text).toBe(SAMPLE);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toMatch(/PC8.*Windows-1252/);
  });

  it("detects UTF-8, with and without byte order mark", () => {
    const plain = decodeSie(utf8(SAMPLE));
    expect(plain.encoding).toBe("utf-8");
    expect(plain.text).toBe(SAMPLE);
    expect(plain.warnings[0]).toMatch(/PC8.*UTF-8/);

    const withBom = decodeSie(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SAMPLE)]));
    expect(withBom.encoding).toBe("utf-8");
    expect(withBom.text).toBe(SAMPLE);
  });

  it("accepts UTF-8 declared as UTF-8 without warnings", () => {
    const text = SAMPLE.replace("#FORMAT PC8", "#FORMAT UTF-8");
    const d = decodeSie(utf8(text));
    expect(d.encoding).toBe("utf-8");
    expect(d.warnings).toEqual([]);
  });

  it("uses the declared encoding for pure ASCII files", () => {
    const d = decodeSie(utf8('#FLAGGA 0\r\n#FORMAT PC8\r\n#KONTO 1930 "Bank"\r\n'));
    expect(d.encoding).toBe("cp437");
    expect(d.warnings).toEqual([]);
  });

  it("warns when #FORMAT is missing or unknown", () => {
    const missing = decodeSie(encodeCp437(SAMPLE.replace("#FORMAT PC8\r\n", "")));
    expect(missing.declaredFormat).toBeNull();
    expect(missing.encoding).toBe("cp437");
    expect(missing.warnings[0]).toMatch(/saknar #FORMAT/);

    const unknown = decodeSie(encodeCp437(SAMPLE.replace("PC8", "EBCDIC")));
    expect(unknown.declaredFormat).toBe("EBCDIC");
    expect(unknown.encoding).toBe("cp437");
    expect(unknown.warnings[0]).toMatch(/Okänt #FORMAT "EBCDIC"/);
  });

  it("warns when no candidate looks like Swedish text", () => {
    // Box drawing characters in CP437 that are C1 controls in Windows-1252.
    const d = decodeSie(
      new Uint8Array([
        0x23, 0x46, 0x4f, 0x52, 0x4d, 0x41, 0x54, 0x20, 0x50, 0x43, 0x38, 0x0a, 0xc4, 0x9d, 0x8d,
      ]),
    );
    expect(d.warnings.some((w) => w.includes("kunde inte fastställas"))).toBe(true);
  });

  it("reports scores for every candidate", () => {
    const d = decodeSie(encodeCp437(SAMPLE));
    expect(d.scores.map((s) => s.encoding).sort()).toEqual(["cp437", "utf-8", "windows-1252"]);
    expect(d.scores.find((s) => s.encoding === "utf-8")?.valid).toBe(false);
  });
});

describe("decodeSie on fixtures", () => {
  it.each([
    ["mbab_2026_psaldo.se", "cp437"],
    ["mbr_2026_trans_only.se", "cp437"],
    ["mbab_2026_cumulative.se", "cp437"],
    ["mbr_broken_fy.se", "cp437"],
    ["unknown_org.se", "cp437"],
  ])("%s decodes as %s without warnings", (name, encoding) => {
    const d = decodeSie(fixture(name));
    expect(d.encoding).toBe(encoding);
    expect(d.declaredFormat).toBe("PC8");
    expect(d.warnings).toEqual([]);
    expect(d.text).toContain("Kostnadsställe");
  });

  it("decodes the mislabeled Windows-1252 fixture correctly, with a warning", () => {
    const d = decodeSie(fixture("mbab_declared_pc8_but_1252.se"));
    expect(d.encoding).toBe("windows-1252");
    expect(d.declaredFormat).toBe("PC8");
    expect(d.text).toContain('#KONTO 7010 "Löner till kollektivanställda"');
    expect(d.text).toContain('#OBJEKT 6 "P2" "Projekt Örebro"');
    expect(d.warnings).toHaveLength(1);
  });
});
