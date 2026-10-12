import { describe, expect, it } from "vitest";
import type { MetricDefinition, MetricResult } from "@/lib/contracts/metric-query";
import { resolvePeriod } from "@/lib/core/month";
import { comparisonPlan, runMetricQuery } from "./engine";
import { MetricConfigError } from "./errors";
import { MemoryMetricDataSource, type MemoryFact } from "./memory-source";
import {
  DEFS,
  ID,
  LABELS,
  fact,
  ledgerRow,
  makeSource,
  monthlyFacts,
  query,
} from "./test-fixtures";

type Source = MemoryMetricDataSource;

async function run(source: Source, input: Parameters<typeof query>[0]): Promise<MetricResult> {
  const result = await runMetricQuery(query(input), source);
  return result.results[0] as MetricResult;
}

const SEP = { grain: "month", anchor: "2026-09" } as const;
const Q3 = { grain: "quarter", anchor: "2026-09" } as const;

describe("sum metrics", () => {
  const src = makeSource({
    facts: [
      fact("t1", "timmar", "MBAB", "2026-07", 100, { kund: ID.ikea }),
      fact("t1", "timmar", "MBAB", "2026-08", 80, { kund: ID.ikea }),
      fact("t1", "timmar", "MBAB", "2026-08", 20, { kund: ID.volvo }),
      fact("t1", "timmar", "MBAB", "2026-09", 70, { kund: ID.volvo }),
      fact("t1", "timmar", "MBAB", "2026-09", 30, {}),
      fact("t2", "timmar", "MBR", "2026-09", 50, { kund: ID.ikea }),
    ],
  });

  it("adds months over a quarter and companies for ALL", async () => {
    const r = await run(src, { metricKeys: ["timmar"], period: Q3, company: "ALL" });
    expect(r).toMatchObject({
      status: "ok",
      notApplicable: [],
      metricKey: "timmar",
      name: "Fakturerade timmar",
      unit: "h",
      kind: "sum",
      higherIsBetter: true,
      window: { from: "2026-07", to: "2026-09", label: "kv 3 2026" },
    });
    expect(r.total.value).toBe(350);
    expect(r.total.coverage).toEqual({ withData: 3, expected: 3 });
    expect(r.groups).toEqual([]);
    expect(r.series).toBeNull();
  });

  it("restricts to a single company", async () => {
    expect(
      (await run(src, { metricKeys: ["timmar"], period: SEP, company: "MBAB" })).total.value,
    ).toBe(100);
    expect(
      (await run(src, { metricKeys: ["timmar"], period: SEP, company: "MBR" })).total.value,
    ).toBe(50);
    expect(
      (await run(src, { metricKeys: ["timmar"], period: SEP, company: "ALL" })).total.value,
    ).toBe(150);
  });

  it("groups by bolag with company labels, sorted by value", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: Q3,
      company: "ALL",
      groupBy: "bolag",
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      ["MBAB", "MB AB", 300],
      ["MBR", "MB Restart", 50],
    ]);
    expect(r.groups[0]?.coverage).toEqual({ withData: 3, expected: 3 });
  });

  it("groups by a dimension with labels and '(saknas)' for facts without it", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      [ID.volvo, "Volvo", 70],
      [ID.ikea, "IKEA", 50],
      [null, "(saknas)", 30],
    ]);
    expect(r.total.value).toBe(150);
  });

  it("filters by a dimension", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: Q3,
      company: "ALL",
      filters: [{ dimension: "kund", valueIds: [ID.ikea] }],
    });
    expect(r.total.value).toBe(230);
  });

  it("returns several metrics in query order and echoes the parsed query", async () => {
    const res = await runMetricQuery(
      query({ metricKeys: ["sjukpass", "pass", "timmar"], period: SEP, company: "ALL" }),
      src,
    );
    // pass shares timmar's dataset: the month is covered, so no rows means 0.
    expect(res.results.map((r) => [r.metricKey, r.status, r.total.value])).toEqual([
      ["sjukpass", "no_data", null],
      ["pass", "ok", 0],
      ["timmar", "ok", 150],
    ]);
    expect(res.query).toMatchObject({ scenario: "utfall", groupBy: null, compare: [], topN: null });
  });

  it("falls back to the id when a dimension value has no label", async () => {
    const s = makeSource({ facts: [fact("t", "timmar", "MBAB", "2026-09", 1, { kund: 999 })] });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.groups[0]?.label).toBe("999");
  });

  it("throws for unknown metric keys", async () => {
    await expect(
      runMetricQuery(query({ metricKeys: ["okand"], period: SEP, company: "ALL" }), src),
    ).rejects.toThrow(MetricConfigError);
  });
});

describe("missing data", () => {
  const src = makeSource({
    facts: monthlyFacts("t1", "timmar", "MBAB", [
      ["2026-07", 100],
      ["2026-09", 120],
    ]),
  });

  it("treats a missing month as unknown: partial coverage, not a zero", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    expect(r.status).toBe("ok");
    expect(r.total.value).toBe(220);
    expect(r.total.coverage).toEqual({ withData: 2, expected: 3 });
    expect(r.series).toEqual([
      { month: "2026-07", value: 100 },
      { month: "2026-08", value: null },
      { month: "2026-09", value: 120 },
    ]);
  });

  it("gives null and no_data for a window without data", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: { grain: "month", anchor: "2026-08" },
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.status).toBe("no_data");
    expect(r.total.value).toBeNull();
    expect(r.total.coverage).toEqual({ withData: 0, expected: 1 });
    expect(r.groups).toEqual([]);
  });

  it("counts a covered month without rows as a real zero", async () => {
    const s = makeSource({
      facts: [fact("w1", "nya_deltagare", "MBR", "2026-09", 4, { verksamhet: ID.krom })],
    });
    const r = await run(s, { metricKeys: ["avbrott_deltagare"], period: SEP, company: "ALL" });
    expect(r.status).toBe("ok");
    expect(r.total.value).toBe(0);
    expect(r.total.coverage).toEqual({ withData: 1, expected: 1 });
  });

  it("only expects and reads months up to the anchor", async () => {
    const s = makeSource({
      facts: monthlyFacts("t1", "timmar", "MBAB", [
        ["2026-07", 10],
        ["2026-08", 20],
        ["2026-09", 30],
      ]),
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: { grain: "quarter", anchor: "2026-08" },
      company: "ALL",
      series: "window",
    });
    expect(r.window).toEqual({ from: "2026-07", to: "2026-09", label: "kv 3 2026" });
    expect(r.total.value).toBe(30);
    expect(r.total.coverage).toEqual({ withData: 2, expected: 2 });
    expect(r.series?.map((p) => p.value)).toEqual([10, 20, null]);
  });
});

