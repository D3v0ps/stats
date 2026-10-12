import { describe, expect, it } from "vitest";
import { CSV_BOM, buildCsv, csvField, csvFileName, csvNumber } from "./csv";

describe("csv export", () => {
  it("writes Swedish decimals without thousands separators", () => {
    expect(csvNumber(1234567.891, 2)).toBe("1234567,89");
    expect(csvNumber(-1234.5, 1)).toBe("-1234,5");
    expect(csvNumber(0.004, 2)).toBe("0,00");
    expect(csvNumber(42)).toBe("42");
    expect(csvNumber(null)).toBe("");
    expect(csvNumber(Number.NaN)).toBe("");
  });

  it("quotes separators, quotes and line breaks and defuses formulas", () => {
    expect(csvField("Budbee; Södertälje")).toBe('"Budbee; Södertälje"');
    expect(csvField('Säg "hej"')).toBe('"Säg ""hej"""');
    expect(csvField("rad\nnästa")).toBe('"rad\nnästa"');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("-12")).toBe("-12");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("-1234,5")).toBe("-1234,5");
    expect(csvField("-1+1+cmd|' /C calc'!A0")).toBe("'-1+1+cmd|' /C calc'!A0");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("\t=1")).toBe("'\t=1");
    expect(csvField("+46 8 123")).toBe("'+46 8 123");
  });

  it("starts with a BOM, separates with semicolons and ends lines with CRLF", () => {
    const csv = buildCsv(
      ["Kund", "Timmar"],
      [
        ["Budbee", "1234,5"],
        ["Åhléns", "12"],
      ],
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe("Kund;Timmar\r\nBudbee;1234,5\r\nÅhléns;12\r\n");
  });

  it("makes ASCII file names", () => {
    expect(csvFileName(["Fakturerade timmar", "Kund", "september 2026"])).toBe(
      "mb-stats-fakturerade-timmar-kund-september-2026.csv",
    );
    expect(csvFileName(["Sjukfrånvaro", "", "jan–sep 2026"])).toBe(
      "mb-stats-sjukfranvaro-jan-sep-2026.csv",
    );
    expect(csvFileName([])).toBe("mb-stats.csv");
  });
});
