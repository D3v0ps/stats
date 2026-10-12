import { describe, expect, it } from "vitest";
import { CATALOG_METRICS } from "@/lib/contracts/catalog";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts/domain";
import { DashboardSpecSchema } from "@/lib/contracts/dashboard";
import { resolveWidget } from "@/lib/metrics";
import {
  BUDGET_ONLY_WIDGET_IDS,
  DEFAULT_DASHBOARD,
  chooseDashboard,
  orderedWidgets,
} from "./default-dashboard";
import {
  BUDGET_SERIES_LABEL,
  loadDashboardMeta,
  loadWidget,
  widgetExploreHref,
} from "./load-dashboard";
import { definitionMap } from "./metrics-meta";
import { ANCHOR, DEFINITIONS, DIMENSIONS, FILTERS, T, buildSource } from "./test-data";

const ctx = (source = buildSource()) => ({
  source,
  definitions: DEFINITIONS,
  dimensions: DIMENSIONS,
  filters: FILTERS,
  anchor: ANCHOR,
});

describe("default dashboard spec", () => {
  it("is a valid DashboardSpec over catalog metrics without personal dimensions", () => {
    expect(DashboardSpecSchema.parse(DEFAULT_DASHBOARD)).toEqual(DEFAULT_DASHBOARD);
    const catalog = new Set(CATALOG_METRICS.map((m) => m.key));
    for (const w of DEFAULT_DASHBOARD.widgets) {
      expect(catalog.has(w.metricKey), w.metricKey).toBe(true);
      expect(w.groupBy).not.toBe("konsult");
      expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
    }
    expect(new Set(DEFAULT_DASHBOARD.widgets.map((w) => w.id)).size).toBe(
      DEFAULT_DASHBOARD.widgets.length,
    );
  });

  it("has the requested KPI rows and charts", () => {
    const kpis = orderedWidgets(DEFAULT_DASHBOARD)
      .filter((w) => w.viz === "kpi")
      .map((w) => w.metricKey);
    expect(kpis).toEqual([
      "resultat",
      "intakter",
      "aktiva_deltagare",
      "timmar",
      "konsulter",
      "resultatandel",
      "faktor",
      "sjukfranvaro",
      "nya_deltagare",
    ]);
    const toplist = DEFAULT_DASHBOARD.widgets.find((w) => w.viz === "toplist");
    expect(toplist).toMatchObject({ metricKey: "timmar", groupBy: "kund", topN: 8 });
  });

  it("prefers a valid saved dashboard and falls back otherwise", () => {
    const saved = {
      ...DEFAULT_DASHBOARD,
      name: "Styrelsen",
      widgets: DEFAULT_DASHBOARD.widgets.slice(0, 2),
    };
    expect(chooseDashboard({ spec: saved }).name).toBe("Styrelsen");
    expect(chooseDashboard(null)).toBe(DEFAULT_DASHBOARD);
    expect(chooseDashboard({ spec: { name: "Tom", widgets: [] } })).toBe(DEFAULT_DASHBOARD);
    expect(chooseDashboard({ spec: { nonsense: true } })).toBe(DEFAULT_DASHBOARD);
  });

  it("every widget resolves with resolveWidget over the catalog", async () => {
    const source = buildSource({ budget: true });
    for (const grain of ["month", "quarter", "year", "ytd", "r12"] as const) {
      for (const company of ["ALL", "MBAB", "MBR"] as const) {
        for (const w of DEFAULT_DASHBOARD.widgets) {
          const slide = await resolveWidget(
            w,
            { company, grain, anchor: ANCHOR },
            {
              anchor: ANCHOR,
              source,
              definitionsByKey: definitionMap(DEFINITIONS),
              personalDimensions: new Set(["konsult"]),
              companyLabels: COMPANY_FILTER_LABELS,
            },
          );
          expect(slide.id).toBe(w.id);
          expect(slide.headline.endsWith(".")).toBe(true);
        }
      }
    }
  });
});

