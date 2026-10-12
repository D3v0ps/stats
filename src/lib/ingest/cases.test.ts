import { describe, expect, it } from "vitest";
import {
  CasesTemplateConfigSchema,
  type CasesTemplateConfig,
  type FactDraft,
} from "@/lib/contracts";
import { PersonalDataError } from "./aggregate";
import { buildCases } from "./cases";
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

const COLUMNS = ["gen", "tjänst", "start", "slut", "avbrott", "resultat"];

function config(
  cases: Partial<CasesTemplateConfig["cases"]> = {},
  extra: Partial<CasesTemplateConfig> = {},
) {
  return CasesTemplateConfigSchema.parse({
    kind: "cases",
    columns: [
      { column: "gen", type: "text", usage: "case_key" },
      { column: "tjänst", type: "text", usage: "dimension", dimensionKey: "verksamhet" },
      { column: "ort", type: "text", usage: "dimension", dimensionKey: "ort" },
      { column: "start", type: "date", usage: "case_start" },
      { column: "slut", type: "date", usage: "case_end" },
      { column: "avbrott", type: "text", usage: "case_interrupt" },
      { column: "resultat", type: "text", usage: "case_result" },
    ],
    cases: {
      keyColumn: "gen",
      startColumn: "start",
      endColumn: "slut",
      interruptColumn: "avbrott",
      resultColumn: "resultat",
      resultMap: { arbete: "Arbete", studier: "Studier" },
      groupBy: ["tjänst"],
      metrics: {
        active: "aktiva_deltagare",
        started: "nya_deltagare",
        ended: "avslutade_deltagare",
        interrupted: "avbrott_deltagare",
        results: "resultat_deltagare",
      },
      ...cases,
    },
    company: { kind: "fixed", company: "MBR" },
    ...extra,
  });
}

/** metric -> month -> group label -> value */
function pivot(facts: FactDraft[], metric: string, dim = "verksamhet") {
  const out: Record<string, Record<string, number>> = {};
  for (const f of facts.filter((x) => x.metricKey === metric)) {
    const label = f.dims.resultattyp
      ? `${f.dims[dim]}/${f.dims.resultattyp}`
      : (f.dims[dim] ?? "-");
    (out[f.month] ??= {})[label] = f.value;
  }
  return out;
}

