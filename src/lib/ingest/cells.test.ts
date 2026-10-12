import { describe, expect, it } from "vitest";
import { cellText, classifyCell, columnLetter, isEmptyCell } from "./cells";
import { hasDateTokens, isPercentFormat, isTimeOnlyFormat } from "./formats";

describe("cellText / isEmptyCell", () => {
  it("prefers display text for non-strings", () => {
    expect(cellText({ v: 46295, w: "2026-09-30", t: "d" })).toBe("2026-09-30");
    expect(cellText({ v: 8.5, t: "n" })).toBe("8.5");
    expect(cellText({ v: true, t: "b" })).toBe("TRUE");
    expect(cellText({ v: "  x ", t: "s" })).toBe("x");
    expect(cellText(undefined)).toBe("");
    expect(isEmptyCell({ v: "   ", t: "s" })).toBe(true);
    expect(isEmptyCell({ v: null, t: "z" })).toBe(true);
  });
});

describe("classifyCell", () => {
  it.each([
    [{ v: 8.5, t: "n" as const }, "number"],
    [{ v: 46295, t: "d" as const }, "date"],
    [{ v: "8,5", t: "s" as const }, "number"],
    [{ v: "1 200 kr", t: "s" as const }, "number"],
    [{ v: "12 %", t: "s" as const }, "number"],
    [{ v: "8:30", t: "s" as const }, "number"],
    [{ v: "1.234", t: "s" as const }, "number"],
    [{ v: "2026", t: "s" as const }, "number"],
    [{ v: "2026-09-30", t: "s" as const }, "date"],
    [{ v: "30/9 2026", t: "s" as const }, "date"],
    [{ v: "sep 2026", t: "s" as const }, "date"],
    [{ v: "Kund", t: "s" as const }, "text"],
    [{ v: "#N/A", t: "e" as const }, "text"],
    [{ v: null, t: "z" as const }, "empty"],
  ])("%j -> %s", (cell, expected) => {
    expect(classifyCell(cell)).toBe(expected);
  });
});

describe("columnLetter", () => {
  it("maps indices to Excel letters", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
});

describe("number format helpers", () => {
  it("recognizes date tokens", () => {
    expect(hasDateTokens("yyyy-mm-dd")).toBe(true);
    expect(hasDateTokens("d/m/yyyy")).toBe(true);
    expect(hasDateTokens("[$-41D]mmmm yyyy")).toBe(true);
    expect(hasDateTokens("mmm")).toBe(true);
    expect(hasDateTokens("h:mm")).toBe(false);
    expect(hasDateTokens('0.0 "dagar"')).toBe(false);
  });

  it("recognizes time-only formats", () => {
    expect(isTimeOnlyFormat("h:mm")).toBe(true);
    expect(isTimeOnlyFormat("[h]:mm:ss")).toBe(true);
    expect(isTimeOnlyFormat("mm:ss")).toBe(true);
    expect(isTimeOnlyFormat("yyyy-mm-dd hh:mm")).toBe(false);
    expect(isTimeOnlyFormat("0.00")).toBe(false);
    expect(isTimeOnlyFormat('#,##0 "h"')).toBe(false);
    expect(isTimeOnlyFormat(undefined)).toBe(false);
  });

  it("recognizes percent formats but not quoted percent signs", () => {
    expect(isPercentFormat("0%")).toBe(true);
    expect(isPercentFormat("0.0%")).toBe(true);
    expect(isPercentFormat('0 "%"')).toBe(false);
    expect(isPercentFormat(undefined)).toBe(false);
  });
});
