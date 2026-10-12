import { describe, expect, it } from "vitest";
import type { MetricResult } from "@/lib/contracts/metric-query";
import { bookedRemainder, needsBookedRemainder, remainderFor } from "./remainder";

const result = (over: Partial<MetricResult>): MetricResult => ({
  metricKey: "x",
  name: "x",
  unit: "kr",
  kind: "sum",
  higherIsBetter: true,
  status: "ok",
  notApplicable: [],
  window: { from: "2026-09", to: "2026-09", label: "september 2026" },
  total: { value: 0, coverage: { withData: 1, expected: 1 }, compare: {} },
  groups: [],
  series: null,
  lastUpdatedAt: null,
  ...over,
});

const cell = (value: number | null) => ({
  value,
  delta: null,
  deltaPct: null,
  deltaPp: null,
  label: "aug 2026",
});

describe("booked revenue remainder", () => {
  it("applies to fakturerat_kund per kund without filters only", () => {
    expect(needsBookedRemainder(["fakturerat_kund"], "kund", [])).toBe(true);
    expect(needsBookedRemainder(["timmar", "fakturerat_kund"], "kund", [])).toBe(true);
    expect(needsBookedRemainder(["fakturerat_kund"], "bolag", [])).toBe(false);
    expect(needsBookedRemainder(["fakturerat_kund"], "kund", [{ dimension: "kund" }])).toBe(false);
    expect(needsBookedRemainder(["timmar"], "kund", [])).toBe(false);
  });

  it("is booked minus the customers (missing customers count as 0)", () => {
    expect(bookedRemainder([100, 50, null], 200)).toBe(50);
    expect(bookedRemainder([100, 120], 200)).toBe(-20);
    expect(bookedRemainder([0.1, 0.2], 0.3)).toBe(0);
    expect(bookedRemainder([100], null)).toBeNull();
  });

  it("covers the comparisons both results have", () => {
    const customers = result({
      metricKey: "fakturerat_kund",
      total: {
        value: 190,
        coverage: { withData: 1, expected: 1 },
        compare: { prev_period: cell(150) },
      },
      groups: [
        {
          id: 1,
          label: "Budbee",
          value: 160,
          coverage: { withData: 1, expected: 1 },
          compare: { prev_period: cell(120) },
        },
        {
          id: 2,
          label: "IKEA",
          value: 30,
          coverage: { withData: 1, expected: 1 },
          compare: { prev_period: cell(30) },
        },
      ],
    });
    const booked = result({
      metricKey: "intakter",
      kind: "ledger",
      total: {
        value: 200,
        coverage: { withData: 1, expected: 1 },
        compare: { prev_period: cell(170), prev_year: cell(90) },
      },
    });
    expect(remainderFor(customers, booked)).toEqual({
      value: 10,
      booked: 200,
      compare: { prev_period: { value: 20, booked: 170 } },
    });
    expect(
      remainderFor(
        customers,
        result({
          status: "no_data",
          total: { value: null, coverage: { withData: 0, expected: 1 }, compare: {} },
        }),
      ),
    ).toBeNull();
  });
});