describe("buildCases – participants with avbrott, open ends and the as-of cap", () => {
  const rows: CellValue[][] = [
    ["GEN1", "KROM", "2026-07-15", "2026-09-10", "", "Arbete"],
    ["GEN2", "KROM", "2026-08-01", null, "Nej", null],
    ["GEN3", "ROM2", "2026-08-20", "2026-12-31", "2026-09-15", null],
    ["GEN4", "ROM2", "2026-09-05", null, "Ja", null],
    ["GEN1", "KROM", "2026-07-15", "2026-09-10", "", "Arbete"],
    ["GEN5", "KROM", "2026-10-20", null, null, null],
    ["GEN6", "KROM", "30/9 2026", "2026-09-30", null, "studier"],
  ];
  const r = buildCases(table(COLUMNS, rows), config(), { asOfDate: "2026-10-12" });

  it("counts active participants at month end (as-of date for the current month)", () => {
    expect(pivot(r.facts, "aktiva_deltagare")).toEqual({
      "2026-07": { KROM: 1, ROM2: 0 },
      "2026-08": { KROM: 2, ROM2: 1 },
      "2026-09": { KROM: 2, ROM2: 1 },
      "2026-10": { KROM: 1, ROM2: 1 },
    });
  });

  it("counts starts, never after the as-of date", () => {
    expect(pivot(r.facts, "nya_deltagare")).toEqual({
      "2026-07": { KROM: 1, ROM2: 0 },
      "2026-08": { KROM: 1, ROM2: 1 },
      "2026-09": { KROM: 1, ROM2: 1 },
      "2026-10": { KROM: 0, ROM2: 0 },
    });
  });

  it("ends at the effective end (interruption date wins over a later end)", () => {
    expect(pivot(r.facts, "avslutade_deltagare")["2026-09"]).toEqual({ KROM: 2, ROM2: 1 });
    expect(pivot(r.facts, "avbrott_deltagare")["2026-09"]).toEqual({ KROM: 0, ROM2: 1 });
    expect(pivot(r.facts, "avbrott_deltagare")["2026-10"]).toEqual({ KROM: 0, ROM2: 0 });
  });

  it("counts mapped results in the month of the effective end", () => {
    expect(pivot(r.facts, "resultat_deltagare")["2026-09"]).toEqual({
      "KROM/Arbete": 1,
      "KROM/Studier": 1,
      "ROM2/Arbete": 0,
      "ROM2/Studier": 0,
    });
  });

  it("never produces months after the as-of month", () => {
    expect(Math.max(...r.facts.map((f) => Number(f.month.replace("-", ""))))).toBe(202610);
    expect(Math.min(...r.facts.map((f) => Number(f.month.replace("-", ""))))).toBe(202607);
  });

  it("counts duplicate key + start once and warns", () => {
    expect(r.rowsUsed).toBe(6);
    const dup = r.issues.find((i) => i.message.startsWith("Dubblett"));
    expect(dup).toMatchObject({ sourceRow: 6, severity: "warning", value: "" });
  });

  it("warns about an interruption without date or end and treats it as ongoing", () => {
    const w = r.issues.find((i) => i.sourceRow === 5);
    expect(w).toMatchObject({ severity: "warning" });
    expect(w!.message).toMatch(/räknas som pågående/);
  });

  it("never lets the key column into the output and has no source rows", () => {
    const json = JSON.stringify({
      facts: r.facts,
      totals: r.totals,
      issues: r.issues,
      skipped: r.skipped,
    });
    expect(json).not.toMatch(/GEN\d/);
    expect(r.facts.every((f) => f.sourceRows.length === 0)).toBe(true);
  });

  it("produces totals per metric, company and month", () => {
    expect(
      r.totals.find((t) => t.metricKey === "aktiva_deltagare" && t.month === "2026-08"),
    ).toEqual({
      metricKey: "aktiva_deltagare",
      company: "MBR",
      month: "2026-08",
      value: 3,
    });
    expect(r.facts.every((f) => f.company === "MBR")).toBe(true);
  });
});

