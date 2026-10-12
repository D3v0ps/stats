import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  TableTemplateConfigSchema,
  type TableTemplateConfig,
  type UploadChoices,
} from "@/lib/contracts";
import { PersonalDataError, aggregateTable, roundSum } from "./aggregate";
import type { CellValue, WorkingTable } from "./working";

function table(columns: string[], rows: CellValue[][]): WorkingTable {
  return {
    columns,
    rows: rows.map((r, i) => ({
      sourceRow: i + 2,
      values: Object.fromEntries(columns.map((c, j) => [c, r[j] ?? null])),
    })),
  };
}

type ConfigInput = z.input<typeof TableTemplateConfigSchema>;

const config = (c: Partial<ConfigInput> & Pick<ConfigInput, "columns">): TableTemplateConfig =>
  TableTemplateConfigSchema.parse({
    kind: "table",
    period: { kind: "column", column: "datum" },
    company: { kind: "fixed", company: "MBAB" },
    ...c,
  });

const base = config({
  columns: [
    { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
    { column: "datum", type: "date", usage: "period" },
    { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
    { column: "kommentar", type: "text", usage: "ignore" },
  ],
  counters: [{ metricKey: "pass", kind: "count_rows" }],
});
const noChoices: UploadChoices = {};

describe("aggregateTable – grouping", () => {
  const t = table(
    ["kund", "datum", "timmar", "kommentar"],
    [
      ["Acme", "2026-09-01", 8, "x"],
      ["Acme", "2026-09-02", "7,5", "y"],
      ["Beta", "2026-09-02", "4 h", null],
      ["Acme", "2026-10-01", 8, null],
      [null, "2026-09-03", 2, null],
    ],
  );
  const r = aggregateTable(t, base, noChoices);

  it("sums per metric, company, month and dimensions with source rows", () => {
    expect(r.facts.filter((f) => f.metricKey === "timmar")).toEqual([
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { kund: "(saknas)" },
        value: 2,
        sourceRows: [6],
      },
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { kund: "Acme" },
        value: 15.5,
        sourceRows: [2, 3],
      },
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-09",
        dims: { kund: "Beta" },
        value: 4,
        sourceRows: [4],
      },
      {
        metricKey: "timmar",
        company: "MBAB",
        month: "2026-10",
        dims: { kund: "Acme" },
        value: 8,
        sourceRows: [5],
      },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.rowsUsed).toBe(5);
  });

  it("counts rows for counters", () => {
    const pass = r.facts.filter((f) => f.metricKey === "pass");
    expect(pass.map((f) => [f.month, f.dims.kund, f.value])).toEqual([
      ["2026-09", "(saknas)", 1],
      ["2026-09", "Acme", 2],
      ["2026-09", "Beta", 1],
      ["2026-10", "Acme", 1],
    ]);
  });

  it("never puts ignored columns into facts", () => {
    expect(JSON.stringify(r.facts)).not.toMatch(/kommentar|"x"/);
  });
});

describe("aggregateTable – parsing measures", () => {
  it("reports unparseable cells as errors and excludes only that cell", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
        { column: "belopp", type: "amount", usage: "measure", metricKey: "fakturerat_ip" },
      ],
    });
    const r = aggregateTable(
      table(
        ["datum", "timmar", "belopp"],
        [
          ["2026-09-01", "abc", "1 200 kr"],
          ["2026-09-02", 8, "#VÄRDEFEL!"],
          ["2026-09-03", "-", true],
        ],
      ),
      cfg,
      noChoices,
    );
    expect(r.facts.map((f) => [f.metricKey, f.value, f.sourceRows])).toEqual([
      ["fakturerat_ip", 1200, [2]],
      ["timmar", 8, [3]],
    ]);
    expect(r.issues.map((i) => [i.sourceRow, i.column, i.severity])).toEqual([
      [2, "timmar", "error"],
      [3, "belopp", "error"],
      [4, "belopp", "error"],
    ]);
    expect(r.rowsUsed).toBe(2);
  });

  it("flags ambiguous numbers instead of guessing, unless the column decides", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "n", type: "number", usage: "measure", metricKey: "pass" },
      ],
    });
    const ambiguous = aggregateTable(
      table(["datum", "n"], [["2026-09-01", "1.234"]]),
      cfg,
      noChoices,
    );
    expect(ambiguous.facts).toEqual([]);
    expect(ambiguous.issues[0]!.message).toMatch(/Tvetydigt/);
    const decided = aggregateTable(
      table(
        ["datum", "n"],
        [
          ["2026-09-01", "1.234"],
          ["2026-09-01", "0,5"],
        ],
      ),
      cfg,
      noChoices,
    );
    expect(decided.facts[0]!.value).toBe(1234.5);
  });

  it("rounds away float noise in sums", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "n", type: "number", usage: "measure", metricKey: "pass" },
      ],
    });
    const r = aggregateTable(
      table(
        ["datum", "n"],
        [
          ["2026-09-01", 0.1],
          ["2026-09-01", 0.2],
        ],
      ),
      cfg,
      noChoices,
    );
    expect(r.facts[0]!.value).toBe(0.3);
    expect(roundSum(-0)).toBe(0);
    expect(Object.is(roundSum(-0), 0)).toBe(true);
  });
});