describe("snapshot metrics", () => {
  const facts: MemoryFact[] = [
    fact("w1", "aktiva_deltagare", "MBAB", "2026-07", 10, { verksamhet: ID.kvl }),
    fact("w1", "aktiva_deltagare", "MBAB", "2026-08", 8, { verksamhet: ID.krom }),
    fact("w1", "aktiva_deltagare", "MBAB", "2026-08", 4, { verksamhet: ID.rom2 }),
    fact("w1", "aktiva_deltagare", "MBAB", "2026-09", 9, { verksamhet: ID.krom }),
    fact("w1", "aktiva_deltagare", "MBAB", "2026-09", 6, { verksamhet: ID.rom2 }),
  ];
  const src = makeSource({ facts });
  const avgDefs: MetricDefinition[] = DEFS.map((d) =>
    d.key === "aktiva_deltagare" ? { ...d, snapshotRollup: "avg" } : d,
  );

  it("takes the last month of a quarter, never the sum of months", async () => {
    const r = await run(src, { metricKeys: ["aktiva_deltagare"], period: Q3, company: "ALL" });
    expect(r.total.value).toBe(15);
    expect(r.total.value).not.toBe(37);
    expect(r.total.coverage).toEqual({ withData: 3, expected: 3 });
  });

  it("averages the months with data for the avg rollup", async () => {
    const s = makeSource({ facts, definitions: avgDefs });
    const r = await run(s, {
      metricKeys: ["aktiva_deltagare"],
      period: Q3,
      company: "ALL",
      groupBy: "verksamhet",
    });
    expect(r.total.value).toBeCloseTo(37 / 3, 10);
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["KROM", 17 / 3],
      ["KVL", 10 / 3],
      ["ROM2", 10 / 3],
    ]);
  });

  it("uses the last month with data when the anchor month is missing", async () => {
    const s = makeSource({ facts: facts.filter((f) => f.month !== "2026-09") });
    const r = await run(s, { metricKeys: ["aktiva_deltagare"], period: Q3, company: "ALL" });
    expect(r.total.value).toBe(12);
    expect(r.total.coverage).toEqual({ withData: 2, expected: 3 });
  });

  it("breaks down by the groups of that last month", async () => {
    const r = await run(src, {
      metricKeys: ["aktiva_deltagare"],
      period: Q3,
      company: "ALL",
      groupBy: "verksamhet",
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["KROM", 9],
      ["ROM2", 6],
    ]);
  });

  it("adds companies within a month and gives per-month values as a series", async () => {
    const s = makeSource({
      facts: [
        ...facts,
        fact("w2", "aktiva_deltagare", "MBR", "2026-09", 5, { verksamhet: ID.krom }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["aktiva_deltagare"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    expect(r.total.value).toBe(20);
    expect(r.series?.map((p) => p.value)).toEqual([10, 12, 20]);
  });

  it("adds an Övriga group for topN (snapshots are additive within a month)", async () => {
    const r = await run(src, {
      metricKeys: ["aktiva_deltagare"],
      period: Q3,
      company: "ALL",
      groupBy: "verksamhet",
      topN: 1,
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      [ID.krom, "KROM", 9],
      [null, "Övriga", 6],
    ]);
  });
});

describe("distinct metrics", () => {
  const facts: MemoryFact[] = [
    fact("t1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.anna, kund: ID.ikea }),
    fact("t1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.bo, kund: ID.ikea }),
    fact("t1", "timmar", "MBAB", "2026-08", 8, { konsult: ID.anna, kund: ID.volvo }),
    fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.anna, kund: ID.ikea }),
    fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.cecilia, kund: ID.volvo }),
  ];
  const src = makeSource({ facts });

  it("counts distinct consultants over the quarter instead of adding monthly counts", async () => {
    const r = await run(src, {
      metricKeys: ["konsulter"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    const monthly = r.series?.map((p) => p.value) ?? [];
    expect(monthly).toEqual([2, 1, 2]);
    const sumOfMonthly = monthly.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(sumOfMonthly).toBe(5);
    const trueDistinct = new Set(facts.map((f) => f.dims.konsult)).size;
    expect(r.total.value).toBe(trueDistinct);
    expect(r.total.value).toBe(3);
    expect(r.total.value).not.toBe(sumOfMonthly);
  });

  it("counts per customer; the total is its own distinct count, not the sum of groups", async () => {
    const r = await run(src, {
      metricKeys: ["konsulter"],
      period: Q3,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["IKEA", 2],
      ["Volvo", 2],
    ]);
    expect(r.total.value).toBe(3);
  });

  it("counts a consultant working in both companies once in total, once per company", async () => {
    const s = makeSource({
      facts: [
        ...facts,
        fact("t2", "timmar", "MBR", "2026-09", 4, { konsult: ID.anna, kund: ID.saab }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["konsulter"],
      period: SEP,
      company: "ALL",
      groupBy: "bolag",
    });
    expect(r.groups.map((g) => [g.id, g.value])).toEqual([
      ["MBAB", 2],
      ["MBR", 1],
    ]);
    expect(r.total.value).toBe(2);
  });

  it("truncates topN without an Övriga group", async () => {
    const s = makeSource({
      facts: [
        ...facts,
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.bo, kund: ID.volvo }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.david, kund: ID.scania }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["konsulter"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
      topN: 2,
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["Volvo", 2],
      ["IKEA", 1],
    ]);
    expect(r.total.value).toBe(4);
  });

  it("is null without data and 0 for a covered window without counted facts", async () => {
    const none = await run(makeSource({}), {
      metricKeys: ["konsulter"],
      period: SEP,
      company: "ALL",
    });
    expect([none.status, none.total.value]).toEqual(["no_data", null]);
    const zero = await run(makeSource({ facts: [fact("t", "pass", "MBAB", "2026-09", 3)] }), {
      metricKeys: ["konsulter"],
      period: SEP,
      company: "ALL",
    });
    expect([zero.status, zero.total.value]).toEqual(["ok", 0]);
  });
});

describe("formula metrics", () => {
  const faktorFacts: MemoryFact[] = [
    fact("f1", "fakturerat_ip", "MBAB", "2026-09", 100, { kund: ID.ikea }),
    fact("f1", "lonekostnad", "MBAB", "2026-09", 50, { kund: ID.ikea }),
    fact("f1", "fakturerat_ip", "MBAB", "2026-09", 300, { kund: ID.volvo }),
    fact("f1", "lonekostnad", "MBAB", "2026-09", 300, { kund: ID.volvo }),
  ];

  it("computes a ratio of sums, not a sum (or mean) of ratios", async () => {
    const r = await run(makeSource({ facts: faktorFacts }), {
      metricKeys: ["faktor"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["IKEA", 2],
      ["Volvo", 1],
    ]);
    const sumOfRatios = r.groups.reduce((a, g) => a + (g.value ?? 0), 0);
    expect(sumOfRatios).toBe(3);
    expect(r.total.value).toBeCloseTo(400 / 350, 12);
    expect(r.total.value).not.toBeCloseTo(sumOfRatios / 2, 3);
    expect(r.total.coverage).toEqual({ withData: 1, expected: 1 });
  });

  it("gives null on division by zero (status stays ok)", async () => {
    const s = makeSource({
      facts: [
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 100, { kund: ID.ikea }),
        fact("f1", "lonekostnad", "MBAB", "2026-09", 0, { kund: ID.ikea }),
      ],
    });
    const r = await run(s, { metricKeys: ["faktor"], period: SEP, company: "ALL" });
    expect(r.status).toBe("ok");
    expect(r.total.value).toBeNull();
  });

  it("evaluates a group whose operand has no rows as that operand being 0", async () => {
    const s = makeSource({
      facts: [
        ...faktorFacts,
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 50, { kund: ID.scania }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["faktor"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["IKEA", 2],
      ["Volvo", 1],
      ["Scania", null],
    ]);
    expect(r.total.value).toBeCloseTo(450 / 350, 12);
  });

  it("rolls each operand up by its own rule (distinct over the window)", async () => {
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.anna }),
        fact("t1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.bo }),
        fact("t1", "timmar", "MBAB", "2026-08", 8, { konsult: ID.anna }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.anna }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.cecilia }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["timmar_per_konsult"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    expect(r.total.value).toBeCloseTo(40 / 3, 12);
    expect(r.series?.map((p) => p.value)).toEqual([8, 8, 8]);
  });

  it("combines operand coverage: a month counts only when every operand has data", async () => {
    const s = makeSource({
      facts: [
        ...monthlyFacts("t1", "timmar", "MBAB", [
          ["2026-07", 95],
          ["2026-08", 100],
          ["2026-09", 187],
        ]),
        ...monthlyFacts("s1", "sjuktimmar", "MBAB", [
          ["2026-07", 5],
          ["2026-09", 13],
        ]),
      ],
    });
    const r = await run(s, {
      metricKeys: ["sjukfranvaro"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    expect(r.total.coverage).toEqual({ withData: 2, expected: 3 });
    // Like for like: August's timmar (no sjuktimmar that month) stays out of the ratio.
    expect(r.total.value).toBeCloseTo((18 / (95 + 187 + 18)) * 100, 10);
    expect(r.total.value).not.toBeCloseTo((18 / (382 + 18)) * 100, 3);
    expect(r.series?.map((p) => p.value)).toEqual([5, null, 6.5]);
  });

  it("is no_data when no month has data for all operands", async () => {
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-07", 95),
        fact("s1", "sjuktimmar", "MBAB", "2026-08", 5),
      ],
    });
    const r = await run(s, { metricKeys: ["sjukfranvaro"], period: Q3, company: "ALL" });
    expect([r.status, r.total.value]).toEqual(["no_data", null]);
  });

  it("evaluates formulas over formulas", async () => {
    const defs: MetricDefinition[] = [
      ...DEFS,
      {
        ...(DEFS.find((d) => d.key === "faktor") as MetricDefinition),
        key: "faktor_procent",
        name: "Faktor i procent",
        unit: "pct",
        formula: "(faktor - 1) * 100",
      },
    ];
    const r = await run(makeSource({ facts: faktorFacts, definitions: defs }), {
      metricKeys: ["faktor_procent"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect(r.total.value).toBeCloseTo((400 / 350 - 1) * 100, 10);
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["IKEA", 100],
      ["Volvo", 0],
    ]);
  });

  it("refuses cyclic and malformed formulas with a MetricConfigError", async () => {
    const formula = (key: string, text: string): MetricDefinition => ({
      key,
      name: key,
      unit: "st",
      kind: "formula",
      datasetKey: null,
      higherIsBetter: null,
      decimals: null,
      formula: text,
      dimensions: [],
    });
    const s = makeSource({
      definitions: [
        ...DEFS,
        formula("a_f", "b_f + 1"),
        formula("b_f", "a_f * 2"),
        formula("bad", "timmar /"),
      ],
    });
    await expect(run(s, { metricKeys: ["a_f"], period: SEP, company: "ALL" })).rejects.toThrow(
      /refererar till sig själv \(a_f → b_f → a_f\)/,
    );
    await expect(run(s, { metricKeys: ["bad"], period: SEP, company: "ALL" })).rejects.toThrow(
      MetricConfigError,
    );
  });
});

describe("ledger metrics", () => {
  const sie = (month: string, scale = 1) => [
    ledgerRow("sie", "MBAB", month, 3010, -1000 * scale),
    ledgerRow("sie", "MBAB", month, 3740, -2 * scale),
    ledgerRow("sie", "MBAB", month, 3010, -600 * scale, { objectValueId: ID.ks100 }),
    ledgerRow("sie", "MBAB", month, 3010, -300 * scale, { objectValueId: ID.ks200 }),
    ledgerRow("sie", "MBAB", month, 4010, 300 * scale),
    ledgerRow("sie", "MBAB", month, 5010, 200 * scale),
    ledgerRow("sie", "MBAB", month, 7010, 400 * scale),
    ledgerRow("sie", "MBAB", month, 7830, 50 * scale),
    ledgerRow("sie", "MBAB", month, 8310, -10 * scale),
    ledgerRow("sie", "MBAB", month, 8410, 5 * scale),
    ledgerRow("sie", "MBAB", month, 8910, 50 * scale),
    ledgerRow("sie", "MBAB", month, 1930, 5000 * scale),
    ledgerRow("sie", "MBAB", month, 2440, -3000 * scale),
  ];
  const src = makeSource({ ledger: sie("2026-09") });

  it("applies account ranges and signs (revenue and net financial income positive)", async () => {
    const res = await runMetricQuery(
      query({
        metricKeys: [
          "intakter",
          "varor_ul",
          "ovriga_externa",
          "personal",
          "avskrivningar",
          "kostnader",
          "finansiella",
          "resultat",
        ],
        period: SEP,
        company: "ALL",
      }),
      src,
    );
    expect(Object.fromEntries(res.results.map((r) => [r.metricKey, r.total.value]))).toEqual({
      intakter: 1002,
      varor_ul: 300,
      ovriga_externa: 200,
      personal: 400,
      avskrivningar: 50,
      kostnader: 950,
      finansiella: 5,
      resultat: 7,
    });
  });

  it("adds months over a window", async () => {
    const s = makeSource({
      ledger: [...sie("2026-07"), ...sie("2026-08", 2), ...sie("2026-09", 3)],
    });
    const r = await run(s, {
      metricKeys: ["intakter"],
      period: Q3,
      company: "ALL",
      series: "window",
    });
    expect(r.total.value).toBe(6012);
    expect(r.series?.map((p) => p.value)).toEqual([1002, 2004, 3006]);
  });

  it("breaks down by kostnadsställe with an Ofördelat remainder", async () => {
    const r = await run(src, {
      metricKeys: ["intakter"],
      period: SEP,
      company: "ALL",
      groupBy: "kostnadsstalle",
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      [ID.ks100, "Bemanning Stockholm", 600],
      [ID.ks200, "Restart Göteborg", 300],
      [null, "Ofördelat", 102],
    ]);
    expect(r.total.value).toBe(1002);
  });

  it("filters by kostnadsställe", async () => {
    const r = await run(src, {
      metricKeys: ["intakter"],
      period: SEP,
      company: "ALL",
      filters: [{ dimension: "kostnadsstalle", valueIds: [ID.ks100] }],
    });
    expect(r.total.value).toBe(600);
  });

  it("is not_applicable for a kund filter or group (never a silent total)", async () => {
    const filtered = await run(src, {
      metricKeys: ["resultat"],
      period: SEP,
      company: "ALL",
      filters: [{ dimension: "kund", valueIds: [ID.ikea] }],
      compare: ["prev_period"],
      series: "last12",
    });
    expect(filtered).toMatchObject({
      status: "not_applicable",
      notApplicable: ["kund"],
      total: { value: null, coverage: { withData: 0, expected: 1 }, compare: {} },
      groups: [],
      series: null,
      lastUpdatedAt: null,
    });
    const grouped = await run(src, {
      metricKeys: ["resultat"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
    });
    expect([grouped.status, grouped.notApplicable]).toEqual(["not_applicable", ["kund"]]);
    const both = await run(src, {
      metricKeys: ["resultatmarginal"],
      period: SEP,
      company: "ALL",
      groupBy: "verksamhet",
      filters: [
        { dimension: "kund", valueIds: [ID.ikea] },
        { dimension: "kostnadsstalle", valueIds: [ID.ks100] },
      ],
    });
    expect(both.notApplicable).toEqual(["verksamhet", "kund"]);
  });

  it("evaluates formulas over ledger metrics", async () => {
    const r = await run(src, { metricKeys: ["resultatmarginal"], period: SEP, company: "ALL" });
    expect(r.total.value).toBeCloseTo((7 / 1002) * 100, 10);
  });

  it("compares with budget from budget_belopp per kontogrupp", async () => {
    const s = makeSource({
      ledger: sie("2026-09"),
      facts: [
        fact("b1", "budget_belopp", "MBAB", "2026-09", 1200, { kontogrupp: ID.kgIntakter }),
        fact("b1", "budget_belopp", "MBAB", "2026-09", 450, { kontogrupp: ID.kgPersonal }),
      ],
      scenarios: { b1: "budget" },
    });
    const r = await run(s, {
      metricKeys: ["intakter"],
      period: SEP,
      company: "ALL",
      compare: ["budget"],
    });
    expect(r.total.compare.budget).toEqual({
      value: 1200,
      delta: -198,
      deltaPct: -16.5,
      deltaPp: null,
      label: "budget",
    });
    const personal = await run(s, {
      metricKeys: ["personal"],
      period: SEP,
      company: "ALL",
      compare: ["budget"],
    });
    expect(personal.total.compare.budget?.value).toBe(450);
    const resultat = await run(s, {
      metricKeys: ["resultat"],
      period: SEP,
      company: "ALL",
      compare: ["budget"],
    });
    // Not budgeted (no kontogrupp rows) is unknown, not a budget of 0.
    expect(resultat.total.compare.budget?.value).toBeNull();
    expect(resultat.total.compare.budget?.delta).toBeNull();
  });
});

describe("comparisons", () => {
  const src = makeSource({
    facts: [
      ...monthlyFacts("t1", "timmar", "MBAB", [
        ["2025-07", 50],
        ["2025-08", 60],
        ["2025-09", 90],
        ["2026-01", 10],
        ["2026-04", 70],
        ["2026-05", 80],
        ["2026-06", 90],
        ["2026-07", 100],
        ["2026-08", 100],
        ["2026-09", 120],
      ]),
      fact("b1", "timmar", "MBAB", "2026-09", 150),
    ],
    scenarios: { b1: "budget" },
  });

  it("compares a month with the previous month, last year and budget", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      compare: ["prev_period", "prev_year", "budget"],
    });
    expect(r.total.compare).toEqual({
      prev_period: { value: 100, delta: 20, deltaPct: 20, deltaPp: null, label: "augusti 2026" },
      prev_year: {
        value: 90,
        delta: 30,
        deltaPct: (30 / 90) * 100,
        deltaPp: null,
        label: "september 2025",
      },
      budget: { value: 150, delta: -30, deltaPct: -20, deltaPp: null, label: "budget" },
    });
  });

  it("compares a quarter with the previous quarter and the same quarter last year", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: Q3,
      company: "ALL",
      compare: ["prev_period", "prev_year"],
    });
    expect(r.total.value).toBe(320);
    expect(r.total.compare.prev_period).toMatchObject({
      value: 240,
      delta: 80,
      label: "kv 2 2026",
    });
    expect(r.total.compare.prev_year).toMatchObject({
      value: 200,
      delta: 120,
      deltaPct: 60,
      label: "kv 3 2025",
    });
  });

  it("omits prev_period for YTD and compares YTD with last year's YTD", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: { grain: "ytd", anchor: "2026-09" },
      company: "ALL",
      compare: ["prev_period", "prev_year"],
    });
    expect(r.window).toEqual({ from: "2026-01", to: "2026-09", label: "jan–sep 2026" });
    expect(r.total.value).toBe(570);
    expect(r.total.coverage).toEqual({ withData: 7, expected: 9 });
    expect(Object.keys(r.total.compare)).toEqual(["prev_year"]);
    expect(r.total.compare.prev_year).toMatchObject({ value: 200, label: "jan–sep 2025" });
  });

  it("follows a broken fiscal year", async () => {
    const s = makeSource({
      fiscalStartMonth: 5,
      facts: monthlyFacts("t1", "timmar", "MBAB", [
        ["2025-05", 1],
        ["2025-09", 2],
        ["2026-04", 1000],
        ["2026-05", 10],
        ["2026-07", 20],
        ["2026-08", 30],
        ["2026-09", 40],
      ]),
    });
    const ytd = await run(s, {
      metricKeys: ["timmar"],
      period: { grain: "ytd", anchor: "2026-09" },
      company: "ALL",
      compare: ["prev_year"],
    });
    expect(ytd.window).toEqual({ from: "2026-05", to: "2026-09", label: "maj–sep 2026" });
    expect(ytd.total.value).toBe(100);
    expect(ytd.total.coverage).toEqual({ withData: 4, expected: 5 });
    expect(ytd.total.compare.prev_year).toMatchObject({ value: 3, label: "maj–sep 2025" });

    const quarter = await run(s, {
      metricKeys: ["timmar"],
      period: Q3,
      company: "ALL",
      compare: ["prev_period"],
    });
    expect(quarter.window).toEqual({ from: "2026-08", to: "2026-10", label: "kv 2 2026/27" });
    expect(quarter.total.value).toBe(70);
    expect(quarter.total.coverage).toEqual({ withData: 2, expected: 2 });
    // Like for like: the first two months of fiscal Q1 (May–Jun), as Q2 has two so far.
    expect(quarter.total.compare.prev_period).toMatchObject({ value: 10, label: "kv 1 2026/27" });
  });

  it("compares a quarter so far with as many months of the previous quarter", async () => {
    const r = await run(src, {
      metricKeys: ["timmar"],
      period: { grain: "quarter", anchor: "2026-08" },
      company: "ALL",
      compare: ["prev_period", "prev_year", "budget"],
    });
    expect(r.total.value).toBe(200);
    expect(r.total.compare.prev_period).toMatchObject({ value: 150, label: "kv 2 2026" });
    expect(r.total.compare.prev_year).toMatchObject({ value: 110, label: "kv 3 2025" });
    expect(r.total.compare.budget?.value).toBeNull();
  });

  it("resolves a query whose metrics are all not applicable", async () => {
    const res = await runMetricQuery(
      query({
        metricKeys: ["resultat", "intakter"],
        period: SEP,
        company: "ALL",
        groupBy: "kund",
      }),
      src,
    );
    expect(res.results.map((r) => [r.status, r.lastUpdatedAt])).toEqual([
      ["not_applicable", null],
      ["not_applicable", null],
    ]);
  });

  it("uses percentage points for pct metrics", async () => {
    const s = makeSource({
      facts: [
        ...monthlyFacts("t1", "timmar", "MBAB", [
          ["2026-08", 95],
          ["2026-09", 187],
        ]),
        ...monthlyFacts("s1", "sjuktimmar", "MBAB", [
          ["2026-08", 5],
          ["2026-09", 13],
        ]),
      ],
    });
    const r = await run(s, {
      metricKeys: ["sjukfranvaro"],
      period: SEP,
      company: "ALL",
      compare: ["prev_period"],
    });
    expect(r.total.value).toBeCloseTo(6.5, 12);
    const cell = r.total.compare.prev_period;
    expect(cell?.value).toBeCloseTo(5, 12);
    expect(cell?.deltaPp).toBeCloseTo(1.5, 12);
    expect(cell?.deltaPct).toBeCloseTo(30, 10);
  });

  it("measures relative change against the absolute base (negative results)", async () => {
    const s = makeSource({
      ledger: [
        ledgerRow("s", "MBAB", "2026-08", 7010, 100),
        ledgerRow("s", "MBAB", "2026-09", 7010, 50),
      ],
    });
    const r = await run(s, {
      metricKeys: ["resultat"],
      period: SEP,
      company: "ALL",
      compare: ["prev_period"],
    });
    expect(r.total.value).toBe(-50);
    expect(r.total.compare.prev_period).toMatchObject({ value: -100, delta: 50, deltaPct: 50 });
  });

  it("has no relative change from a zero base and nulls without comparison data", async () => {
    const s = makeSource({
      facts: [
        fact("w1", "avbrott_deltagare", "MBAB", "2026-09", 3),
        fact("w1", "nya_deltagare", "MBAB", "2026-08", 2),
      ],
    });
    const r = await run(s, {
      metricKeys: ["avbrott_deltagare"],
      period: SEP,
      company: "ALL",
      compare: ["prev_period", "prev_year"],
    });
    expect(r.total.compare.prev_period).toEqual({
      value: 0,
      delta: 3,
      deltaPct: null,
      deltaPp: null,
      label: "augusti 2026",
    });
    expect(r.total.compare.prev_year).toEqual({
      value: null,
      delta: null,
      deltaPct: null,
      deltaPp: null,
      label: "september 2025",
    });
  });

  it("compares groups; a group without rows in a covered comparison window is 0", async () => {
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-08", 40, { kund: ID.ikea }),
        fact("t1", "timmar", "MBAB", "2026-09", 50, { kund: ID.ikea }),
        fact("t1", "timmar", "MBAB", "2026-09", 10, { kund: ID.volvo }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
      compare: ["prev_period", "prev_year"],
    });
    expect(
      r.groups.map((g) => [g.label, g.compare.prev_period?.value, g.compare.prev_period?.deltaPct]),
    ).toEqual([
      ["IKEA", 40, 25],
      ["Volvo", 0, null],
    ]);
    expect(r.groups.map((g) => g.compare.prev_year?.value)).toEqual([null, null]);
  });

  it("treats a company without data in the comparison window as unknown, not 0", async () => {
    const facts = [
      fact("t1", "timmar", "MBAB", "2026-08", 40),
      fact("t1", "timmar", "MBAB", "2026-09", 50),
      fact("t2", "timmar", "MBR", "2026-09", 10),
    ];
    const s = makeSource({ facts });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "bolag",
      compare: ["prev_period"],
    });
    expect(r.groups.map((g) => [g.id, g.compare.prev_period?.value])).toEqual([
      ["MBAB", 40],
      ["MBR", null],
    ]);
    // Once MBR has a covered (empty) August, its August is a real 0.
    const covered = makeSource({
      facts,
      slices: [{ uploadId: "t2aug", datasetKey: "ip_timmar", company: "MBR", month: "2026-08" }],
    });
    const r2 = await run(covered, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "bolag",
      compare: ["prev_period"],
    });
    expect(r2.groups.map((g) => [g.id, g.compare.prev_period?.value])).toEqual([
      ["MBAB", 40],
      ["MBR", 0],
    ]);
  });

  it("applies the same company rule to distinct and formula metrics", async () => {
    const s = makeSource({
      facts: [
        fact("f1", "fakturerat_ip", "MBAB", "2026-08", 100, { konsult: ID.anna }),
        fact("f1", "lonekostnad", "MBAB", "2026-08", 50, { konsult: ID.anna }),
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 100, { konsult: ID.anna }),
        fact("f1", "lonekostnad", "MBAB", "2026-09", 50, { konsult: ID.anna }),
        fact("f2", "fakturerat_ip", "MBR", "2026-09", 90, { konsult: ID.bo }),
        fact("f2", "lonekostnad", "MBR", "2026-09", 60, { konsult: ID.bo }),
        fact("t1", "timmar", "MBAB", "2026-08", 8, { konsult: ID.anna }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.anna }),
        fact("t2", "timmar", "MBR", "2026-09", 8, { konsult: ID.bo }),
      ],
    });
    const faktor = await run(s, {
      metricKeys: ["faktor"],
      period: SEP,
      company: "ALL",
      groupBy: "bolag",
      compare: ["prev_period"],
    });
    expect(faktor.groups.map((g) => [g.id, g.value, g.compare.prev_period?.value])).toEqual([
      ["MBAB", 2, 2],
      ["MBR", 1.5, null],
    ]);
    const konsulter = await run(s, {
      metricKeys: ["konsulter"],
      period: SEP,
      company: "ALL",
      groupBy: "bolag",
      compare: ["prev_period"],
    });
    expect(konsulter.groups.map((g) => [g.id, g.compare.prev_period?.value])).toEqual([
      ["MBAB", 1],
      ["MBR", null],
    ]);
  });

  it("puts the rest into Övriga for topN, including groups gone since the comparison", async () => {
    const s = makeSource({
      facts: [
        ...[
          [ID.ikea, 50],
          [ID.volvo, 40],
          [ID.scania, 30],
          [ID.ericsson, 20],
          [ID.abb, 10],
        ].map(([kund, v]) =>
          fact("t1", "timmar", "MBAB", "2026-09", v as number, { kund: kund as number }),
        ),
        ...[
          [ID.ikea, 25],
          [ID.volvo, 40],
          [ID.scania, 30],
          [ID.ericsson, 10],
          [ID.saab, 15],
        ].map(([kund, v]) =>
          fact("t1", "timmar", "MBAB", "2026-08", v as number, { kund: kund as number }),
        ),
      ],
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
      topN: 3,
      compare: ["prev_period"],
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      [ID.ikea, "IKEA", 50],
      [ID.volvo, "Volvo", 40],
      [ID.scania, "Scania", 30],
      [null, "Övriga", 30],
    ]);
    expect(r.groups[3]?.compare.prev_period).toEqual({
      value: 25,
      delta: 5,
      deltaPct: 20,
      deltaPp: null,
      label: "augusti 2026",
    });
    expect(r.groups[3]?.coverage).toEqual(r.total.coverage);
    expect(r.total.value).toBe(150);
  });

  it("does not add Övriga when topN keeps every group", async () => {
    const s = makeSource({
      facts: [fact("t1", "timmar", "MBAB", "2026-09", 5, { kund: ID.ikea })],
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
      topN: 3,
    });
    expect(r.groups.map((g) => g.label)).toEqual(["IKEA"]);
  });
});