describe("buildCases – dates and edge cases", () => {
  const simple = (cases: Partial<CasesTemplateConfig["cases"]> = {}) =>
    config({
      groupBy: [],
      interruptColumn: undefined,
      resultColumn: undefined,
      metrics: { active: "aktiva", started: "nya", ended: "avslutade" },
      ...cases,
    });

  it("handles leap days at month end", () => {
    const r = buildCases(
      table(COLUMNS, [
        ["K1", "KROM", "2024-02-29", null],
        ["K2", "KROM", "2024-02-01", "2024-02-29"],
        ["K3", "KROM", "2023-02-29", null],
      ]),
      simple(),
      { asOfDate: "2024-03-15" },
    );
    expect(pivot(r.facts, "aktiva", "x")).toEqual({ "2024-02": { "-": 2 }, "2024-03": { "-": 1 } });
    expect(pivot(r.facts, "avslutade", "x")).toEqual({
      "2024-02": { "-": 1 },
      "2024-03": { "-": 0 },
    });
    expect(r.skipped).toEqual([
      { sourceRow: 4, reason: "unparseable", detail: 'Ogiltigt startdatum "2023-02-29"' },
    ]);
  });

  it("treats a null end as ongoing and caps events at the as-of date", () => {
    const r = buildCases(
      table(COLUMNS, [
        ["K1", "KROM", "2026-09-01", "2026-09-20"],
        ["K2", "KROM", "2026-09-01", null],
      ]),
      simple(),
      { asOfDate: "2026-09-15" },
    );
    expect(pivot(r.facts, "aktiva", "x")).toEqual({ "2026-09": { "-": 2 } });
    expect(pivot(r.facts, "avslutade", "x")).toEqual({ "2026-09": { "-": 0 } });
  });

  it("starts at fromMonth when configured and reads month-only dates", () => {
    const r = buildCases(
      table(COLUMNS, [["K1", "KROM", "2026-06", "2026-09"]]),
      simple({ fromMonth: "2026-08" }),
      { asOfDate: "2026-10-31" },
    );
    expect(Object.keys(pivot(r.facts, "aktiva", "x"))).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(pivot(r.facts, "aktiva", "x")["2026-09"]).toEqual({ "-": 1 });
    expect(pivot(r.facts, "avslutade", "x")["2026-09"]).toEqual({ "-": 1 });
  });

  it("skips rows without start, with bad dates or ending before they start", () => {
    const r = buildCases(
      table(COLUMNS, [
        ["K1", "KROM", null, null],
        ["K2", "KROM", "x", null],
        ["K3", "KROM", "2026-09-10", "2026-09-01"],
        ["K4", "KROM", "2026-09-10", "nej"],
        ["K5", "KROM", "2026-09-10", null],
      ]),
      simple(),
      { asOfDate: "2026-09-30" },
    );
    expect(r.skipped.map((s) => [s.sourceRow, s.detail])).toEqual([
      [2, "Startdatum saknas"],
      [3, 'Ogiltigt startdatum "x"'],
      [4, "Slutdatum före startdatum"],
      [5, 'Ogiltigt slutdatum "nej"'],
    ]);
    expect(r.rowsUsed).toBe(1);
  });

  it("uses an interruption date column and the end date when it is missing", () => {
    const cols = ["gen", "tjänst", "start", "slut", "avbrott", "avbrottsdatum"];
    const cfg = config({
      groupBy: [],
      resultColumn: undefined,
      interruptDateColumn: "avbrottsdatum",
      metrics: { active: "aktiva", ended: "avslutade", interrupted: "avbrott" },
    });
    const r = buildCases(
      table(cols, [
        ["K1", "KROM", "2026-08-01", "2026-12-31", "Ja", "2026-09-10"],
        ["K2", "KROM", "2026-08-01", "2026-09-20", "Ja", null],
        ["K3", "KROM", "2026-08-01", "2026-09-25", "Nej", "2026-09-01"],
      ]),
      cfg,
      { asOfDate: "2026-10-31" },
    );
    expect(pivot(r.facts, "avbrott", "x")).toEqual({
      "2026-08": { "-": 0 },
      "2026-09": { "-": 2 },
      "2026-10": { "-": 0 },
    });
    expect(pivot(r.facts, "avslutade", "x")["2026-09"]).toEqual({ "-": 3 });
    expect(pivot(r.facts, "aktiva", "x")).toEqual({
      "2026-08": { "-": 3 },
      "2026-09": { "-": 0 },
      "2026-10": { "-": 0 },
    });
  });

  it("computes average tenure over active cases and weights the total", () => {
    const cols = ["gen", "tjänst", "start", "slut"];
    const cfg = config({
      groupBy: ["tjänst"],
      interruptColumn: undefined,
      resultColumn: undefined,
      metrics: { active: "aktiva", tenureMonths: "tenure" },
    });
    const r = buildCases(
      table(cols, [
        ["K1", "KROM", "2026-01-01", null],
        ["K2", "KROM", "2026-03-01", null],
        ["K3", "ROM2", "2026-03-31", "2026-03-31"],
      ]),
      cfg,
      { asOfDate: "2026-03-31" },
    );
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    const m = (a: string, b: string) => days(a, b) / (365.25 / 12);
    const t = pivot(r.facts, "tenure");
    expect(t["2026-01"]!.KROM).toBeCloseTo(m("2026-01-01", "2026-01-31"), 10);
    expect(t["2026-01"]!.ROM2).toBeUndefined();
    expect(t["2026-03"]!.KROM).toBeCloseTo(
      (m("2026-01-01", "2026-03-31") + m("2026-03-01", "2026-03-31")) / 2,
      10,
    );
    expect(t["2026-03"]!.ROM2).toBe(0);
    const total = r.totals.find((x) => x.metricKey === "tenure" && x.month === "2026-03")!;
    expect(total.value).toBeCloseTo(
      (m("2026-01-01", "2026-03-31") + m("2026-03-01", "2026-03-31") + 0) / 3,
      10,
    );
  });

  it("uses a company column and skips unknown companies", () => {
    const cfg = config(
      {
        groupBy: [],
        interruptColumn: undefined,
        resultColumn: undefined,
        metrics: { started: "nya" },
      },
      { company: { kind: "column", column: "tjänst", mapping: { KROM: "MBAB", ROM2: "MBR" } } },
    );
    const r = buildCases(
      table(COLUMNS, [
        ["K1", "KROM", "2026-09-01"],
        ["K2", "ROM2", "2026-09-02"],
        ["K3", "XYZ", "2026-09-03"],
      ]),
      cfg,
      { asOfDate: "2026-09-30" },
    );
    expect(r.facts.map((f) => [f.company, f.value])).toEqual([
      ["MBAB", 1],
      ["MBR", 1],
    ]);
    expect(r.skipped[0]!.detail).toBe('Okänt bolag "XYZ"');
  });

  it("uses the chosen company for per-upload templates", () => {
    const cfg = config(
      {
        groupBy: [],
        interruptColumn: undefined,
        resultColumn: undefined,
        metrics: { started: "nya" },
      },
      { company: { kind: "per_upload" } },
    );
    const t = table(COLUMNS, [["K1", "KROM", "2026-09-01"]]);
    expect(buildCases(t, cfg, { asOfDate: "2026-09-30", company: "MBAB" }).facts[0]!.company).toBe(
      "MBAB",
    );
    const missing = buildCases(t, cfg, { asOfDate: "2026-09-30" });
    expect(missing.facts).toEqual([]);
    expect(missing.issues[0]!.message).toMatch(/Bolag är inte valt/);
  });
});

