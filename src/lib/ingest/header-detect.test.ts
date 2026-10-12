import { describe, expect, it } from "vitest";
import type { RawWorkbook } from "@/lib/contracts";
import { detectTable, detectTableWithHeaderRow, pickSheet } from "./header-detect";
import { readWorkbook } from "./read";
import { rawSheet, utf8, xlsxBytes } from "./testing/workbooks";

const reportBytes = xlsxBytes([
  {
    name: "Timmar",
    rows: [
      ["Timrapport"],
      ["Miljonbemanning AB", null, "Org.nr 556959-9318"],
      ["Period: 2026-09-01 - 2026-09-30"],
      ["Kund", "Datum", "Anställnings id", "Timmar"],
      ["Acme AB", 46266, 1001, 8],
      ["Acme AB", 46267, 1002, 7.5],
      [],
      ["Total Bygg AB", 46268, 1001, 4],
      ["Totalt för Acme AB", null, null, 15.5],
      ["Totalt", null, null, 19.5],
      [],
      ["Utskrivet 2026-10-01 08:15"],
      ["Sida 1 av 1"],
    ],
    merges: ["A1:D1"],
    formats: { B5: "yyyy-mm-dd", B6: "yyyy-mm-dd", B8: "yyyy-mm-dd" },
  },
]);