describe("series and lineage", () => {
  it("returns the 12 months ending at the anchor with nulls for months without data", async () => {
    const s = makeSource({
      facts: monthlyFacts("t1", "timmar", "MBAB", [
        ["2025-09", 1],
        ["2025-10", 2],
        ["2026-03", 3],
        ["2026-09", 4],
      ]),
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      series: "last12",
    });
    expect(r.series?.map((p) => p.month)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(r.series?.map((p) => p.value)).toEqual([
      2,
      null,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      null,
      null,
      4,
    ]);
  });

  it("reports when the data behind each metric was last published", async () => {
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-09", 1),
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 1),
        fact("f2", "lonekostnad", "MBAB", "2026-09", 1),
      ],
      uploadTimes: {
        t1: "2026-10-02T08:00:00Z",
        f1: "2026-10-03T08:00:00Z",
        f2: "2026-10-04T08:00:00Z",
      },
    });
    const res = await runMetricQuery(
      query({ metricKeys: ["timmar", "faktor", "pass"], period: SEP, company: "ALL" }),
      s,
    );
    expect(res.results.map((r) => r.lastUpdatedAt)).toEqual([
      "2026-10-02T08:00:00Z",
      "2026-10-04T08:00:00Z",
      "2026-10-02T08:00:00Z",
    ]);
  });

  it("reads labels through the source (only for the ids it shows)", async () => {
    const calls: [string, number[]][] = [];
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-09", 5, { kund: ID.ikea }),
        fact("t1", "timmar", "MBAB", "2026-09", 5, {}),
      ],
    });
    const spy = Object.assign(Object.create(Object.getPrototypeOf(s)), s) as Source;
    spy.labels = async (dimension, ids) => {
      calls.push([dimension, ids]);
      return { [ID.ikea]: LABELS.kund?.[ID.ikea] ?? "" };
    };
    await run(spy, { metricKeys: ["timmar"], period: SEP, company: "ALL", groupBy: "kund" });
    expect(calls).toEqual([["kund", [ID.ikea]]]);
  });
});