describe("aggregateTable – period and company", () => {
  const measureOnly = [
    { column: "v", type: "number" as const, usage: "measure" as const, metricKey: "pass" },
  ];

  it("reads months from dates, month strings and YYYYMM numbers", () => {
    const cfg = config({
      columns: [...measureOnly, { column: "datum", type: "date", usage: "period" }],
    });
    const r = aggregateTable(
      table(
        ["datum", "v"],
        [
          ["2026-09-30", 1],
          ["2026-09", 1],
          ["sep 2026", 1],
          [202609, 1],
          ["30/9 2026", 1],
        ],
      ),
      cfg,
      noChoices,
    );
    expect(r.facts).toEqual([
      {
        metricKey: "pass",
        company: "MBAB",
        month: "2026-09",
        dims: {},
        value: 5,
        sourceRows: [2, 3, 4, 5, 6],
      },
    ]);
  });

  it("skips rows without a valid period", () => {
    const cfg = config({
      columns: [...measureOnly, { column: "datum", type: "date", usage: "period" }],
    });
    const r = aggregateTable(
      table(
        ["datum", "v"],
        [
          [null, 1],
          ["2026-02-30", 1],
          ["2026-09-01", 1],
        ],
      ),
      cfg,
      noChoices,
    );
    expect(r.skipped).toEqual([
      { sourceRow: 2, reason: "unparseable", detail: "Datum/period saknas" },
      { sourceRow: 3, reason: "unparseable", detail: 'Ogiltigt datum "2026-02-30"' },
    ]);
    expect(r.facts).toHaveLength(1);
  });

  it("uses the chosen month for per-upload periods", () => {
    const cfg = config({ columns: measureOnly, period: { kind: "per_upload" } });
    expect(aggregateTable(table(["v"], [[3]]), cfg, { month: "2026-09" }).facts[0]!.month).toBe(
      "2026-09",
    );
    const missing = aggregateTable(table(["v"], [[3], [4]]), cfg, {});
    expect(missing.facts).toEqual([]);
    expect(missing.issues[0]!.message).toMatch(/Månad är inte vald/);
    expect(missing.skipped).toHaveLength(2);
  });

  it("maps a company column and skips unknown companies", () => {
    const cfg = config({
      columns: measureOnly,
      period: { kind: "per_upload" },
      company: { kind: "column", column: "bolag", mapping: { "MB AB": "MBAB", Restart: "MBR" } },
    });
    const r = aggregateTable(
      table(
        ["bolag", "v"],
        [
          ["mb ab", 1],
          ["RESTART", 2],
          ["MBR", 3],
          ["Miljonbemanning AB", 4],
          ["Okänt AB", 5],
          [null, 6],
        ],
      ),
      cfg,
      { month: "2026-09" },
    );
    expect(r.facts.map((f) => [f.company, f.value])).toEqual([
      ["MBAB", 5],
      ["MBR", 5],
    ]);
    expect(r.skipped.map((s) => [s.sourceRow, s.detail])).toEqual([
      [6, 'Okänt bolag "Okänt AB"'],
      [7, "Bolag saknas"],
    ]);
  });

  it("uses the chosen company for per-upload companies", () => {
    const cfg = config({
      columns: measureOnly,
      period: { kind: "per_upload" },
      company: { kind: "per_upload" },
    });
    expect(
      aggregateTable(table(["v"], [[1]]), cfg, { month: "2026-09", company: "MBR" }).facts[0]!
        .company,
    ).toBe("MBR");
    expect(
      aggregateTable(table(["v"], [[1]]), cfg, { month: "2026-09" }).issues[0]!.message,
    ).toMatch(/Bolag är inte valt/);
  });
});

