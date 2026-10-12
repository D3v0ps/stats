import { describe, expect, it } from "vitest";
import type { UrlFilters } from "@/lib/app/filters";
import { parseUrlFilters } from "@/lib/app/filters";
import { parseExploreState } from "./explore-state";
import { loadExplore } from "./load-explore";
import {
  ENTITY_METRIC_ORDER,
  entityExists,
  loadEntity,
  orderEntityMetrics,
  parseEntityParams,
} from "./load-entity";
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

  it("shows zero sick leave on the kundkort of a customer without absence", async () => {
    // IKEA had no sick leave: 0 is an answer, the cards stay.
    const ikea = await load("kund", T.ikea);
    const byKey = Object.fromEntries(ikea.kpis.map((k) => [k.key, k]));
    expect(ikea.kpis.slice(0, 10).map((k) => k.key)).toEqual(ENTITY_METRIC_ORDER.slice(0, 10));
    expect(byKey.sjukpass?.value).toBe(0);
    expect(byKey.sjukpass_per_konsult?.value).toBe(0);
    expect(byKey.sjukfranvaro?.value).toBe(0);
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

  it("breaks down by a dimension the shown metrics have", async () => {
    // KROM only has AF figures: per ort (not per kund, which only Bemanning metrics have).
    const krom = await load("verksamhet", T.krom);
    expect(krom.breakdown?.dimension).toBe("ort");
    expect(krom.breakdown?.sortedRows.map((r) => r.label)).toEqual(["Stockholm"]);
    expect(krom.breakdown?.options.map((o) => o.key)).toEqual([
      "bolag",
      "ort",
      "resultattyp",
      "ordertyp",
    ]);
    // A consultant per kund (where they worked), not per frånvarotyp.
    const anna = await load("konsult", T.anna);
    expect(anna.breakdown?.dimension).toBe("kund");
    expect(anna.breakdown?.sortedRows.map((r) => r.label)).toEqual(["Budbee Södertälje"]);
    expect((await load("ort", T.stockholm)).breakdown?.dimension).toBe("verksamhet");
  });

  it("links every card and the back link to a breakdown the metric has", async () => {
    for (const [dimension, id] of [
      ["kund", T.budbee],
      ["verksamhet", T.krom],
      ["konsult", T.anna],
      ["ort", T.stockholm],
    ] as const) {
      const view = await load(dimension, id);
      for (const href of [view.exploreHref, ...view.kpis.map((k) => k.href)]) {
        const url = new URL(href, "http://localhost");
        const explore = await loadExplore(parseExploreState(url.searchParams), {
          source: buildSource(),
          definitions: DEFINITIONS,
          dimensions: DIMENSIONS,
          filters: parseUrlFilters(url.searchParams),
          anchor: ANCHOR,
        });
        expect(
          explore.notes.filter((n) => n.kind === "not_applicable"),
          href,
        ).toEqual([]);
        expect(explore.state.filters, href).toEqual([{ dimension, valueId: id }]);
      }
    }
    const krom = await load("verksamhet", T.krom);
    // The back link opens a metric KROM has numbers for.
    expect(krom.exploreHref).toBe(
      `/utforska?matt=aktiva_deltagare&grupp=ort&f=verksamhet.${T.krom}`,
    );
    const budbee = await load("kund", T.budbee);
    expect(budbee.kpis.find((k) => k.key === "fakturerat_kund")?.href).toBe(
      `/utforska?matt=fakturerat_kund&grupp=bolag&f=kund.${T.budbee}`,
    );
  });

  it("orders metrics with unknown keys last in catalog order", () => {
    const keys = orderEntityMetrics(
      DEFINITIONS.filter((d) => ["resultat", "pass", "lonekostnad", "konsulter"].includes(d.key)),
    ).map((d) => d.key);
    expect(keys).toEqual(["konsulter", "pass", "resultat", "lonekostnad"]);
  });
});

describe("entity route checks", () => {
  it("parses the route params or rejects them", () => {
    expect(parseEntityParams("kund", "12")).toEqual({ dimension: "kund", valueId: 12 });
    expect(parseEntityParams("kund", "0")).toBeNull();
    expect(parseEntityParams("kund", "-3")).toBeNull();
    expect(parseEntityParams("kund", "1.5")).toBeNull();
    expect(parseEntityParams("kund", "1234567890123456")).toBeNull();
    expect(parseEntityParams("Kund!", "12")).toBeNull();
  });

  it("knows an entity only for a catalog dimension and an existing value", async () => {
    const ctx = { source: buildSource(), dimensions: DIMENSIONS };
    expect(await entityExists({ dimension: "kund", valueId: T.ikea }, ctx)).toBe(true);
    expect(await entityExists({ dimension: "kund", valueId: 999_999 }, ctx)).toBe(false);
    expect(await entityExists({ dimension: "finns_inte", valueId: T.ikea }, ctx)).toBe(false);
  });
});