describe("formula operands over the months they share", () => {
  it("reads a distinct operand only over the months every operand has", async () => {
    // ip_timmar has Jul–Sep, ip_fakturering only Jul–Aug: September's consultants must
    // not dilute July–August's invoicing.
    const s = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.anna }),
        fact("t1", "timmar", "MBAB", "2026-08", 8, { konsult: ID.bo }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.cecilia }),
        fact("t1", "timmar", "MBAB", "2026-09", 8, { konsult: ID.david }),
        fact("f1", "fakturerat_ip", "MBAB", "2026-07", 100),
        fact("f1", "fakturerat_ip", "MBAB", "2026-08", 100),
      ],
    });
    const r = await run(s, { metricKeys: ["intakt_per_konsult"], period: Q3, company: "ALL" });
    expect(r.total.coverage).toEqual({ withData: 2, expected: 3 });
    expect(r.total.value).toBe(100);
  });

  it("takes a snapshot operand's last month among the shared months", async () => {
    const defs: MetricDefinition[] = [
      ...DEFS,
      {
        key: "timmar_per_anstalld",
        name: "Timmar per anställd",
        unit: "h",
        kind: "formula",
        datasetKey: null,
        higherIsBetter: true,
        decimals: 1,
        formula: "timmar / anstallda_konsulter",
        dimensions: [],
      },
    ];
    const s = makeSource({
      definitions: defs,
      facts: [
        ...monthlyFacts("t1", "timmar", "MBAB", [
          ["2026-07", 100],
          ["2026-08", 300],
        ]),
        ...monthlyFacts("k1", "anstallda_konsulter", "MBAB", [
          ["2026-07", 10],
          ["2026-08", 20],
          ["2026-09", 40],
        ]),
      ],
    });
    const r = await run(s, { metricKeys: ["timmar_per_anstalld"], period: Q3, company: "ALL" });
    expect(r.total.value).toBe(400 / 20);
  });

  it("applies the shared months to groups and comparisons as well", async () => {
    const s = makeSource({
      facts: [
        ...monthlyFacts(
          "t1",
          "timmar",
          "MBAB",
          [
            ["2025-07", 90],
            ["2025-08", 90],
            ["2025-09", 90],
            ["2026-07", 95],
            ["2026-08", 100],
            ["2026-09", 187],
          ],
          { kund: ID.ikea },
        ),
        ...monthlyFacts(
          "s1",
          "sjuktimmar",
          "MBAB",
          [
            ["2025-07", 10],
            ["2025-09", 10],
            ["2026-07", 5],
            ["2026-09", 13],
          ],
          { kund: ID.ikea },
        ),
      ],
    });
    const r = await run(s, {
      metricKeys: ["sjukfranvaro"],
      period: Q3,
      company: "ALL",
      groupBy: "kund",
      compare: ["prev_year"],
    });
    const expected = (18 / (95 + 187 + 18)) * 100;
    expect(r.total.value).toBeCloseTo(expected, 10);
    expect(r.groups[0]?.value).toBeCloseTo(expected, 10);
    expect(r.total.compare.prev_year?.value).toBeCloseTo((20 / (180 + 20)) * 100, 10);
    expect(r.groups[0]?.compare.prev_year?.value).toBeCloseTo(10, 10);
  });

  it("truncates topN for formula groups without an Övriga group", async () => {
    const s = makeSource({
      facts: [
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 300, { kund: ID.ikea }),
        fact("f1", "lonekostnad", "MBAB", "2026-09", 100, { kund: ID.ikea }),
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 200, { kund: ID.volvo }),
        fact("f1", "lonekostnad", "MBAB", "2026-09", 100, { kund: ID.volvo }),
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 100, { kund: ID.scania }),
        fact("f1", "lonekostnad", "MBAB", "2026-09", 100, { kund: ID.scania }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["faktor"],
      period: SEP,
      company: "ALL",
      groupBy: "kund",
      topN: 2,
    });
    expect(r.groups.map((g) => [g.label, g.value])).toEqual([
      ["IKEA", 3],
      ["Volvo", 2],
    ]);
    expect(r.total.value).toBe(2);
  });
});

