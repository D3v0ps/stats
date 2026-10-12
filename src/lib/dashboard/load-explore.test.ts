import { describe, expect, it } from "vitest";
import type { UrlFilters } from "@/lib/app/filters";
import { CSV_BOM } from "./csv";
import { parseExploreState } from "./explore-state";
import { breakdownOptions, loadExplore, normalizeMetrics } from "./load-explore";
import { cellOf } from "./pivot";
import { BOOKED_REMAINDER_LABEL } from "./remainder";
import { ANCHOR, DEFINITIONS, DIMENSIONS, FILTERS, T, buildSource } from "./test-data";

const load = (query: string, filters: UrlFilters = FILTERS) =>
  loadExplore(parseExploreState(new URLSearchParams(query)), {
    source: buildSource(),
    definitions: DEFINITIONS,
    dimensions: DIMENSIONS,
    filters,
    anchor: ANCHOR,
  });

describe("Utforska view", () => {
  it("defaults to Resultat per bolag at the top level", async () => {
    const view = await load("");
    expect(view.metrics.map((m) => m.key)).toEqual(["resultat"]);
    expect(view.groupBy).toBe("bolag");
    expect(view.sortedRows.map((r) => r.label)).toEqual(["MB AB", "MB Restart"]);
    expect(view.crumbs).toEqual([{ label: "Summa bolag", href: null }]);
    // Clicking MB AB sets the company and moves on to kostnadsställe (the ledger's next level).
    expect(view.rowLinks['"MBAB"']?.drill).toBe(
      "/utforska?bolag=MBAB&matt=resultat&grupp=kostnadsstalle",
    );
    expect(view.nextBreakdownLabel).toBe("Kostnadsställe");
    expect(view.footnotes).toContain("Summa bolag (ej eliminerat)");
  });

  it("breaks timmar down per kund with deltas, coverage, a total row and drill links", async () => {
    const view = await load("matt=timmar&grupp=kund", { ...FILTERS, company: "MBAB" });
    const rows = view.sortedRows;
    expect(rows.map((r) => r.label)).toEqual(["Budbee Södertälje", "IKEA"]);
    const budbee = rows[0]!;
    expect(cellOf(budbee, "m0").raw).toBe(Math.round(120 * 1.4) + Math.round(80 * 1.4));
    expect(cellOf(budbee, "m0:prev_period").delta?.direction).toBe("up");
    expect(cellOf(budbee, "m0:coverage").text).toBe("1/1 mån");
    expect(view.pivot?.columns.map((c) => c.label)).toEqual([
      "September 2026",
      "Δ föreg. period",
      "Δ i fjol",
      "Täckning",
    ]);
    expect(view.pivot?.footer.map((r) => r.label)).toEqual(["Totalt"]);
    expect(view.rowLinks[String(T.budbee)]).toEqual({
      drill: `/utforska?bolag=MBAB&matt=timmar&grupp=uppdrag&f=kund.${T.budbee}`,
      entity: `/utforska/kund/${T.budbee}?bolag=MBAB`,
    });
    expect(view.chart?.categories).toEqual(["Budbee Södertälje", "IKEA"]);
    expect(view.chart?.series.map((s) => s.role)).toEqual(["primary", "previous"]);
    expect(view.csv?.startsWith(`${CSV_BOM}Kund;Fakturerade timmar september 2026;`)).toBe(true);
  });

  it("drills Budbee down to uppdrag with a clickable breadcrumb", async () => {
    const view = await load(`matt=timmar&f=kund.${T.budbee}`, { ...FILTERS, company: "MBAB" });
    expect(view.groupBy).toBe("uppdrag");
    expect(view.crumbs.map((c) => c.label)).toEqual(["Summa bolag", "MB AB", "Budbee Södertälje"]);
    expect(view.crumbs[1]?.href).toBe("/utforska?bolag=MBAB&matt=timmar&grupp=kund");
    expect(view.sortedRows.map((r) => r.label)).toEqual(["Lager natt"]);
    expect(view.nextBreakdownLabel).toBe("Konsult");
  });

  it("shows several metrics side by side for the same breakdown", async () => {
    const view = await load(
      "matt=konsulter,timmar,fakturerat_ip,faktor,sjukpass_per_konsult&grupp=kund",
    );
    expect(view.pivot?.columns.map((c) => c.label)).toEqual([
      "Konsulter i arbete",
      "Fakturerade timmar",
      "Fakturerat (Intelliplan)",
      "Faktor",
      "Sjukpass per konsult",
    ]);
    const budbee = view.sortedRows.find((r) => r.label === "Budbee Södertälje")!;
    expect(cellOf(budbee, "m0").raw).toBe(2);
    expect(cellOf(budbee, "m3").text).toBe("1,80");
    expect(cellOf(budbee, "m4").raw).toBe(0.5);
    expect(view.notes).toEqual([]);
  });

  it("explains a breakdown that does not apply", async () => {
    const view = await load("matt=resultat&grupp=kund");
    expect(view.notes).toEqual([
      { metricKey: "resultat", kind: "not_applicable", text: "Kund finns inte i bokföringen." },
    ]);
    expect(view.pivot).toBeNull();
    expect(view.breakdownOptions.find((o) => o.key === "kund")).toMatchObject({
      enabled: false,
      reason: "Kund finns inte för Resultat.",
    });
  });

  it("names the metric a note is about when several are side by side", async () => {
    const view = await load("matt=timmar,resultat,resultatandel&grupp=kund");
    expect(view.notes.map((n) => n.text)).toEqual([
      "Resultat: kund finns inte i bokföringen.",
      "Andel till arbete eller studier: kund finns inte i Workbuster – deltagare.",
    ]);
    expect(view.sortedRows.map((r) => r.label)).toEqual(["Budbee Södertälje", "IKEA"]);
  });

  it("adds 'Skillnad mot bokfört' so fakturerat per kund totals the books", async () => {
    const view = await load("matt=fakturerat_kund&grupp=kund", { ...FILTERS, company: "MBAB" });
    const footer = view.pivot?.footer ?? [];
    expect(footer.map((r) => r.label)).toEqual([BOOKED_REMAINDER_LABEL, "Totalt"]);
    const booked = 200_000 * 1.4;
    expect(cellOf(footer[0]!, "m0").raw).toBeCloseTo(booked - 190_000, 6);
    expect(cellOf(footer[1]!, "m0").raw).toBeCloseTo(booked, 6);
    // A change in the remainder is neither good nor bad.
    expect(cellOf(footer[0]!, "m0:prev_period").delta?.favorable).toBeNull();
    // Filtered to one customer the books are not comparable: no remainder row.
    const filtered = await load(`matt=fakturerat_kund&grupp=kund&f=kund.${T.budbee}`, {
      ...FILTERS,
      company: "MBAB",
    });
    expect(filtered.pivot?.footer.map((r) => r.label)).toEqual(["Totalt"]);
  });

  it("shows a month table with last year and links each month", async () => {
    const view = await load("matt=timmar&grupp=manad");
    expect(view.sortedRows[0]?.label).toBe("sep 2026");
    expect(view.sortedRows).toHaveLength(12);
    expect(view.pivot?.columns.map((c) => c.label)).toEqual([
      "Fakturerade timmar",
      "Föregående år",
      "Δ i fjol",
    ]);
    expect(view.rowLinks["2026-03"]?.drill).toBe("/utforska?manad=2026-03&matt=timmar&grupp=bolag");
    expect(view.chart?.series.map((s) => s.label)).toEqual(["Fakturerade timmar", "Föregående år"]);
    expect(view.chartTitle).toBe("Fakturerade timmar per månad");
    // Summary cards still compare with the previous period.
    expect(view.results[0]?.total.compare.prev_period).toBeDefined();
  });

  it("per month over a year shows the window's months up to the anchor", async () => {
    const ytd = await load("matt=timmar&grupp=manad", { ...FILTERS, grain: "ytd" });
    expect(ytd.sortedRows.map((r) => r.key)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
    const year = await load("matt=timmar&grupp=manad", { ...FILTERS, grain: "year" });
    expect(year.sortedRows).toHaveLength(9);
    expect(year.chart?.categories).toHaveLength(9);
    expect(year.chart?.series[1]?.values).toHaveLength(9);
    expect(year.sourceQuery).toMatchObject({ from: "2026-01", to: "2026-09" });
  });

  it("does not repeat the breakdown in titles", async () => {
    const view = await load("matt=fakturerat_kund&grupp=kund");
    expect(view.chartTitle).toBe("Fakturerat per kund");
  });

  it("sorts by any column and builds toggling sort links", async () => {
    const view = await load("matt=timmar&grupp=kund&sort=m0&dir=asc");
    expect(view.sortedRows.map((r) => r.label)).toEqual(["IKEA", "Budbee Södertälje"]);
    expect(view.sortLinks.m0).toBe("/utforska?matt=timmar&grupp=kund&sort=m0&dir=desc");
    expect(view.sortLinks.label).toBe("/utforska?matt=timmar&grupp=kund&sort=label&dir=asc");
    const ignored = await load("matt=timmar&grupp=kund&sort=nope");
    expect(ignored.state.sort).toBeNull();
  });

  it("budget columns appear for ledger metrics with a budget", async () => {
    const view = await loadExplore(
      parseExploreState(new URLSearchParams("matt=intakter&grupp=bolag")),
      {
        source: buildSource({ budget: true }),
        definitions: DEFINITIONS,
        dimensions: DIMENSIONS,
        filters: FILTERS,
        anchor: ANCHOR,
      },
    );
    expect(view.pivot?.columns.map((c) => c.label)).toContain("Budget");
    const mbab = view.sortedRows.find((r) => r.label === "MB AB")!;
    expect(cellOf(mbab, "m0:budget_value").raw).toBe(230_000);
  });

  it("normalizes metrics and lists breakdown options", () => {
    expect(
      normalizeMetrics(["finns_inte", "budget_belopp"], DEFINITIONS).map((d) => d.key),
    ).toEqual(["resultat"]);
    expect(normalizeMetrics(["timmar", "faktor"], DEFINITIONS).map((d) => d.key)).toEqual([
      "timmar",
      "faktor",
    ]);
    const timmar = normalizeMetrics(["timmar"], DEFINITIONS);
    const opts = breakdownOptions(timmar, DEFINITIONS, DIMENSIONS, (k) => `#${k}`);
    expect(opts.slice(0, 7).map((o) => o.key)).toEqual([
      "manad",
      "bolag",
      "verksamhet",
      "kostnadsstalle",
      "kund",
      "uppdrag",
      "konsult",
    ]);
    expect(opts.find((o) => o.key === "konsult")).toMatchObject({ enabled: true, personal: true });
    expect(opts.find((o) => o.key === "kostnadsstalle")?.enabled).toBe(false);
    expect(opts.map((o) => o.key)).not.toContain("kontogrupp");
  });
});