describe("buildCases – validation and personal data", () => {
  it("rejects an invalid as-of date and a missing start column", () => {
    expect(
      buildCases(table(COLUMNS, []), config(), { asOfDate: "2026-02-30" }).issues[0]!.message,
    ).toMatch(/Exportdatum/);
    const cfg = config({ startColumn: "startdatum" });
    expect(
      buildCases(table(COLUMNS, [["K", "KROM", "2026-01-01"]]), cfg, { asOfDate: "2026-09-30" })
        .issues[0]!.message,
    ).toMatch(/Startkolumnen/);
  });

  it("refuses to group by the key column or by columns without a dimension", () => {
    const cfg = config({
      groupBy: ["gen", "slut", "tjänst"],
      interruptColumn: undefined,
      resultColumn: undefined,
      metrics: { started: "nya" },
    });
    const r = buildCases(table(COLUMNS, [["GEN9", "KROM", "2026-09-01"]]), cfg, {
      asOfDate: "2026-09-30",
    });
    expect(r.issues.map((i) => i.column)).toEqual(["gen", "slut"]);
    expect(r.facts[0]!.dims).toEqual({ verksamhet: "KROM" });
    expect(JSON.stringify(r)).not.toContain("GEN9");
  });

  it("throws PersonalDataError when a group-by column holds personnummer", () => {
    const cfg = config({
      groupBy: ["tjänst"],
      interruptColumn: undefined,
      resultColumn: undefined,
      metrics: { started: "nya" },
    });
    expect(() =>
      buildCases(table(COLUMNS, [["K", "121212-1212", "2026-09-01"]]), cfg, {
        asOfDate: "2026-09-30",
      }),
    ).toThrow(PersonalDataError);
  });

  it("allows personnummer in the key column but never outputs it", () => {
    const cfg = config({
      groupBy: ["tjänst"],
      interruptColumn: undefined,
      resultColumn: undefined,
      metrics: { active: "aktiva" },
    });
    const r = buildCases(
      table(COLUMNS, [
        ["121212-1212", "KROM", "2026-09-01"],
        ["121212-1212", "KROM", "2026-09-01"],
      ]),
      cfg,
      { asOfDate: "2026-09-30" },
    );
    expect(r.facts).toEqual([
      {
        metricKey: "aktiva",
        company: "MBR",
        month: "2026-09",
        dims: { verksamhet: "KROM" },
        value: 1,
        sourceRows: [],
      },
    ]);
    expect(JSON.stringify(r)).not.toContain("1212");
  });

  it("returns no facts for an empty table", () => {
    expect(buildCases(table(COLUMNS, []), config(), { asOfDate: "2026-09-30" }).facts).toEqual([]);
  });

  it("warns when fromMonth is after the as-of date", () => {
    const r = buildCases(
      table(COLUMNS, [["K", "KROM", "2026-09-01"]]),
      config({ fromMonth: "2026-11" }),
      {
        asOfDate: "2026-09-30",
      },
    );
    expect(r.facts).toEqual([]);
    expect(r.issues.at(-1)!.severity).toBe("warning");
  });
});
