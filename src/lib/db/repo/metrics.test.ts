import { describe, expect, it } from "vitest";
import type { SourceScope } from "@/lib/contracts/metric-query";
import { createFakeClient, type FakeOptions } from "./fake-client";
import { SupabaseMetricDataSource, regroupLedger } from "./metrics";
import { catalogTables } from "./test-fixtures";

const scope = (over: Partial<SourceScope> = {}): SourceScope => ({
  companies: ["MBAB", "MBR"],
  scenario: "utfall",
  from: "2026-07",
  to: "2026-09",
  groupBy: [],
  filters: [],
  ...over,
});

function source(options: FakeOptions = {}) {
  const fake = createFakeClient({ tables: catalogTables(), ...options });
  return { ...fake, ds: new SupabaseMetricDataSource(fake.client) };
}

const rpcCalls = (calls: ReturnType<typeof createFakeClient>["calls"], name: string) =>
  calls.filter((c) => c.kind === "rpc" && c.target === name);

describe("SupabaseMetricDataSource", () => {
  it("serves definitions and account groups from the catalog, cached", async () => {
    const { ds, calls } = source();
    const defs = await ds.definitions();
    await ds.definitions();
    expect(defs.find((d) => d.key === "konsulter")).toMatchObject({
      kind: "distinct",
      baseMetricKey: "timmar",
      distinctDimension: "konsult",
    });
    expect(calls.filter((c) => c.target === "metrics")).toHaveLength(1);
    expect((await ds.accountGroups()).map((g) => g.key)).toContain("resultat");
  });

  it("maps metric_monthly rows and passes first-of-month dates", async () => {
    const { ds, calls } = source({
      rpc: {
        metric_monthly: () => [
          {
            metric_key: "timmar",
            month: "2026-07-01",
            grp: { bolag: "MBAB", kund: 4 },
            value: "12.5",
          },
          {
            metric_key: "timmar",
            month: "2026-08-01",
            grp: { bolag: "MBR", kund: null },
            value: 3,
          },
        ],
      },
    });
    const filters = [{ dimension: "kund", valueIds: [4] }];
    const rows = await ds.monthly(["timmar"], scope({ groupBy: ["bolag", "kund"], filters }));
    expect(rows).toEqual([
      { metricKey: "timmar", month: "2026-07", group: { bolag: "MBAB", kund: 4 }, value: 12.5 },
      { metricKey: "timmar", month: "2026-08", group: { bolag: "MBR", kund: null }, value: 3 },
    ]);
    expect(rpcCalls(calls, "metric_monthly")[0]?.payload).toEqual({
      p_metric_keys: ["timmar"],
      p_company_codes: ["MBAB", "MBR"],
      p_scenario: "utfall",
      p_from: "2026-07-01",
      p_to: "2026-09-01",
      p_group_by: ["bolag", "kund"],
      p_filters: filters,
    });
  });

  it("pages RPC results past max_rows", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => ({
      metric_key: "timmar",
      month: "2026-07-01",
      grp: { konsult: i },
      value: 1,
    }));
    const { ds, calls } = source({ rpc: { metric_monthly: () => all } });
    expect(await ds.monthly(["timmar"], scope({ groupBy: ["konsult"] }))).toHaveLength(2300);
    expect(rpcCalls(calls, "metric_monthly").map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("skips the database for empty requests", async () => {
    const { ds, calls } = source();
    expect(await ds.monthly([], scope())).toEqual([]);
    expect(await ds.monthly(["timmar"], scope({ companies: [] }))).toEqual([]);
    expect(await ds.ledger([], scope())).toEqual([]);
    expect(calls.filter((c) => c.kind === "rpc")).toEqual([]);
  });

  it("maps distinct counts (window and per month)", async () => {
    const { ds, calls } = source({
      rpc: {
        metric_distinct: (args) =>
          args.p_per_month
            ? [
                { month: "2026-07-01", grp: {}, cnt: 2 },
                { month: "2026-08-01", grp: {}, cnt: 3 },
              ]
            : [{ month: null, grp: {}, cnt: 4 }],
      },
    });
    expect(await ds.distinct("timmar", "konsult", scope(), false)).toEqual([
      { month: null, group: {}, count: 4 },
    ]);
    expect(await ds.distinct("timmar", "konsult", scope(), true)).toEqual([
      { month: "2026-07", group: {}, count: 2 },
      { month: "2026-08", group: {}, count: 3 },
    ]);
    expect(rpcCalls(calls, "metric_distinct")[0]?.payload).toMatchObject({
      p_base_metric_key: "timmar",
      p_dimension: "konsult",
      p_per_month: false,
    });
  });

  describe("ledger", () => {
    const ledgerRows = [
      {
        group_key: "intakter",
        month: "2026-01-01",
        grp: { bolag: "MBAB", kostnadsstalle: 10 },
        value: 700,
      },
      {
        group_key: "intakter",
        month: "2026-01-01",
        grp: { bolag: "MBAB", kostnadsstalle: 11 },
        value: 200,
      },
      {
        group_key: "intakter",
        month: "2026-01-01",
        grp: { bolag: "MBAB", kostnadsstalle: null },
        value: 600,
      },
      {
        group_key: "intakter",
        month: "2026-01-01",
        grp: { bolag: "MBR", kostnadsstalle: 12 },
        value: 50,
      },
    ];

    it("reads utfall from ledger_monthly", async () => {
      const { ds, calls } = source({ rpc: { ledger_monthly: () => ledgerRows } });
      const rows = await ds.ledger(["intakter"], scope({ groupBy: ["bolag", "kostnadsstalle"] }));
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({
        accountGroupKey: "intakter",
        month: "2026-01",
        group: { bolag: "MBAB", kostnadsstalle: 10 },
        value: 700,
      });
      expect(rpcCalls(calls, "ledger_monthly")[0]?.payload).toEqual({
        p_group_keys: ["intakter"],
        p_company_codes: ["MBAB", "MBR"],
        p_from: "2026-07-01",
        p_to: "2026-09-01",
        p_group_by: ["bolag", "kostnadsstalle"],
      });
    });

    it("applies a kostnadsställe filter by grouping and re-summing", async () => {
      const { ds, calls } = source({ rpc: { ledger_monthly: () => ledgerRows } });
      const rows = await ds.ledger(
        ["intakter"],
        scope({
          groupBy: ["bolag"],
          filters: [{ dimension: "kostnadsstalle", valueIds: [10, 11, 12] }],
        }),
      );
      expect(rows).toEqual([
        { accountGroupKey: "intakter", month: "2026-01", group: { bolag: "MBAB" }, value: 900 },
        { accountGroupKey: "intakter", month: "2026-01", group: { bolag: "MBR" }, value: 50 },
      ]);
      expect(rpcCalls(calls, "ledger_monthly")[0]?.payload).toMatchObject({
        p_group_by: ["bolag", "kostnadsstalle"],
      });
    });

    it("returns nothing for filters ledger data cannot honour", async () => {
      const { ds, calls } = source({ rpc: { ledger_monthly: () => ledgerRows } });
      expect(
        await ds.ledger(["intakter"], scope({ filters: [{ dimension: "kund", valueIds: [1] }] })),
      ).toEqual([]);
      expect(rpcCalls(calls, "ledger_monthly")).toEqual([]);
    });

    it("reads budget from budget_belopp by kontogrupp, in SIE sign times the group sign", async () => {
      const tables = catalogTables();
      const kontogruppDim = tables.dimensions!.find((d) => d.key === "kontogrupp")!.id;
      const idOf = (code: string) =>
        tables.dimension_values!.find((v) => v.dimension_id === kontogruppDim && v.code === code)!
          .id as number;
      const budgetRow = (bolag: string, kontogrupp: string, value: number) => ({
        metric_key: "budget_belopp",
        month: "2026-07-01",
        grp: { bolag, kontogrupp: idOf(kontogrupp) },
        value,
      });
      const { ds, calls } = source({
        tables,
        rpc: {
          metric_monthly: () => [
            budgetRow("MBAB", "intakter", -1000),
            budgetRow("MBR", "intakter", -500),
            budgetRow("MBAB", "personal", 400),
            budgetRow("MBAB", "ovriga_externa", 100),
            budgetRow("MBAB", "finansiella", 20),
            // A non-leaf line is not added on top of its parts.
            budgetRow("MBAB", "kostnader", 999),
          ],
        },
      });
      const rows = await ds.ledger(["intakter", "personal"], scope({ scenario: "budget" }));
      expect(rows).toEqual([
        { accountGroupKey: "intakter", month: "2026-07", group: {}, value: 1500 },
        { accountGroupKey: "personal", month: "2026-07", group: {}, value: 400 },
      ]);
      const payload = rpcCalls(calls, "metric_monthly")[0]?.payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        p_metric_keys: ["budget_belopp"],
        p_scenario: "budget",
        p_group_by: ["kontogrupp"],
        p_filters: [{ dimension: "kontogrupp", valueIds: [idOf("intakter"), idOf("personal")] }],
      });
      expect(rpcCalls(calls, "ledger_monthly")).toEqual([]);

      const derived = await ds.ledger(
        ["kostnader", "resultat"],
        scope({ scenario: "budget", groupBy: ["bolag"] }),
      );
      expect(derived).toEqual([
        { accountGroupKey: "kostnader", month: "2026-07", group: { bolag: "MBAB" }, value: 500 },
        { accountGroupKey: "resultat", month: "2026-07", group: { bolag: "MBAB" }, value: 480 },
        { accountGroupKey: "resultat", month: "2026-07", group: { bolag: "MBR" }, value: 500 },
      ]);
      const derivedPayload = rpcCalls(calls, "metric_monthly")[1]?.payload as {
        p_filters: { valueIds: number[] }[];
      };
      expect(derivedPayload.p_filters[0]?.valueIds).not.toContain(idOf("kostnader"));
    });
  });

  describe("coverage", () => {
    it("asks metric_coverage for data metrics and leaves formulas empty", async () => {
      const { ds, calls } = source({
        rpc: {
          metric_coverage: () => [
            { metric_key: "timmar", month: "2026-07-01" },
            { metric_key: "timmar", month: "2026-08-01" },
            { metric_key: "intakter", month: "2026-07-01" },
          ],
        },
      });
      expect(await ds.coverage(["timmar", "intakter", "faktor", "pass"], scope())).toEqual({
        timmar: ["2026-07", "2026-08"],
        intakter: ["2026-07"],
        faktor: [],
        pass: [],
      });
      expect(rpcCalls(calls, "metric_coverage")[0]?.payload).toMatchObject({
        p_metric_keys: ["intakter", "pass", "timmar"],
      });
    });

    it("uses budget_belopp coverage for ledger metrics in the budget scenario", async () => {
      const { ds, calls } = source({
        rpc: { metric_coverage: () => [{ metric_key: "budget_belopp", month: "2026-09-01" }] },
      });
      expect(await ds.coverage(["intakter", "resultat"], scope({ scenario: "budget" }))).toEqual({
        intakter: ["2026-09"],
        resultat: ["2026-09"],
      });
      expect(rpcCalls(calls, "metric_coverage")[0]?.payload).toMatchObject({
        p_metric_keys: ["budget_belopp"],
        p_scenario: "budget",
      });
    });
  });

  it("looks up labels within the dimension", async () => {
    const { ds } = source();
    expect(await ds.labels("verksamhet", [1, 2, 7])).toEqual({ 1: "ROM2", 2: "KROM" });
    expect(await ds.labels("finns_inte", [1])).toEqual({});
    expect(await ds.labels("bolag", [1])).toEqual({});
  });

  it("derives last-updated per metric from metric_sources, formulas via their operands", async () => {
    const { ds, calls } = source({
      rpc: {
        metric_sources: () => [
          {
            upload_id: "a",
            file_name: "a",
            dataset_key: "ip_fakturering",
            template_name: null,
            template_version: null,
            published_at: "2026-10-02T08:00:00Z",
            months: [],
          },
          {
            upload_id: "b",
            file_name: "b",
            dataset_key: "ip_fakturering",
            template_name: null,
            template_version: null,
            published_at: "2026-10-05T08:00:00Z",
            months: [],
          },
          {
            upload_id: "c",
            file_name: "c",
            dataset_key: "ip_timmar",
            template_name: null,
            template_version: null,
            published_at: "2026-10-07T08:00:00Z",
            months: [],
          },
        ],
      },
    });
    expect(
      await ds.lastUpdated(
        ["fakturerat_ip", "faktor", "intakt_per_konsult", "aktiva_deltagare"],
        scope(),
      ),
    ).toEqual({
      fakturerat_ip: "2026-10-05T08:00:00Z",
      faktor: "2026-10-05T08:00:00Z",
      intakt_per_konsult: "2026-10-07T08:00:00Z",
      aktiva_deltagare: null,
    });
    const payload = rpcCalls(calls, "metric_sources")[0]?.payload as { p_metric_keys: string[] };
    expect(new Set(payload.p_metric_keys)).toEqual(
      new Set(["fakturerat_ip", "lonekostnad", "konsulter", "aktiva_deltagare"]),
    );
  });

  it("reads the fiscal start month once", async () => {
    const { ds, calls } = source();
    expect(await ds.fiscalStartMonth()).toBe(1);
    await ds.fiscalStartMonth();
    expect(calls.filter((c) => c.target === "companies")).toHaveLength(1);
  });

  describe("memoization within one instance", () => {
    const sourceRow = (dataset: string, at: string) => ({
      upload_id: at,
      file_name: "f",
      dataset_key: dataset,
      template_name: null,
      template_version: null,
      published_at: at,
      months: [],
    });

    it("asks metric_coverage once per question, whatever the order of keys or companies", async () => {
      const { ds, calls } = source({
        rpc: { metric_coverage: () => [{ metric_key: "timmar", month: "2026-07-01" }] },
      });
      const first = await ds.coverage(["timmar", "pass"], scope());
      first.timmar!.push("2099-01");
      const again = await Promise.all([
        ds.coverage(["pass", "timmar"], scope({ companies: ["MBR", "MBAB"] })),
        // Grouping and filters do not change coverage.
        ds.coverage(["timmar", "pass"], scope({ groupBy: ["kund"] })),
        ds.coverage(["timmar", "pass", "timmar"], scope()),
      ]);
      expect(rpcCalls(calls, "metric_coverage")).toHaveLength(1);
      for (const r of again) expect(r).toEqual({ timmar: ["2026-07"], pass: [] });

      await ds.coverage(["timmar", "pass"], scope({ to: "2026-08" }));
      await ds.coverage(["timmar", "pass"], scope({ companies: ["MBAB"] }));
      await ds.coverage(["timmar", "pass"], scope({ scenario: "budget" }));
      await ds.coverage(["timmar"], scope());
      expect(rpcCalls(calls, "metric_coverage")).toHaveLength(5);
    });

    it("asks metric_sources once per question for last-updated", async () => {
      const { ds, calls } = source({
        rpc: { metric_sources: () => [sourceRow("ip_timmar", "2026-10-07T08:00:00Z")] },
      });
      const results = await Promise.all([
        ds.lastUpdated(["timmar", "pass"], scope()),
        ds.lastUpdated(
          ["pass", "timmar"],
          scope({ filters: [{ dimension: "kund", valueIds: [1] }] }),
        ),
      ]);
      expect(results[0]).toEqual({ timmar: "2026-10-07T08:00:00Z", pass: "2026-10-07T08:00:00Z" });
      expect(results[1]).toEqual(results[0]);
      expect(rpcCalls(calls, "metric_sources")).toHaveLength(1);
      // The budget scenario reads ledger metrics through budget_belopp: another question.
      await ds.lastUpdated(["timmar", "pass"], scope({ scenario: "budget" }));
      expect(rpcCalls(calls, "metric_sources")).toHaveLength(2);
    });

    it("looks up the same labels once", async () => {
      const { ds, calls } = source();
      const labelCalls = () => calls.filter((c) => c.target === "dimension_values");
      const first = await ds.labels("verksamhet", [2, 1, 2]);
      first[1] = "ändrad";
      expect(await ds.labels("verksamhet", [1, 2])).toEqual({ 1: "ROM2", 2: "KROM" });
      expect(labelCalls()).toHaveLength(1);
      await ds.labels("verksamhet", [1]);
      await ds.labels("kund", [1, 2]);
      expect(labelCalls()).toHaveLength(3);
    });

    it("serves definitions to every caller from one read", async () => {
      const { ds, calls } = source({
        rpc: { metric_coverage: () => [], metric_sources: () => [] },
      });
      await Promise.all([
        ds.definitions(),
        ds.coverage(["timmar", "faktor"], scope()),
        ds.lastUpdated(["faktor"], scope()),
      ]);
      expect(calls.filter((c) => c.target === "metrics")).toHaveLength(1);
    });

    it("forgets a failed call so the next one asks again", async () => {
      let fail = true;
      const { ds, calls } = source({
        rpc: { metric_coverage: () => [{ metric_key: "timmar", month: "2026-07-01" }] },
        fail: (c) => (fail && c.target === "metric_coverage" ? { message: "nere" } : null),
      });
      await expect(ds.coverage(["timmar"], scope())).rejects.toThrow(/nere/);
      fail = false;
      expect(await ds.coverage(["timmar"], scope())).toEqual({ timmar: ["2026-07"] });
      expect(rpcCalls(calls, "metric_coverage")).toHaveLength(2);
    });

    it("does not share results between instances (one per request)", async () => {
      const fake = createFakeClient({
        tables: catalogTables(),
        rpc: { metric_coverage: () => [] },
      });
      await new SupabaseMetricDataSource(fake.client).coverage(["timmar"], scope());
      await new SupabaseMetricDataSource(fake.client).coverage(["timmar"], scope());
      expect(rpcCalls(fake.calls, "metric_coverage")).toHaveLength(2);
    });
  });

  it("does not cache failures", async () => {
    let fail = true;
    const { ds } = source({
      fail: (c) => (fail && c.target === "metrics" ? { message: "nere" } : null),
    });
    await expect(ds.definitions()).rejects.toThrow(/nere/);
    fail = false;
    expect((await ds.definitions()).length).toBeGreaterThan(0);
  });
});

describe("regroupLedger", () => {
  it("sums rows that collapse onto the same key", () => {
    expect(
      regroupLedger(
        [
          {
            accountGroupKey: "a",
            month: "2026-01",
            group: { bolag: "MBAB", kostnadsstalle: 1 },
            value: 1,
          },
          {
            accountGroupKey: "a",
            month: "2026-01",
            group: { bolag: "MBAB", kostnadsstalle: 2 },
            value: 2,
          },
          {
            accountGroupKey: "a",
            month: "2026-02",
            group: { bolag: "MBAB", kostnadsstalle: 2 },
            value: 4,
          },
          {
            accountGroupKey: "b",
            month: "2026-01",
            group: { bolag: "MBAB", kostnadsstalle: 1 },
            value: 8,
          },
        ],
        ["bolag"],
      ),
    ).toEqual([
      { accountGroupKey: "a", month: "2026-01", group: { bolag: "MBAB" }, value: 3 },
      { accountGroupKey: "a", month: "2026-02", group: { bolag: "MBAB" }, value: 4 },
      { accountGroupKey: "b", month: "2026-01", group: { bolag: "MBAB" }, value: 8 },
    ]);
  });
});
