import { describe, expect, it } from "vitest";
import type { WorkingTable } from "@/lib/ingest/working";
import { displayValue, distinctRawValues, distinctValues, measureSums } from "./preview";

const table: WorkingTable = {
  columns: ["kund", "belopp", "timmar", "pnr"],
  rows: [
    {
      sourceRow: 2,
      values: { kund: "Acme", belopp: "1 200,50 kr", timmar: 8.25, pnr: "121212-1212" },
    },
    { sourceRow: 3, values: { kund: "Acme", belopp: "300", timmar: "7,5", pnr: null } },
    {
      sourceRow: 4,
      values: { kund: "Beta", belopp: "okänt", timmar: true, pnr: "Bo 701063-2391" },
    },
    { sourceRow: 5, values: { kund: null, belopp: "", timmar: null, pnr: null } },
  ],
};

describe("displayValue", () => {
  it("shows Swedish numbers, Ja/Nej and masks personnummer", () => {
    expect(displayValue(1234.5)).toBe("1\u00a0234,5");
    expect(displayValue(8)).toBe("8");
    expect(displayValue(0.1234567)).toBe("0,1235");
    expect(displayValue(true)).toBe("Ja");
    expect(displayValue(null)).toBe("");
    expect(displayValue("121212-1212")).not.toContain("121212");
  });
});

describe("distinct values", () => {
  it("lists distinct display and raw values", () => {
    expect(distinctValues(table, "kund")).toEqual(["Acme", "Beta"]);
    expect(distinctValues(table, "timmar", 2)).toEqual(["8,25", "7,5"]);
    expect(distinctRawValues(table, "timmar")).toEqual(["8.25", "7,5", "true"]);
    expect(distinctRawValues(table, "pnr").join(" ")).not.toMatch(/\d{6}-\d{4}/);
  });
});

describe("measureSums", () => {
  it("sums readable cells by type and counts the rest", () => {
    expect(
      measureSums(table, [
        { column: "belopp", type: "amount" },
        { column: "timmar", type: "hours" },
        { column: "kund", type: "number" },
        { column: "finns_inte", type: "number" },
      ]),
    ).toEqual({
      belopp: { sum: 1500.5, unreadable: 1 },
      timmar: { sum: 15.75, unreadable: 1 },
      kund: { sum: null, unreadable: 3 },
    });
  });
});
