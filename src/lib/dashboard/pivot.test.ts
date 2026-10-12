import { describe, expect, it } from "vitest";
import type { MetricDefinition, MetricResult } from "@/lib/contracts/metric-query";
import { NBSP } from "@/lib/core/format-sv";
import { catalogDefinitions } from "@/lib/metrics";
import {
  breakdownChart,
  buildGroupPivot,
  pivotCsvRows,
  sortPivotRows,
  toPivotDelta,
  valueCell,
  type PivotRow,
} from "./pivot";

const DEFS = new Map(catalogDefinitions().map((d) => [d.key, d]));
const def = (k: string) => DEFS.get(k) as MetricDefinition;
const s = (t: string) => t.replaceAll(" ", NBSP);
const cmp = (value: number | null, current: number | null, label = "aug 2026") => ({
  value,
  delta: value === null || current === null ? null : current - value,
  deltaPct:
    value === null || current === null || value === 0
      ? null
      : ((current - value) / Math.abs(value)) * 100,
  deltaPp: null,
  label,
});

function result(
  key: string,
  groups: [number | string | null, string, number | null, number | null][],
): MetricResult {
  const d = def(key);
  const total = groups.reduce((a, g) => a + (g[2] ?? 0), 0);
  const prev = groups.reduce((a, g) => a + (g[3] ?? 0), 0);
  return {
    metricKey: key,
    name: d.name,
    unit: d.unit,
    kind: d.kind,
    higherIsBetter: d.higherIsBetter,
    status: "ok",
    notApplicable: [],
    window: { from: "2026-09", to: "2026-09", label: "september 2026" },
    total: {
      value: total,
      coverage: { withData: 1, expected: 1 },
      compare: { prev_period: cmp(prev, total) },
    },
    groups: groups.map(([id, label, value, p]) => ({
      id,
      label,
      value,
      coverage: { withData: 1, expected: 1 },
      compare: { prev_period: cmp(p, value) },
    })),
    series: null,
    lastUpdatedAt: null,
  };
}

const row = (label: string, raw: number | null): PivotRow => ({
  key: label,
  label,
  kind: "group",
  drill: null,
  entity: null,
  cells: { m0: { raw, text: String(raw), csv: String(raw) } },
});

describe("pivot table", () => {
  it("formats values with the metric's unit and decimals", () => {
    expect(valueCell(1234567, def("intakter"))).toEqual({
      raw: 1234567,
      text: s("1 234 567 kr"),
      csv: "1234567",
    });
    expect(valueCell(1.8, def("faktor"))).toEqual({ raw: 1.8, text: "1,80", csv: "1,80" });
    expect(valueCell(null, def("timmar"))).toEqual({ raw: null, text: "–", csv: "" });
  });

  it("judges deltas by higherIsBetter", () => {
    expect(toPivotDelta(cmp(100, 120), "h", true)).toEqual({
      direction: "up",
      formatted: s("+20 %"),
      favorable: true,
      againstLabel: "mot aug 2026",
    });
    expect(toPivotDelta(cmp(100, 120), "h", false)?.favorable).toBe(false);
    expect(toPivotDelta(cmp(100, 120), "st", null)?.favorable).toBeNull();
    expect(toPivotDelta(undefined, "h", true)).toBeNull();
  });

  it("builds one column per metric in multi mode and joins groups", () => {
    const model = buildGroupPivot({
      defs: [def("timmar"), def("konsulter")],
      results: [
        result("timmar", [
          [1, "Budbee", 200, 180],
          [2, "IKEA", 60, 70],
        ]),
        result("konsulter", [
          [2, "IKEA", 1, 1],
          [3, "Volvo", 2, 0],
        ]),
      ],
      groupBy: "kund",
      groupLabel: "Kund",
    });
    expect(model.columns.map((c) => c.key)).toEqual(["m0", "m1"]);
    expect(model.rows.map((r) => r.label)).toEqual(["Budbee", "IKEA", "Volvo"]);
    expect(model.rows[2]?.cells.m0).toBeUndefined();
    expect(model.rows[1]?.cells.m0?.delta?.direction).toBe("down");
    expect(model.rows[0]?.entity).toEqual({ dimension: "kund", valueId: 1 });
    expect(model.footer[0]?.cells.m0?.raw).toBe(260);
  });

  it("drills company rows by code and leaves Övriga undrillable", () => {
    const model = buildGroupPivot({
      defs: [def("timmar")],
      results: [
        result("timmar", [
          ["MBAB", "MB AB", 10, 5],
          [null, "Övriga", 1, 1],
        ]),
      ],
      groupBy: "bolag",
      groupLabel: "Bolag",
    });
    expect(model.rows.map((r) => r.drill)).toEqual([{ kind: "company", company: "MBAB" }, null]);
    expect(model.rows.map((r) => r.entity)).toEqual([null, null]);
  });

  it("sorts with missing values last in both directions", () => {
    const rows = [row("b", 2), row("a", null), row("c", 3), row("d", 2)];
    expect(sortPivotRows(rows, { key: "m0", dir: "desc" }).map((r) => r.label)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
    expect(sortPivotRows(rows, { key: "m0", dir: "asc" }).map((r) => r.label)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
    expect(sortPivotRows(rows, { key: "label", dir: "asc" }).map((r) => r.label)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(sortPivotRows(rows, null)).toEqual(rows);
  });

  it("exports the label column, every column and the footer", () => {
    const model = buildGroupPivot({
      defs: [def("timmar")],
      results: [result("timmar", [[1, "Budbee", 200.5, 180]])],
      groupBy: "kund",
      groupLabel: "Kund",
    });
    const csv = pivotCsvRows(model, model.rows);
    expect(csv.header).toEqual([
      "Kund",
      "Fakturerade timmar september 2026",
      "Förändring mot aug 2026 (%)",
      "Månader med data",
    ]);
    expect(csv.rows).toEqual([
      ["Budbee", "201", "11,4", "1/1"],
      ["Totalt", "201", "11,4", "1/1"],
    ]);
  });

  it("charts at most 12 groups against the previous period", () => {
    const groups = Array.from(
      { length: 15 },
      (_, i) => [i + 1, `K${i + 1}`, 100 - i, 50] as [number, string, number, number],
    );
    const chart = breakdownChart(result("timmar", groups), def("timmar"));
    expect(chart?.categories).toHaveLength(12);
    expect(chart?.series.map((x) => x.label)).toEqual(["September 2026", "Aug 2026"]);
  });
});