describe("detectTable – report with title block, sum rows and footer", () => {
  const wb = readWorkbook(reportBytes, "timmar.xlsx");
  const table = detectTable(wb.sheets[0]!);

  it("finds the header on row 4 with high confidence", () => {
    expect(table.headerRows).toEqual([3]);
    expect(table.confidence).toBeGreaterThanOrEqual(0.8);
    expect(table.columns.map((c) => c.header)).toEqual([
      "Kund",
      "Datum",
      "Anställnings id",
      "Timmar",
    ]);
    expect(table.columns.map((c) => c.normalized)).toEqual([
      "kund",
      "datum",
      "anställnings id",
      "timmar",
    ]);
    expect(table.columns.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it("collects meta lines above the header", () => {
    expect(table.metaLines).toEqual([
      "Timrapport",
      "Miljonbemanning AB Org.nr 556959-9318",
      "Period: 2026-09-01 - 2026-09-30",
    ]);
  });

  it("keeps data rows with 1-based source rows, aligned to columns", () => {
    expect(table.rows.map((r) => r.sourceRow)).toEqual([5, 6, 8]);
    expect(table.rows[0]!.cells.map((c) => c.v)).toEqual(["Acme AB", 46266, 1001, 8]);
    expect(table.rows[0]!.cells[1]!.t).toBe("d");
  });

  it("does not treat a customer named 'Total Bygg AB' as a sum row", () => {
    expect(table.rows.some((r) => r.cells[0]!.v === "Total Bygg AB")).toBe(true);
  });

  it("skips empty rows, sum rows and the footer with reasons", () => {
    expect(table.skipped).toEqual([
      { sourceRow: 7, reason: "empty" },
      { sourceRow: 9, reason: "sum_row", detail: "Totalt för Acme AB" },
      { sourceRow: 10, reason: "sum_row", detail: "Totalt" },
      { sourceRow: 11, reason: "empty" },
      { sourceRow: 12, reason: "footer", detail: "Utskrivet 2026-10-01 08:15" },
      { sourceRow: 13, reason: "footer", detail: "Sida 1 av 1" },
    ]);
  });
});

describe("detectTable – two-row headers", () => {
  it("joins a merged group header row with the header below", () => {
    const wb = readWorkbook(
      xlsxBytes([
        {
          name: "Lön",
          rows: [
            ["Löneunderlag september 2026"],
            [],
            ["Kund", "Timmar", null, "Belopp", null],
            [null, "Ordinarie", "Övertid", "Fakturerat", "Lön"],
            ["Acme", 160, 12, 98000, 52000],
            ["Beta", 80, 0, 41000, 26000],
          ],
          merges: ["A1:E1", "A3:A4", "B3:C3", "D3:E3"],
        },
      ]),
      "lon.xlsx",
    );
    const table = detectTable(wb.sheets[0]!);
    expect(table.headerRows).toEqual([2, 3]);
    expect(table.columns.map((c) => c.header)).toEqual([
      "Kund",
      "Timmar Ordinarie",
      "Timmar Övertid",
      "Belopp Fakturerat",
      "Belopp Lön",
    ]);
    expect(table.metaLines).toEqual(["Löneunderlag september 2026"]);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([5, 6]);
  });

  it("joins an unmerged group row when it has fewer cells than the header", () => {
    const sheet = rawSheet([
      ["", "Utfall", "", "Budget"],
      ["Konto", "Belopp", "Andel", "Belopp"],
      ["3010", 100, 5, 120],
      ["4010", 50, 2, 60],
    ]);
    const table = detectTable(sheet);
    expect(table.headerRows).toEqual([0, 1]);
    expect(table.columns.map((c) => c.header)).toEqual([
      "Konto",
      "Utfall Belopp",
      "Andel",
      "Budget Belopp",
    ]);
  });

  it("does not treat a key/value meta line right above the header as a group header", () => {
    const sheet = rawSheet([
      ["Bolag:", "MBAB", "", ""],
      ["Kund", "Datum", "Timmar", "Belopp"],
      ["Acme", "2026-09-01", 8, 1200],
    ]);
    const table = detectTable(sheet);
    expect(table.headerRows).toEqual([1]);
    expect(table.columns.map((c) => c.header)).toEqual(["Kund", "Datum", "Timmar", "Belopp"]);
    expect(table.metaLines).toEqual(["Bolag: MBAB"]);
  });

  it("does not treat an unmerged title row over the first column as a group header", () => {
    const sheet = rawSheet([
      ["Timrapport", "", "MBAB"],
      ["Kund", "Datum", "Timmar"],
      ["Acme", "2026-09-01", 8],
      ["Beta", "2026-09-02", 7],
    ]);
    const table = detectTable(sheet);
    expect(table.headerRows).toEqual([1]);
    expect(table.columns.map((c) => c.header)).toEqual(["Kund", "Datum", "Timmar"]);
    expect(table.metaLines).toEqual(["Timrapport MBAB"]);
  });

  it("does not treat a full-width merged title as a group header", () => {
    const sheet = rawSheet(
      [
        ["Rapport", "", ""],
        ["Kund", "Timmar", "Belopp"],
        ["Acme", 8, 1200],
      ],
      { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] },
    );
    const table = detectTable(sheet);
    expect(table.headerRows).toEqual([1]);
    expect(table.metaLines).toEqual(["Rapport"]);
  });
});

describe("detectTable – paged exports and CSV-like text", () => {
  it("skips repeated header rows and page footers between pages", () => {
    const sheet = rawSheet([
      ["Kund", "Ort", "Timmar"],
      ["Acme", "Malmö", "8,5"],
      ["Beta", "Lund", "7"],
      ["Sida 1 av 2"],
      ["Kund", "Ort", "Timmar"],
      ["Gamma", "Ystad", "6"],
      ["Sida 2 av 2"],
    ]);
    const table = detectTable(sheet);
    expect(table.headerRows).toEqual([0]);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 6]);
    expect(table.skipped.map((s) => [s.sourceRow, s.reason])).toEqual([
      [4, "footer"],
      [5, "repeated_header"],
      [7, "footer"],
    ]);
  });

  it("detects the header in an all-text CSV with a title line", () => {
    const wb = readWorkbook(
      utf8(
        "Timrapport MBAB september 2026\n\nKund;Datum;Timmar\nAcme;2026-09-01;8,5\nBeta;2026-09-02;7\n",
      ),
      "t.csv",
    );
    const table = detectTable(wb.sheets[0]!);
    expect(table.headerRows).toEqual([2]);
    expect(table.metaLines).toEqual(["Timrapport MBAB september 2026"]);
    expect(table.rows).toHaveLength(2);
    expect(table.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("treats a trailing lone text line as footer", () => {
    const sheet = rawSheet([
      ["Kund", "Ort", "Timmar"],
      ["Acme", "Malmö", 8],
      ["Beta", "Lund", 7],
      ["Rapporten är skapad av Intelliplan"],
      ["Exportinformation saknas"],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3]);
    expect(table.skipped.map((s) => s.reason)).toEqual(["footer", "footer"]);
  });

  it("names data columns without a header after their letter", () => {
    const sheet = rawSheet([
      ["Kund", "", "Timmar"],
      ["Acme", "x", 8],
      ["Beta", "y", 7],
    ]);
    const table = detectTable(sheet);
    expect(table.columns.map((c) => c.header)).toEqual(["Kund", "Kolumn B", "Timmar"]);
    expect(table.columns[1]!.normalized).toBe("kolumn b");
  });

  it("ignores empty columns between data", () => {
    const sheet = rawSheet([
      ["Kund", "", "Timmar"],
      ["Acme", "", 8],
    ]);
    expect(detectTable(sheet).columns.map((c) => c.index)).toEqual([0, 2]);
  });
});

describe("detectTable – confidence and options", () => {
  it("returns an empty table for an empty sheet", () => {
    const table = detectTable(rawSheet([]));
    expect(table).toMatchObject({ headerRows: [], columns: [], rows: [], confidence: 0 });
  });

  it("has low confidence when nothing looks like a header", () => {
    const table = detectTable(
      rawSheet([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]),
    );
    expect(table.confidence).toBeLessThan(0.5);
  });

  it("is unsure about all-text tables and lets template headers decide", () => {
    const sheet = rawSheet([
      ["Avdelning", "Ansvarig", "Kommentar"],
      ["Kund", "Ort", "Status"],
      ["Acme", "Malmö", "Aktiv"],
      ["Beta", "Lund", "Avslutad"],
    ]);
    const unsure = detectTable(sheet);
    expect(unsure.headerRows).toEqual([0]);
    expect(unsure.confidence).toBeLessThan(0.5);
    const table = detectTable(sheet, { expectedHeaders: ["kund", "ort", "status"] });
    expect(table.headerRows).toEqual([1]);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([3, 4]);
  });

  it("prefers the header over a data row even when the header has a gap", () => {
    const sheet = rawSheet([
      ["Avdelning", "Ansvarig", "Kommentar"],
      ["Kund", "Ort", "Timmar"],
      ["Acme", "Malmö", 8],
    ]);
    expect(detectTable(sheet).headerRows).toEqual([1]);
  });

  it("detectTableWithHeaderRow uses the chosen row", () => {
    const sheet = rawSheet([
      ["Avdelning", "Ansvarig", "Kommentar"],
      ["Kund", "Ort", "Timmar"],
      ["Acme", "Malmö", 8],
    ]);
    const table = detectTableWithHeaderRow(sheet, 1);
    expect(table.headerRows).toEqual([1]);
    expect(table.confidence).toBe(1);
    expect(table.metaLines).toEqual(["Avdelning Ansvarig Kommentar"]);
    expect(table.rows).toHaveLength(1);
    expect(detectTableWithHeaderRow(sheet, 99).columns).toEqual([]);
  });
});

describe("pickSheet", () => {
  const wb: RawWorkbook = {
    fileName: "x.xlsx",
    format: "xlsx",
    date1904: false,
    sheets: [
      rawSheet([["dold"]], { name: "Hjälp", hidden: true }),
      rawSheet([], { name: "Tom" }),
      rawSheet([["a"]], { name: "Data" }),
      rawSheet([["b"]], { name: "Pivot September" }),
    ],
  };

  it("picks the first visible non-empty sheet", () => {
    expect(pickSheet(wb)?.name).toBe("Data");
  });

  it("honours a hint (exact, case-insensitive or close)", () => {
    expect(pickSheet(wb, "Pivot September")?.name).toBe("Pivot September");
    expect(pickSheet(wb, "pivot september ")?.name).toBe("Pivot September");
    expect(pickSheet(wb, "Pivot Septembr")?.name).toBe("Pivot September");
    expect(pickSheet(wb, "Hjälp")?.name).toBe("Hjälp");
    expect(pickSheet(wb, "Okänt")?.name).toBe("Data");
  });

  it("falls back to hidden or empty sheets, null without sheets", () => {
    expect(
      pickSheet({ ...wb, sheets: [rawSheet([["x"]], { name: "H", hidden: true })] })?.name,
    ).toBe("H");
    expect(pickSheet({ ...wb, sheets: [rawSheet([], { name: "E" })] })?.name).toBe("E");
    expect(pickSheet({ ...wb, sheets: [] })).toBeNull();
  });
});

describe("detectTable – footers only where footers belong", () => {
  it("keeps data rows whose status reads like a footer word ('Utskriven', 'Skapad')", () => {
    const sheet = rawSheet([
      ["Id", "Status", "Startdatum"],
      ["1001", "Inskriven", "2026-01-05"],
      ["1002", "Utskriven", "2026-02-05"],
      ["1003", "Skapad", "2026-03-05"],
      ["1004", "Exporterad", "2026-04-05"],
      ["1005", "Sida 1 Reklam AB", "2026-05-05"],
      ["1006", "Inskriven", "2026-06-05"],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(table.skipped).toEqual([]);
  });

  it("still skips narrow print lines between pages and page markers in wide rows", () => {
    const sheet = rawSheet([
      ["Kund", "Timmar"],
      ["Acme", "8,5"],
      ["Utskrivet 2026-10-01 08:15"],
      ["Utskrivet 2026-10-01", "Sida 1 av 2"],
      ["Kund", "Timmar"],
      ["Beta", "7"],
      ["Utskrivet 2026-10-01", "Sida 2 av 2"],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 6]);
    expect(table.skipped.map((s) => [s.sourceRow, s.reason])).toEqual([
      [3, "footer"],
      [4, "footer"],
      [5, "repeated_header"],
      [7, "footer"],
    ]);
  });
});

describe("detectTable – sum rows recognised by their numbers", () => {
  it("skips an unlabeled grand total row at the end of the table", () => {
    const sheet = rawSheet([
      ["Kund", "Timmar", "Belopp"],
      ["Acme", 8, 100],
      ["Beta", 7, 200],
      ["Gamma", 5, 300.5],
      [null, 20, 600.5],
      [],
      ["Utskrivet 2026-10-01"],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
    expect(table.skipped.map((s) => [s.sourceRow, s.reason])).toEqual([
      [5, "sum_row"],
      [6, "empty"],
      [7, "footer"],
    ]);
  });

  it("skips an unlabeled total in a text CSV with rounded display values", () => {
    const sheet = rawSheet([
      ["Kund", "Datum", "Belopp"],
      ["Acme", "2026-09-01", "1 200,25"],
      ["Beta", "2026-09-02", "333,33"],
      ["Gamma", "2026-09-03", "333,33"],
      ["", "", "1 866,92"],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
    expect(table.skipped).toEqual([
      { sourceRow: 5, reason: "sum_row", detail: "Summa av raderna ovan" },
    ]);
  });

  it("recognises an unlabeled grand total under labelled subtotals", () => {
    const sheet = rawSheet([
      ["Kund", "Timmar"],
      ["Acme", 8],
      ["Beta", 2],
      ["Summa MBAB", 10],
      ["Gamma", 4],
      ["Delta", 1.5],
      ["Summa MBR", 5.5],
      ["", 15.5],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 5, 6]);
    expect(table.skipped.map((s) => [s.sourceRow, s.reason])).toEqual([
      [4, "sum_row"],
      [7, "sum_row"],
      [8, "sum_row"],
    ]);
  });

  it("keeps an unlabeled last row whose numbers are not the sum", () => {
    const sheet = rawSheet([
      ["Kund", "Timmar"],
      ["Acme", 8],
      ["", 7],
      ["", 5],
    ]);
    expect(detectTable(sheet).rows.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
  });

  it("keeps a last row that has a date even when its number equals the sum", () => {
    const sheet = rawSheet([
      ["Datum", "Timmar"],
      ["2026-09-01", 5],
      ["2026-09-02", 10],
      ["2026-09-03", 15],
    ]);
    expect(detectTable(sheet).rows.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
  });

  it("skips 'Total X' subtotals whose numbers add up, but keeps a customer named 'Total …'", () => {
    const sheet = rawSheet([
      ["Kund", "Anställnings id", "Timmar"],
      ["Acme", 1001, 8],
      ["Total Bygg AB", 1002, 7],
      ["Total MBAB", null, 15],
      ["Beta", 1003, 4],
      ["Gamma", 1004, 2.5],
      ["Sum Restart", null, 6.5],
      ["Total", null, 21.5],
    ]);
    const table = detectTable(sheet);
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 3, 5, 6]);
    expect(table.skipped).toEqual([
      { sourceRow: 4, reason: "sum_row", detail: "Total MBAB" },
      { sourceRow: 7, reason: "sum_row", detail: "Sum Restart" },
      { sourceRow: 8, reason: "sum_row", detail: "Total" },
    ]);
  });

  it("does not skip a 'Total …' customer row that happens to equal the rows above when it has more attributes", () => {
    const sheet = rawSheet([
      ["Kund", "Ort", "Timmar"],
      ["Acme", "Malmö", 2],
      ["Beta", "Lund", 2],
      ["Total Bygg AB", "Ystad", 4],
    ]);
    expect(detectTable(sheet).rows.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
  });
});
