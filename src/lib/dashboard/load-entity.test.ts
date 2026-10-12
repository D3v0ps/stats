import { describe, expect, it } from "vitest";
import type { UrlFilters } from "@/lib/app/filters";
import { ENTITY_METRIC_ORDER, loadEntity, orderEntityMetrics } from "./load-entity";
import { cellOf } from "./pivot";
import { ANCHOR, DEFINITIONS, DIMENSIONS, FILTERS, T, buildSource } from "./test-data";

const load = (
  dimension: string,
  valueId: number,
  extra: { breakdown?: string | null; filters?: UrlFilters } = {},
) =>
  loadEntity(
    { dimension, valueId, breakdown: extra.breakdown ?? null, sort: null },
    {
      source: buildSource(),
      definitions: DEFINITIONS,
      dimensions: DIMENSIONS,
      filters: extra.filters ?? FILTERS,
      anchor: ANCHOR,
    },
  );

describe("entity page (kundkort)", () => {
  it("shows every metric that supports kund, in kundkort order", async () => {
    const view = await load("kund", T.budbee);
    expect(view.found).toBe(true);
    expect(view.label).toBe("Budbee Södertälje");
    expect(view.dimensionLabel).toBe("Kund");
    expect(view.kpis.slice(0, 10).map((k) => k.key)).toEqual(ENTITY_METRIC_ORDER.slice(0, 10));
    const byKey = Object.fromEntries(view.kpis.map((k) => [k.key, k]));
    expect(byKey.konsulter?.value).toBe(2);
    expect(byKey.sjukpass?.value).toBe(1);
    expect(byKey.sjukpass_per_konsult?.value).toBe(0.5);
    expect(byKey.fakturerat_kund?.value).toBe(160_000);
    expect(byKey.timmar?.sparkline).toHaveLength(12);
    expect(byKey.timmar?.href).toBe(`/utforska?matt=timmar&grupp=uppdrag&f=kund.${T.budbee}`);
    // AF and ledger metrics have no kund dimension and are not shown.
    expect(byKey.aktiva_deltagare).toBeUndefined();
    expect(byKey.resultat).toBeUndefined();
  });

  it("has a 12-month hours trend against last year", async () => {
    const view = await load("kund", T.budbee);
    expect(view.trend?.title).toBe("Fakturerade timmar per månad");
    expect(view.trend?.chart.series.map((s) => s.role)).toEqual(["primary", "previous"]);
    expect(view.trend?.chart.categories.at(-1)).toBe("sep 2026");
  });

  it("breaks down by uppdrag next, with konsult available (workspace only)", async () => {
    const view = await load("kund", T.budbee);
    expect(view.breakdown?.dimension).toBe("uppdrag");
    expect(view.breakdown?.options.map((o) => o.key)).toEqual([
      "bolag",
      "verksamhet",
      "uppdrag",
      "konsult",
      "franvarotyp",
    ]);
    expect(view.breakdown?.sortedRows.map((r) => r.label)).toEqual(["Lager natt"]);
    expect(view.breakdown?.rowLinks[String(T.budbeeSodertalje)]?.entity).toBe(
      `/utforska/uppdrag/${T.budbeeSodertalje}`,
    );

    const konsult = await load("kund", T.budbee, { breakdown: "konsult" });
    expect(konsult.breakdown?.sortedRows.map((r) => r.label)).toEqual(["Anna A", "Bo B"]);
    expect(konsult.breakdown?.options.find((o) => o.key === "konsult")).toMatchObject({
      active: true,
      personal: true,
    });
    expect(konsult.breakdown?.csv).toContain("Anna A");
  });

  it("compares with the previous period and last year", async () => {
    const view = await load("kund", T.budbee);
    const timmar = view.comparison?.rows.find((r) => r.key === "timmar");
    expect(timmar).toBeDefined();
    expect(view.comparison?.columns.map((c) => c.label)).toEqual([
      "September 2026",
      "Augusti 2026",
      "Förändring",
      "September 2025",
      "Förändring",
    ]);
    expect(cellOf(timmar!, "year_delta").delta?.direction).toBe("up");
  });

  it("works for other dimensions and reports unknown values", async () => {
    const verksamhet = await load("verksamhet", T.krom);
    expect(verksamhet.label).toBe("KROM");
    expect(verksamhet.kpis.find((k) => k.key === "aktiva_deltagare")?.value).toBe(60);
    expect(verksamhet.trend?.title).toBe("Aktiva deltagare per månad");
    // KROM has no hours: Bemanning metrics are left out of its page.
    expect(verksamhet.kpis.map((k) => k.key)).not.toContain("timmar");

    const missing = await load("kund", 999_999);
    expect(missing.found).toBe(false);
    expect(missing.kpis).toEqual([]);
  });

  it("orders metrics with unknown keys last in catalog order", () => {
    const keys = orderEntityMetrics(
      DEFINITIONS.filter((d) => ["resultat", "pass", "lonekostnad", "konsulter"].includes(d.key)),
    ).map((d) => d.key);
    expect(keys).toEqual(["konsulter", "pass", "resultat", "lonekostnad"]);
  });
});