describe("aggregateTable – validation and personal data", () => {
  it("reports missing columns, measures without metric and duplicate dimensions", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "saknas", type: "number", usage: "measure", metricKey: "pass" },
        { column: "v", type: "number", usage: "measure" },
        { column: "a", type: "text", usage: "dimension", dimensionKey: "kund" },
        { column: "b", type: "text", usage: "dimension", dimensionKey: "kund" },
        { column: "c", type: "text", usage: "dimension" },
      ],
    });
    const r = aggregateTable(
      table(["datum", "v", "a", "b", "c"], [["2026-09-01", 1, "x", "y", "z"]]),
      cfg,
      noChoices,
    );
    expect(r.issues.map((i) => i.column)).toEqual(["saknas", "v", "b", "c"]);
    expect(r.facts).toEqual([]);
  });

  it("throws PersonalDataError when a kept dimension or measure holds personnummer", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "id", type: "text", usage: "dimension", dimensionKey: "konsult" },
        { column: "v", type: "number", usage: "measure", metricKey: "pass" },
      ],
    });
    const withPnr = table(
      ["datum", "id", "v"],
      [
        ["2026-09-01", "1001", 1],
        ["2026-09-01", "121212-1212", 1],
      ],
    );
    expect(() => aggregateTable(withPnr, cfg, noChoices)).toThrow(PersonalDataError);
    try {
      aggregateTable(withPnr, cfg, noChoices);
    } catch (e) {
      expect((e as PersonalDataError).column).toBe("id");
    }
    const numericPnr = table(["datum", "id", "v"], [["2026-09-01", "1001", 1212121212]]);
    expect(() => aggregateTable(numericPnr, cfg, noChoices)).toThrow(PersonalDataError);
  });

  it("ignores personnummer in removed columns", () => {
    const cfg = config({
      columns: [
        { column: "datum", type: "date", usage: "period" },
        { column: "pnr", type: "text", usage: "ignore", personal: true, keep: false },
        { column: "id", type: "text", usage: "dimension", dimensionKey: "konsult", keep: false },
        { column: "v", type: "number", usage: "measure", metricKey: "pass" },
      ],
    });
    const r = aggregateTable(
      table(["datum", "pnr", "id", "v"], [["2026-09-01", "121212-1212", "121212-1212", 1]]),
      cfg,
      noChoices,
    );
    expect(r.facts).toEqual([
      { metricKey: "pass", company: "MBAB", month: "2026-09", dims: {}, value: 1, sourceRows: [2] },
    ]);
    expect(JSON.stringify(r)).not.toContain("121212");
  });
});

describe("aggregateTable – property: facts preserve sums over any dimension subset", () => {
  const KUND = ["Acme", "Beta", "Gamma", ""];
  const ORT = ["Malmö", "Lund"];
  const MONTHS = ["2026-08-15", "2026-09-01", "2026-09-30"];
  const rowArb = fc.record({
    kund: fc.constantFrom(...KUND),
    ort: fc.constantFrom(...ORT),
    datum: fc.constantFrom(...MONTHS),
    timmar: fc.integer({ min: -50, max: 500 }),
  });
  const cfg = config({
    columns: [
      { column: "kund", type: "text", usage: "dimension", dimensionKey: "kund" },
      { column: "ort", type: "text", usage: "dimension", dimensionKey: "ort" },
      { column: "datum", type: "date", usage: "period" },
      { column: "timmar", type: "hours", usage: "measure", metricKey: "timmar" },
    ],
  });
  const filterArb = fc.record(
    {
      kund: fc.constantFrom(...KUND),
      ort: fc.constantFrom(...ORT),
      month: fc.constantFrom("2026-08", "2026-09"),
    },
    { requiredKeys: [] },
  );

  it("Σ facts matching a filter = Σ raw rows matching it", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 40 }), filterArb, (rows, filter) => {
        const t = table(
          ["kund", "ort", "datum", "timmar"],
          rows.map((r) => [r.kund || null, r.ort, r.datum, String(r.timmar).replace(".", ",")]),
        );
        const { facts, issues } = aggregateTable(t, cfg, noChoices);
        expect(issues).toEqual([]);
        const label = (k: string) => k || "(saknas)";
        const rawSum = rows
          .filter(
            (r) =>
              (filter.kund === undefined || label(r.kund) === label(filter.kund)) &&
              (filter.ort === undefined || r.ort === filter.ort) &&
              (filter.month === undefined || r.datum.startsWith(filter.month)),
          )
          .reduce((s, r) => s + r.timmar, 0);
        const factSum = facts
          .filter(
            (f) =>
              (filter.kund === undefined || f.dims.kund === label(filter.kund)) &&
              (filter.ort === undefined || f.dims.ort === filter.ort) &&
              (filter.month === undefined || f.month === filter.month),
          )
          .reduce((s, f) => s + f.value, 0);
        expect(factSum).toBe(rawSum);
        // Every fact carries every mapped dimension and a positive source row list.
        for (const f of facts) {
          expect(Object.keys(f.dims).sort()).toEqual(["kund", "ort"]);
          expect(f.sourceRows.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is independent of row order (same facts apart from source rows)", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 30 }), (rows) => {
        const mk = (rs: typeof rows) =>
          aggregateTable(
            table(
              ["kund", "ort", "datum", "timmar"],
              rs.map((r) => [r.kund || null, r.ort, r.datum, r.timmar]),
            ),
            cfg,
            noChoices,
          ).facts.map((f) => ({ ...f, sourceRows: [] }));
        expect(mk([...rows].reverse())).toEqual(mk(rows));
      }),
      { numRuns: 200 },
    );
  });
});