describe("review regressions", () => {
  it("compares a budget query with the previous budget, not with actuals", async () => {
    const s = makeSource({
      facts: [
        fact("u1", "timmar", "MBAB", "2026-08", 999),
        fact("b1", "timmar", "MBAB", "2026-08", 100),
        fact("b1", "timmar", "MBAB", "2026-09", 120),
        fact("b0", "timmar", "MBAB", "2025-09", 60),
      ],
      scenarios: { b1: "budget", b0: "budget" },
    });
    const r = await run(s, {
      metricKeys: ["timmar"],
      period: SEP,
      company: "ALL",
      scenario: "budget",
      compare: ["prev_period", "prev_year"],
    });
    expect(r.total.value).toBe(120);
    expect(r.total.compare.prev_period?.value).toBe(100);
    expect(r.total.compare.prev_year?.value).toBe(60);
  });

  it("reports lastUpdatedAt for a formula even when the source does not resolve formulas", async () => {
    const s = makeSource({
      facts: [
        fact("f1", "fakturerat_ip", "MBAB", "2026-09", 1),
        fact("f2", "lonekostnad", "MBAB", "2026-09", 1),
      ],
      uploadTimes: { f1: "2026-10-03T08:00:00Z", f2: "2026-10-04T08:00:00Z" },
    });
    const asked: string[][] = [];
    const naive = Object.assign(Object.create(Object.getPrototypeOf(s)), s) as Source;
    naive.lastUpdated = async (keys, scope) => {
      asked.push(keys);
      const out = await s.lastUpdated(keys, scope);
      // Like a SQL source joining uploads on metric_values: a formula has no rows.
      for (const k of keys) if (DEFS.find((d) => d.key === k)?.kind === "formula") out[k] = null;
      return out;
    };
    const r = await run(naive, { metricKeys: ["faktor"], period: SEP, company: "ALL" });
    expect(r.lastUpdatedAt).toBe("2026-10-04T08:00:00Z");
    expect(asked).toEqual([["faktor", "fakturerat_ip", "lonekostnad"]]);
  });

  it("orders groups with equal values and labels by id, whatever the row order", async () => {
    const labels = { ...LABELS, kund: { ...LABELS.kund, [ID.volvo]: "IKEA" } };
    const facts = [
      fact("t1", "timmar", "MBAB", "2026-09", 10, { kund: ID.volvo }),
      fact("t1", "timmar", "MBAB", "2026-09", 10, { kund: ID.ikea }),
      fact("t1", "timmar", "MBAB", "2026-09", 5, { kund: ID.scania }),
    ];
    for (const ordered of [facts, [...facts].reverse()]) {
      const s = makeSource({ facts: ordered, labels });
      const reversed = Object.assign(Object.create(Object.getPrototypeOf(s)), s) as Source;
      reversed.monthly = async (keys, scope) => (await s.monthly(keys, scope)).reverse();
      for (const source of [s, reversed]) {
        const r = await run(source, {
          metricKeys: ["timmar"],
          period: SEP,
          company: "ALL",
          groupBy: "kund",
          topN: 1,
        });
        expect(r.groups.map((g) => [g.id, g.value])).toEqual([
          [ID.ikea, 10],
          [null, 15],
        ]);
      }
    }
  });

  it("puts the rest of a ledger breakdown into Övriga, Ofördelat included", async () => {
    const s = makeSource({
      ledger: [
        ledgerRow("sie", "MBAB", "2026-09", 3010, -1000),
        ledgerRow("sie", "MBAB", "2026-09", 3010, -600, { objectValueId: ID.ks100 }),
        ledgerRow("sie", "MBAB", "2026-09", 3010, -300, { objectValueId: ID.ks200 }),
      ],
    });
    const r = await run(s, {
      metricKeys: ["intakter"],
      period: SEP,
      company: "ALL",
      groupBy: "kostnadsstalle",
      topN: 1,
    });
    expect(r.groups.map((g) => [g.id, g.label, g.value])).toEqual([
      [ID.ks100, "Bemanning Stockholm", 600],
      [null, "Övriga", 400],
    ]);
  });

  it("splits ledger budget by kostnadsställe, unallocated budget as Ofördelat", async () => {
    const s = makeSource({
      ledger: [
        ledgerRow("sie", "MBAB", "2026-09", 3010, -1000),
        ledgerRow("sie", "MBAB", "2026-09", 3010, -700, { objectValueId: ID.ks100 }),
      ],
      facts: [
        fact("b1", "budget_belopp", "MBAB", "2026-09", 800, {
          kontogrupp: ID.kgIntakter,
          kostnadsstalle: ID.ks100,
        }),
        fact("b1", "budget_belopp", "MBAB", "2026-09", 100, { kontogrupp: ID.kgIntakter }),
      ],
      scenarios: { b1: "budget" },
    });
    const r = await run(s, {
      metricKeys: ["intakter"],
      period: SEP,
      company: "ALL",
      groupBy: "kostnadsstalle",
      compare: ["budget"],
    });
    expect(r.total.compare.budget?.value).toBe(900);
    expect(r.groups.map((g) => [g.label, g.value, g.compare.budget?.value])).toEqual([
      ["Bemanning Stockholm", 700, 800],
      ["Ofördelat", 300, 100],
    ]);
  });
});

