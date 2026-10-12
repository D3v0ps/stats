import { describe, expect, it } from "vitest";
import type { DetectedTable, RawCell } from "@/lib/contracts";
import { detectTable } from "./header-detect";
import { readWorkbook } from "./read";
import { xlsxBytes } from "./testing/workbooks";
import { columnValues, convertCell, fromDetected, uniqueColumnNames, valueText } from "./working";

describe("uniqueColumnNames", () => {
  it("de-duplicates with (2), (3)", () => {
    expect(uniqueColumnNames(["kund", "belopp", "kund", "kund"])).toEqual([
      "kund",
      "belopp",
      "kund (2)",
      "kund (3)",
    ]);
  });

  it("avoids collisions with existing suffixed names", () => {
    expect(uniqueColumnNames(["a", "a (2)", "a"])).toEqual(["a", "a (2)", "a (3)"]);
  });

  it("never yields __proto__ or empty names", () => {
    expect(uniqueColumnNames(["__proto__", ""])).toEqual(["__proto__ (2)", "kolumn"]);
  });
});

describe("convertCell", () => {
  const cell = (c: RawCell) => convertCell(c, false);

  it("converts date-formatted serials to ISO dates", () => {
    expect(cell({ v: 46295, t: "d", f: "yyyy-mm-dd" })).toBe("2026-09-30");
    expect(convertCell({ v: 46295 - 1462, t: "d" }, true)).toBe("2026-09-30");
  });

  it("keeps the display text of an invalid date serial", () => {
    expect(cell({ v: 60, t: "d", w: "1900-02-29" })).toBe("1900-02-29");
  });

  it("converts time formats to hours and percent formats to percent units", () => {
    expect(cell({ v: 0.354166666666667, t: "n", f: "[h]:mm" })).toBe(8.5);
    expect(cell({ v: 1.5, t: "n", f: "[h]:mm" })).toBe(36);
    expect(cell({ v: 0.125, t: "n", f: "0.0%" })).toBe(12.5);
    expect(cell({ v: 0.07, t: "n", f: "0%" })).toBe(7);
  });

  it("keeps numbers, booleans, trimmed text, and error text", () => {
    expect(cell({ v: 8.5, t: "n" })).toBe(8.5);
    expect(cell({ v: 1200, t: "n", f: '#,##0 "kr"' })).toBe(1200);
    expect(cell({ v: true, t: "b" })).toBe(true);
    expect(cell({ v: "  Acme  ", t: "s" })).toBe("Acme");
    expect(cell({ v: "   ", t: "s" })).toBeNull();
    expect(cell({ v: "#N/A", t: "e" })).toBe("#N/A");
    expect(cell({ v: null, t: "z" })).toBeNull();
    expect(convertCell(undefined, false)).toBeNull();
  });
});

describe("fromDetected", () => {
  it("names columns by normalized header, de-duplicated, and converts cells", () => {
    const table: DetectedTable = {
      sheetName: "S",
      headerRows: [0],
      columns: [
        { index: 0, header: "Kund", normalized: "kund" },
        { index: 1, header: "Datum", normalized: "datum" },
        { index: 2, header: "Kund", normalized: "kund" },
        { index: 3, header: "", normalized: "" },
      ],
      rows: [
        {
          sourceRow: 2,
          cells: [
            { v: " Acme ", t: "s" },
            { v: 46295, t: "d" },
            { v: "B", t: "s" },
            { v: 3, t: "n" },
          ],
        },
      ],
      skipped: [],
      metaLines: [],
      confidence: 1,
    };
    const wt = fromDetected(table, { date1904: false });
    expect(wt.columns).toEqual(["kund", "datum", "kund (2)", "kolumn d"]);
    expect(wt.headers).toEqual({
      kund: "Kund",
      datum: "Datum",
      "kund (2)": "Kund",
      "kolumn d": "",
    });
    expect(wt.rows).toEqual([
      {
        sourceRow: 2,
        values: { kund: "Acme", datum: "2026-09-30", "kund (2)": "B", "kolumn d": 3 },
      },
    ]);
  });

  it("works end-to-end from an xlsx with date cells", () => {
    const wb = readWorkbook(
      xlsxBytes([
        {
          name: "S",
          rows: [
            ["Kund", "Datum", "Timmar"],
            ["Acme", 46295, 8.5],
          ],
          formats: { B2: "yyyy-mm-dd" },
        },
      ]),
      "x.xlsx",
    );
    const wt = fromDetected(detectTable(wb.sheets[0]!), { date1904: wb.date1904 });
    expect(wt.rows[0]!.values).toEqual({ kund: "Acme", datum: "2026-09-30", timmar: 8.5 });
  });
});

describe("columnValues / valueText", () => {
  it("returns non-empty values and text", () => {
    const wt = {
      columns: ["a"],
      rows: [
        { sourceRow: 1, values: { a: "x" } },
        { sourceRow: 2, values: { a: null } },
        { sourceRow: 3, values: { a: " " } },
        { sourceRow: 4, values: { a: 0 } },
      ],
    };
    expect(columnValues(wt, "a")).toEqual(["x", 0]);
    expect(valueText(0)).toBe("0");
    expect(valueText(false)).toBe("false");
    expect(valueText(null)).toBe("");
  });
});