describe("loading dashboard widgets", () => {
  it("loads every widget without errors and links each card into Utforska", async () => {
    const c = ctx(buildSource({ budget: true }));
    const loaded = await Promise.all(DEFAULT_DASHBOARD.widgets.map((w) => loadWidget(w, c)));
    for (const l of loaded) {
      expect(l.status, `${l.spec.id}: ${l.error}`).toBe("ok");
      expect(l.href.startsWith("/utforska?")).toBe(true);
    }
    const timmar = loaded.find((l) => l.spec.id === "timmar");
    expect(timmar?.slide?.number?.value).toBe(
      Math.round(120 * 1.4) + Math.round(80 * 1.4) + Math.round(60 * 1.4),
    );
    expect(timmar?.href).toBe("/utforska?matt=timmar&grupp=bolag");
  });

  it("compares ledger KPIs with the budget when there is one", async () => {
    const withBudget = await loadWidget(
      DEFAULT_DASHBOARD.widgets.find((w) => w.id === "intakter")!,
      ctx(buildSource({ budget: true })),
    );
    expect(withBudget.budgetValue).toBe(230_000);
    expect(withBudget.budgetDelta?.againstLabel).toBe("mot budget");
    // Only MB AB has a budget: Summa bolag against it says so.
    expect(withBudget.budgetNote).toBe("MB Restart saknar budget");
    const mbab = await loadWidget(
      DEFAULT_DASHBOARD.widgets.find((w) => w.id === "intakter")!,
      {
        ...ctx(buildSource({ budget: true })),
        filters: { ...FILTERS, company: "MBAB" },
      },
    );
    expect(mbab.budgetNote).toBeNull();
    const without = await loadWidget(
      DEFAULT_DASHBOARD.widgets.find((w) => w.id === "intakter")!,
      ctx(),
    );
    expect(without.budgetDelta).toBeNull();
  });

  it("does not show the budget twice when the KPI itself compares with budget", async () => {
    const spec = DEFAULT_DASHBOARD.widgets.find((w) => w.id === "intakter")!;
    const own = await loadWidget(
      { ...spec, compare: "budget" },
      ctx(buildSource({ budget: true })),
    );
    expect(own.slide?.delta?.againstLabel).toBe("mot budget");
    expect(own.budgetDelta).toBeNull();
  });

  it("shows the budget chart only when a budget exists", async () => {
    const spec = DEFAULT_DASHBOARD.widgets.find((w) => BUDGET_ONLY_WIDGET_IDS.has(w.id))!;
    expect((await loadWidget(spec, ctx())).status).toBe("hidden");
    const shown = await loadWidget(spec, ctx(buildSource({ budget: true })));
    expect(shown.status).toBe("ok");
    const series = shown.slide?.chart?.series ?? [];
    expect(series.map((s) => s.label)).toEqual(["Intäkter", BUDGET_SERIES_LABEL]);
    expect(series[1]?.values.at(-1)).toBe(230_000);
    // Budget exists from January 2026 only: earlier months are gaps, not zeros.
    expect(series[1]?.values[0]).toBeNull();
  });

  it("links toplist rows to the kundkort and breakdown bars to entity pages", async () => {
    const toplist = await loadWidget(
      DEFAULT_DASHBOARD.widgets.find((w) => w.viz === "toplist")!,
      ctx(),
    );
    expect(toplist.categoryLinks).toEqual([
      { label: "Budbee Södertälje", href: `/utforska/kund/${T.budbee}` },
      { label: "IKEA", href: `/utforska/kund/${T.ikea}` },
    ]);
    const bars = await loadWidget(
      DEFAULT_DASHBOARD.widgets.find((w) => w.id === "deltagare-per-verksamhet")!,
      ctx(),
    );
    expect(bars.categoryLinks.map((l) => l.href)).toEqual([
      `/utforska/verksamhet/${T.krom}`,
      `/utforska/verksamhet/${T.rom2}`,
    ]);
  });

  it("takes drill-down ids and the last update from the resolved slide, with no extra query", async () => {
    const source = buildSource();
    let calls = 0;
    const counted = new Proxy(source, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (prop === "monthly" || prop === "ledger" || prop === "distinct") calls++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const spec = DEFAULT_DASHBOARD.widgets.find((w) => w.viz === "toplist")!;
    const toplist = await loadWidget(spec, ctx(counted));
    const callsForWidget = calls;
    calls = 0;
    await resolveWidget(
      spec,
      { company: FILTERS.company, grain: FILTERS.grain, anchor: ANCHOR },
      {
        anchor: ANCHOR,
        source: counted,
        definitionsByKey: definitionMap(DEFINITIONS),
        personalDimensions: new Set(["konsult"]),
        companyLabels: COMPANY_FILTER_LABELS,
      },
    );
    // Loading the widget asks the data source exactly what resolving it does.
    expect(callsForWidget).toBe(calls);
    expect(callsForWidget).toBeGreaterThan(0);
    expect(toplist.categoryLinks.map((l) => l.href)).toEqual(
      toplist.slide!.chart!.categoryIds!.map((id) => (id === null ? null : `/utforska/kund/${id}`)),
    );
    expect(toplist.slide?.lastUpdatedAt).toEqual(expect.any(String));
  });

  it("drill-down targets match the widget kind", () => {
    const byId = (id: string) => DEFAULT_DASHBOARD.widgets.find((w) => w.id === id)!;
    const defs = definitionMap(DEFINITIONS);
    expect(widgetExploreHref(byId("resultat-per-manad"), defs.get("resultat"), FILTERS)).toBe(
      "/utforska?matt=resultat&grupp=manad",
    );
    expect(widgetExploreHref(byId("resultat-per-bolag"), defs.get("resultat"), FILTERS)).toBe(
      "/utforska?matt=resultat&grupp=bolag",
    );
    expect(
      widgetExploreHref(byId("timmar-per-kund"), defs.get("timmar"), {
        ...FILTERS,
        company: "MBAB",
      }),
    ).toBe("/utforska?bolag=MBAB&matt=timmar&grupp=kund");
    expect(
      widgetExploreHref(byId("timmar"), defs.get("timmar"), { ...FILTERS, company: "MBAB" }),
    ).toBe("/utforska?bolag=MBAB&matt=timmar&grupp=verksamhet");
  });

  it("never throws when the data source fails: the card shows an error", async () => {
    const source = buildSource();
    source.fiscalStartMonth = () => Promise.reject(new Error("Databasen svarar inte"));
    const loaded = await loadWidget(DEFAULT_DASHBOARD.widgets[0]!, ctx(source));
    expect(loaded).toMatchObject({ status: "error", error: "Kunde inte beräkna widgeten." });
    expect(loaded.sourceQuery).toMatchObject({ from: ANCHOR, to: ANCHOR });
  });

  it("refuses personal breakdowns on the dashboard and reports unknown metrics", async () => {
    const personal = await loadWidget(
      { ...DEFAULT_DASHBOARD.widgets[0]!, viz: "bar", groupBy: "konsult" },
      ctx(),
    );
    expect(personal.status).toBe("error");
    expect(personal.error).toMatch(/konsult/i);
    const unknown = await loadWidget(
      { ...DEFAULT_DASHBOARD.widgets[0]!, metricKey: "finns_inte" },
      ctx(),
    );
    expect(unknown).toMatchObject({ status: "error", error: "Okänt mått: finns_inte." });
  });
});

describe("dashboard meta", () => {
  const now = new Date("2026-10-12T10:00:00Z");

  it("reports data and the newest upload", async () => {
    const meta = await loadDashboardMeta({
      widgets: DEFAULT_DASHBOARD.widgets,
      source: buildSource(),
      definitions: DEFINITIONS,
      filters: FILTERS,
      anchor: ANCHOR,
      now,
    });
    expect(meta.hasData).toBe(true);
    expect(meta.newest).toBe("2026-10-08T08:00:00Z");
    expect(meta.lastUpdated.timmar).toBe("2026-10-05T08:00:00Z");
  });

  it("is empty when nothing is published", async () => {
    const meta = await loadDashboardMeta({
      widgets: DEFAULT_DASHBOARD.widgets,
      source: buildSource({ empty: true }),
      definitions: DEFINITIONS,
      filters: FILTERS,
      anchor: "2026-09",
      now,
    });
    expect(meta).toEqual({ hasData: false, lastUpdated: expect.any(Object), newest: null });
  });
});