describe("comparisonPlan", () => {
  const window = (grain: "month" | "quarter" | "ytd", anchor: string, fiscalStart = 1) =>
    resolvePeriod({ grain, anchor }, fiscalStart);

  it("returns the months each comparison reads", () => {
    expect(comparisonPlan("prev_period", window("quarter", "2026-08"), 1)).toEqual({
      kind: "prev_period",
      range: { from: "2026-04", to: "2026-05", months: ["2026-04", "2026-05"] },
      scenario: "utfall",
      label: "kv 2 2026",
    });
    expect(comparisonPlan("prev_year", window("ytd", "2026-09", 5), 5)).toEqual({
      kind: "prev_year",
      range: {
        from: "2025-05",
        to: "2025-09",
        months: ["2025-05", "2025-06", "2025-07", "2025-08", "2025-09"],
      },
      scenario: "utfall",
      label: "maj–sep 2025",
    });
    expect(comparisonPlan("budget", window("month", "2026-09"), 1, "budget")).toEqual({
      kind: "budget",
      range: { from: "2026-09", to: "2026-09", months: ["2026-09"] },
      scenario: "budget",
      label: "budget",
    });
  });

  it("has no previous period for YTD and keeps the query's scenario", () => {
    expect(comparisonPlan("prev_period", window("ytd", "2026-09"), 1)).toBeNull();
    expect(comparisonPlan("prev_period", window("month", "2026-09"), 1, "budget")?.scenario).toBe(
      "budget",
    );
  });
});
