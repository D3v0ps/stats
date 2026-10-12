import { describe, expect, it } from "vitest";
import type { SourceScope } from "@/lib/contracts/metric-query";
import { catalogDefinitions } from "./catalog";
import { MemoryMetricDataSource } from "./memory-source";
import { ID, fact, ledgerRow, makeSource } from "./test-fixtures";

const scope = (over: Partial<SourceScope> = {}): SourceScope => ({
  companies: ["MBAB", "MBR"],
  scenario: "utfall",
  from: "2026-01",
  to: "2026-12",
  groupBy: [],
  filters: [],
  ...over,
});

describe("MemoryMetricDataSource.monthly", () => {
  it("sums current facts per metric, month and group", async () => {
    const src = makeSource({
      facts: [
        fact("u1", "timmar", "MBAB", "2026-08", 10, { kund: ID.ikea, konsult: ID.anna }),
        fact("u1", "timmar", "MBAB", "2026-08", 5, { kund: ID.ikea, konsult: ID.bo }),
        fact("u1", "timmar", "MBAB", "2026-08", 7, { kund: ID.volvo, konsult: ID.bo }),
        fact("u1", "pass", "MBAB", "2026-08", 3, { kund: ID.volvo, konsult: ID.bo }),
      ],
    });
    expect(await src.monthly(["timmar"], scope({ groupBy: ["kund"] }))).toEqual([
      { metricKey: "timmar", month: "2026-08", group: { kund: ID.ikea }, value: 15 },
      { metricKey: "timmar", month: "2026-08", group: { kund: ID.volvo }, value: 7 },
    ]);
    expect(await src.monthly(["timmar", "pass"], scope())).toEqual([
      { metricKey: "pass", month: "2026-08", group: {}, value: 3 },
      { metricKey: "timmar", month: "2026-08", group: {}, value: 22 },
    ]);
  });

  it('groups by company for "bolag" and yields null for a missing dimension', async () => {
    const src = makeSource({
      facts: [
        fact("u1", "timmar", "MBAB", "2026-08", 10, { kund: ID.ikea }),
        fact("u2", "timmar", "MBR", "2026-08", 4, {}),
      ],
    });
    expect(await src.monthly(["timmar"], scope({ groupBy: ["bolag", "kund"] }))).toEqual([
      { metricKey: "timmar", month: "2026-08", group: { bolag: "MBAB", kund: ID.ikea }, value: 10 },
      { metricKey: "timmar", month: "2026-08", group: { bolag: "MBR", kund: null }, value: 4 },
    ]);
  });

  it("applies companies, months, scenario and filters (a fact lacking the dimension fails)", async () => {
    const src = makeSource({
      facts: [
        fact("u1", "timmar", "MBAB", "2026-08", 10, { kund: ID.ikea }),
        fact("u1", "timmar", "MBAB", "2026-08", 3, {}),
        fact("u1", "timmar", "MBAB", "2025-08", 99, { kund: ID.ikea }),
        fact("u2", "timmar", "MBR", "2026-08", 4, { kund: ID.ikea }),
        fact("b1", "timmar", "MBAB", "2026-08", 50, { kund: ID.ikea }),
      ],
      scenarios: { b1: "budget" },
    });
    const filters = [{ dimension: "kund", valueIds: [ID.ikea] }];
    expect(await src.monthly(["timmar"], scope({ companies: ["MBAB"], filters }))).toEqual([
      { metricKey: "timmar", month: "2026-08", group: {}, value: 10 },
    ]);
    expect(await src.monthly(["timmar"], scope({ scenario: "budget" }))).toEqual([
      { metricKey: "timmar", month: "2026-08", group: {}, value: 50 },
    ]);
  });

  it("reads only current slices: retracted uploads are ignored, the newest upload wins", async () => {
    const src = makeSource({
      facts: [
        fact("old", "timmar", "MBAB", "2026-08", 10),
        fact("new", "timmar", "MBAB", "2026-08", 12),
        fact("old", "timmar", "MBAB", "2026-07", 8),
        fact("retracted", "timmar", "MBAB", "2026-06", 100),
      ],
      current: new Set(["old", "new"]),
      uploadTimes: { old: "2026-09-01T10:00:00Z", new: "2026-09-05T10:00:00Z" },
    });
    expect(await src.monthly(["timmar"], scope())).toEqual([
      { metricKey: "timmar", month: "2026-07", group: {}, value: 8 },
      { metricKey: "timmar", month: "2026-08", group: {}, value: 12 },
    ]);
  });

  it("lets a later current upload win when publish times tie", async () => {
    const src = makeSource({
      facts: [fact("a", "timmar", "MBAB", "2026-08", 1), fact("b", "timmar", "MBAB", "2026-08", 2)],
      current: ["b", "a"],
    });
    expect((await src.monthly(["timmar"], scope()))[0]?.value).toBe(1);
  });

  it("rejects facts for metrics it does not know", () => {
    expect(() => makeSource({ facts: [fact("u", "okand", "MBAB", "2026-08", 1)] })).toThrow(
      /okänt mått okand/,
    );
  });
});

