// The budget fixture (fixtures/truth/budget_2026.json, SIE sign) as ledger budgets through the
// metric engine over the in-memory reference source: leaf groups times their sign, kostnader
// and resultat derived from the leaves, so the numbers read like the budget file itself.
import { describe, expect, it } from "vitest";
import { CATALOG_ACCOUNT_GROUPS } from "@/lib/contracts/catalog";
import type { CompanyFilter, MetricResult } from "@/lib/contracts";
import { MetricQuerySchema } from "@/lib/contracts/metric-query";
import { catalogAccountGroups, catalogDefinitions } from "@/lib/metrics/catalog";
import { runMetricQuery } from "@/lib/metrics/engine";
import { MemoryMetricDataSource } from "@/lib/metrics/memory-source";
import { manifestEntry, readTruth } from "./manifest";

const truth = readTruth(manifestEntry("budget_2026.xlsx"));
const groupId = new Map(CATALOG_ACCOUNT_GROUPS.map((g, i) => [g.key, 900 + i]));

const source = new MemoryMetricDataSource({
  definitions: catalogDefinitions(),
  accountGroups: catalogAccountGroups(),
  facts: truth.map((f) => ({
    uploadId: "budget",
    metricKey: f.metricKey,
    company: f.company,
    month: f.month,
    dims: { kontogrupp: groupId.get(f.dims.kontogrupp ?? "")! },
    value: f.value,
  })),
  current: ["budget"],
  scenarios: { budget: "budget" },
  codes: { kontogrupp: Object.fromEntries([...groupId].map(([key, id]) => [id, key])) },
});

const LEDGER = ["intakter", "varor_ul", "ovriga_externa", "personal", "avskrivningar"];
const COSTS = ["varor_ul", "ovriga_externa", "personal", "avskrivningar"];

async function budget(
  company: CompanyFilter,
  grain: "month" | "ytd",
): Promise<Record<string, MetricResult>> {
  const result = await runMetricQuery(
    MetricQuerySchema.parse({
      metricKeys: [...LEDGER, "kostnader", "finansiella", "resultat"],
      period: { grain, anchor: "2026-09" },
      company,
      scenario: "budget",
      groupBy: "bolag",
    }),
    source,
  );
  return Object.fromEntries(result.results.map((r) => [r.metricKey, r]));
}

/** Σ truth (SIE sign) for the companies and months, per kontogrupp key. */
function sie(companies: string[], months: (m: string) => boolean, groups: string[]): number {
  return truth
    .filter(
      (f) =>
        companies.includes(f.company) &&
        months(f.month) &&
        groups.includes(f.dims.kontogrupp ?? ""),
    )
    .reduce((a, f) => a + f.value, 0);
}

describe("budget_2026 truth as ledger budgets", () => {
  it.each([
    ["MBAB", "month"],
    ["ALL", "month"],
    ["MBAB", "ytd"],
    ["ALL", "ytd"],
  ] as const)("%s, %s", async (company, grain) => {
    const r = await budget(company, grain);
    const companies = company === "ALL" ? ["MBAB", "MBR"] : [company];
    const inWindow =
      grain === "month" ? (m: string) => m === "2026-09" : (m: string) => m <= "2026-09";
    const total = (key: string) => r[key]?.total.value;

    // Revenue and the financial net show positive like actuals (sign −1); costs keep theirs.
    expect(total("intakter")).toBeCloseTo(-sie(companies, inWindow, ["intakter"]), 6);
    expect(total("intakter")).toBeGreaterThan(0);
    for (const key of COSTS) {
      expect(total(key), key).toBeCloseTo(sie(companies, inWindow, [key]), 6);
      expect(total(key), key).toBeGreaterThan(0);
    }
    expect(total("finansiella")).toBeCloseTo(-sie(companies, inWindow, ["finansiella"]), 6);
    // Derived from the leaf groups: the file has no rows for them.
    expect(total("kostnader")).toBeCloseTo(sie(companies, inWindow, COSTS), 6);
    expect(total("resultat")).toBeCloseTo(
      -sie(companies, inWindow, ["intakter", "finansiella", ...COSTS]),
      6,
    );
    // resultat = intäkter − kostnader + finansnetto, like "Resultat efter finansiella poster".
    expect(total("resultat")).toBeCloseTo(
      total("intakter")! - total("kostnader")! + total("finansiella")!,
      6,
    );
    // Per company the groups add up to the total.
    const groups = r.resultat?.groups ?? [];
    expect(groups.map((g) => g.id).sort()).toEqual(companies);
    expect(groups.reduce((a, g) => a + (g.value ?? 0), 0)).toBeCloseTo(total("resultat")!, 6);
  });

  it("leaves a month without budget rows unknown, not 0", async () => {
    const result = await runMetricQuery(
      MetricQuerySchema.parse({
        metricKeys: ["resultat"],
        period: { grain: "month", anchor: "2025-12" },
        company: "ALL",
        scenario: "budget",
      }),
      source,
    );
    expect(result.results[0]?.total.value).toBeNull();
    expect(result.results[0]?.status).toBe("no_data");
  });
});