describe("MemoryMetricDataSource.distinct", () => {
  const src = makeSource({
    facts: [
      fact("u1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.anna, kund: ID.ikea }),
      fact("u1", "timmar", "MBAB", "2026-07", 8, { konsult: ID.bo, kund: ID.ikea }),
      fact("u1", "timmar", "MBAB", "2026-08", 8, { konsult: ID.anna, kund: ID.volvo }),
      fact("u1", "timmar", "MBAB", "2026-08", 0, { konsult: ID.cecilia, kund: ID.volvo }),
      fact("u1", "timmar", "MBAB", "2026-08", -2, { konsult: ID.david, kund: ID.volvo }),
      fact("u1", "timmar", "MBAB", "2026-08", 5, { kund: ID.volvo }),
    ],
  });

  it("counts distinct values among facts with value > 0 over the window", async () => {
    expect(await src.distinct("timmar", "konsult", scope(), false)).toEqual([
      { month: null, group: {}, count: 2 },
    ]);
  });

  it("counts per month and per group", async () => {
    expect(await src.distinct("timmar", "konsult", scope(), true)).toEqual([
      { month: "2026-07", group: {}, count: 2 },
      { month: "2026-08", group: {}, count: 1 },
    ]);
    expect(await src.distinct("timmar", "konsult", scope({ groupBy: ["kund"] }), false)).toEqual([
      { month: null, group: { kund: ID.ikea }, count: 2 },
      { month: null, group: { kund: ID.volvo }, count: 1 },
    ]);
  });
});

describe("MemoryMetricDataSource.coverage", () => {
  it("covers months where the metric's dataset has a current slice, also without rows", async () => {
    const src = makeSource({
      facts: [fact("u1", "pass", "MBAB", "2026-08", 3)],
      slices: [{ uploadId: "u2", datasetKey: "ip_timmar", company: "MBR", month: "2026-09" }],
    });
    expect(await src.coverage(["timmar", "konsulter", "faktor", "sjuktimmar"], scope())).toEqual({
      timmar: ["2026-08", "2026-09"],
      konsulter: ["2026-08", "2026-09"],
      faktor: [],
      sjuktimmar: [],
    });
    expect(await src.coverage(["timmar"], scope({ companies: ["MBAB"] }))).toEqual({
      timmar: ["2026-08"],
    });
  });

  it("uses budget_belopp coverage for ledger metrics in the budget scenario", async () => {
    const src = makeSource({
      facts: [fact("b1", "budget_belopp", "MBAB", "2026-03", 100, { kontogrupp: ID.kgIntakter })],
      ledger: [ledgerRow("s1", "MBAB", "2026-02", 3010, -100)],
      scenarios: { b1: "budget" },
    });
    expect(await src.coverage(["intakter"], scope())).toEqual({ intakter: ["2026-02"] });
    expect(await src.coverage(["intakter"], scope({ scenario: "budget" }))).toEqual({
      intakter: ["2026-03"],
    });
  });
});

describe("MemoryMetricDataSource.ledger", () => {
  const rows = [
    ledgerRow("s1", "MBAB", "2026-08", 3010, -1000),
    ledgerRow("s1", "MBAB", "2026-08", 3010, -600, { objectValueId: ID.ks100 }),
    ledgerRow("s1", "MBAB", "2026-08", 3010, -300, { objectValueId: ID.ks200 }),
    ledgerRow("s1", "MBAB", "2026-08", 7010, 400),
    ledgerRow("s1", "MBAB", "2026-08", 7010, 400, { objectValueId: ID.ks100 }),
    ledgerRow("s1", "MBAB", "2026-08", 1930, 5000),
  ];

  it("sums account totals times the group sign, never adding object rows", async () => {
    const src = makeSource({ ledger: rows });
    expect(await src.ledger(["intakter", "personal", "resultat"], scope())).toEqual([
      { accountGroupKey: "intakter", month: "2026-08", group: {}, value: 1000 },
      { accountGroupKey: "personal", month: "2026-08", group: {}, value: 400 },
      { accountGroupKey: "resultat", month: "2026-08", group: {}, value: 600 },
    ]);
  });

  it("splits by kostnadsställe with an unallocated remainder (null) that adds up", async () => {
    const src = makeSource({ ledger: rows });
    expect(
      await src.ledger(["intakter", "personal"], scope({ groupBy: ["kostnadsstalle"] })),
    ).toEqual([
      {
        accountGroupKey: "intakter",
        month: "2026-08",
        group: { kostnadsstalle: ID.ks100 },
        value: 600,
      },
      {
        accountGroupKey: "intakter",
        month: "2026-08",
        group: { kostnadsstalle: ID.ks200 },
        value: 300,
      },
      {
        accountGroupKey: "intakter",
        month: "2026-08",
        group: { kostnadsstalle: null },
        value: 100,
      },
      {
        accountGroupKey: "personal",
        month: "2026-08",
        group: { kostnadsstalle: ID.ks100 },
        value: 400,
      },
    ]);
  });

  it("honours a kostnadsställe filter and refuses any other filter", async () => {
    const src = makeSource({ ledger: rows });
    const filters = [{ dimension: "kostnadsstalle", valueIds: [ID.ks200] }];
    expect(await src.ledger(["intakter"], scope({ filters }))).toEqual([
      { accountGroupKey: "intakter", month: "2026-08", group: {}, value: 300 },
    ]);
    expect(
      await src.ledger(["intakter"], scope({ filters: [{ dimension: "kund", valueIds: [1] }] })),
    ).toEqual([]);
  });

  it("groups by company", async () => {
    const src = makeSource({
      ledger: [...rows, ledgerRow("s2", "MBR", "2026-08", 3010, -50)],
    });
    expect(await src.ledger(["intakter"], scope({ groupBy: ["bolag"] }))).toEqual([
      { accountGroupKey: "intakter", month: "2026-08", group: { bolag: "MBAB" }, value: 1000 },
      { accountGroupKey: "intakter", month: "2026-08", group: { bolag: "MBR" }, value: 50 },
    ]);
  });

  it("prefers a file's own year over previous-year rows of a later file", async () => {
    const src = makeSource({
      ledger: [
        ledgerRow("sie2025", "MBAB", "2025-08", 3010, -500),
        ledgerRow("sie2026", "MBAB", "2025-08", 3010, -480, { yearOffset: -1 }),
        ledgerRow("sie2026", "MBAB", "2026-08", 3010, -700),
      ],
      current: ["sie2025", "sie2026"],
      uploadTimes: { sie2025: "2026-01-10T00:00:00Z", sie2026: "2026-09-10T00:00:00Z" },
    });
    expect(await src.ledger(["intakter"], scope({ from: "2025-01" }))).toEqual([
      { accountGroupKey: "intakter", month: "2025-08", group: {}, value: 500 },
      { accountGroupKey: "intakter", month: "2026-08", group: {}, value: 700 },
    ]);
  });

  it("reads ledger budget from budget_belopp by kontogrupp code, without sign", async () => {
    const src = makeSource({
      facts: [
        fact("b1", "budget_belopp", "MBAB", "2026-08", 900, {
          kontogrupp: ID.kgIntakter,
          kostnadsstalle: ID.ks100,
        }),
        fact("b1", "budget_belopp", "MBAB", "2026-08", 300, {
          kontogrupp: ID.kgIntakter,
          kostnadsstalle: ID.ks200,
        }),
        fact("b1", "budget_belopp", "MBAB", "2026-08", 450, { kontogrupp: ID.kgPersonal }),
      ],
      scenarios: { b1: "budget" },
    });
    expect(await src.ledger(["intakter", "personal"], scope({ scenario: "budget" }))).toEqual([
      { accountGroupKey: "intakter", month: "2026-08", group: {}, value: 1200 },
      { accountGroupKey: "personal", month: "2026-08", group: {}, value: 450 },
    ]);
    expect(
      await src.ledger(
        ["intakter"],
        scope({
          scenario: "budget",
          groupBy: ["kostnadsstalle"],
          filters: [{ dimension: "kostnadsstalle", valueIds: [ID.ks200] }],
        }),
      ),
    ).toEqual([
      {
        accountGroupKey: "intakter",
        month: "2026-08",
        group: { kostnadsstalle: ID.ks200 },
        value: 300,
      },
    ]);
  });
});

describe("MemoryMetricDataSource metadata", () => {
  it("returns labels (none for bolag), fiscal start and definitions", async () => {
    const src = makeSource({ fiscalStartMonth: 5 });
    expect(await src.labels("kund", [ID.ikea, 999])).toEqual({ [ID.ikea]: "IKEA" });
    expect(await src.labels("bolag", [1])).toEqual({});
    expect(await src.fiscalStartMonth()).toBe(5);
    expect((await src.definitions()).length).toBe(catalogDefinitions().length);
    expect((await src.accountGroups()).map((g) => g.key)).toContain("resultat");
    const bare = new MemoryMetricDataSource({ definitions: [], current: [] });
    expect(await bare.fiscalStartMonth()).toBe(1);
    expect(await bare.accountGroups()).toEqual([]);
  });

  it("reports the newest upload behind each metric, formulas through their operands", async () => {
    const src = makeSource({
      facts: [
        fact("t1", "timmar", "MBAB", "2026-08", 1),
        fact("f1", "fakturerat_ip", "MBAB", "2026-08", 1),
        fact("f2", "lonekostnad", "MBR", "2026-08", 1),
      ],
      uploadTimes: {
        t1: "2026-09-02T08:00:00Z",
        f1: "2026-09-03T08:00:00Z",
        f2: "2026-09-04T08:00:00Z",
      },
    });
    expect(await src.lastUpdated(["timmar", "faktor", "sjuktimmar"], scope())).toEqual({
      timmar: "2026-09-02T08:00:00Z",
      faktor: "2026-09-04T08:00:00Z",
      sjuktimmar: null,
    });
    expect(await src.lastUpdated(["faktor"], scope({ companies: ["MBAB"] }))).toEqual({
      faktor: "2026-09-03T08:00:00Z",
    });
  });
});
