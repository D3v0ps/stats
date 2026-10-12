import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { WidgetSpecSchema } from "@/lib/contracts/dashboard";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts/domain";
import { SlideSpecSchema, type SlideSpec } from "@/lib/contracts/slides";
import { MINUS, NBSP } from "@/lib/core/format-sv";
import { monthRange } from "@/lib/core/month";
import { PersonalDataError } from "./errors";
import type { MemoryFact, MemoryMetricDataSource } from "./memory-source";
import { resolveReport, resolveSlide, resolveWidget, type ResolveContext } from "./resolve";
import { DEFS, ID, fact, makeSource, monthlyFacts } from "./test-fixtures";

/** Spaces inside formatted numbers are NBSP. */
const s = (text: string) => text.replaceAll(" ", NBSP);

const slide = (input: Partial<z.input<typeof SlideSpecSchema>>): SlideSpec =>
  SlideSpecSchema.parse({
    id: "s1",
    viz: "kpi",
    metricKey: "timmar",
    grain: "month",
    company: "ALL",
    ...input,
  });

const widget = (input: Partial<z.input<typeof WidgetSpecSchema>>) =>
  WidgetSpecSchema.parse({
    id: "w1",
    viz: "kpi",
    metricKey: "aktiva_deltagare",
    layout: { x: 0, y: 0, w: 3, h: 2 },
    ...input,
  });

const MONTHS = monthRange("2024-10", "2026-09");
const LAST12 = [
  "okt 2025",
  "nov 2025",
  "dec 2025",
  "jan 2026",
  "feb 2026",
  "mar 2026",
  "apr 2026",
  "maj 2026",
  "jun 2026",
  "jul 2026",
  "aug 2026",
  "sep 2026",
];

const deltagare: MemoryFact[] = MONTHS.flatMap((m, i) => [
  fact("w1", "aktiva_deltagare", "MBAB", m, 10 + i, { verksamhet: ID.krom }),
  fact("w1", "aktiva_deltagare", "MBAB", m, 5, { verksamhet: ID.rom2 }),
  fact("w2", "aktiva_deltagare", "MBR", m, 4, { verksamhet: ID.kvl }),
]);
const fakturering: MemoryFact[] = [
  fact("k1", "fakturerat_kund", "MBAB", "2025-09", 1_500_000, { kund: ID.ikea }),
  fact("k1", "fakturerat_kund", "MBAB", "2026-08", 2_000_000, { kund: ID.ikea }),
  fact("k1", "fakturerat_kund", "MBAB", "2026-09", 2_000_000, { kund: ID.ikea }),
  fact("k2", "fakturerat_kund", "MBR", "2026-09", 400_000, { kund: ID.volvo }),
];
const timmar: MemoryFact[] = [
  fact("t1", "timmar", "MBAB", "2026-09", 100, { kund: ID.ikea, konsult: ID.anna }),
  fact("t1", "timmar", "MBAB", "2026-09", 60, { kund: ID.volvo, konsult: ID.bo }),
  fact("t1", "timmar", "MBAB", "2026-09", 30, { kund: ID.scania, konsult: ID.cecilia }),
  fact("t1", "timmar", "MBAB", "2026-08", 80, { kund: ID.ikea, konsult: ID.anna }),
  fact("t1", "timmar", "MBAB", "2026-08", 60, { kund: ID.volvo, konsult: ID.bo }),
  fact("t1", "timmar", "MBAB", "2026-08", 40, { kund: ID.scania, konsult: ID.cecilia }),
  fact("b1", "timmar", "MBAB", "2026-09", 120, { kund: ID.ikea }),
];

const SOURCE = makeSource({
  facts: [...deltagare, ...fakturering, ...timmar],
  scenarios: { b1: "budget" },
});

const ctx = (source: MemoryMetricDataSource = SOURCE): ResolveContext => ({
  anchor: "2026-09",
  source,
  definitionsByKey: new Map(DEFS.map((d) => [d.key, d])),
  personalDimensions: new Set(["konsult"]),
  companyLabels: COMPANY_FILTER_LABELS,
});

describe("resolveSlide: kpi", () => {
  it("formats the number compactly, the delta and a 12-month sparkline", async () => {
    const r = await resolveSlide(slide({ viz: "kpi", metricKey: "fakturerat_kund" }), ctx());
    expect(r).toEqual({
      id: "s1",
      viz: "kpi",
      headline: "FAKTURERINGEN ÖKAR.",
      suggestedHeadline: "FAKTURERINGEN ÖKAR.",
      metricName: "Fakturerat per kund",
      periodLabel: "september 2026",
      companyLabel: "Summa bolag",
      number: { value: 2_400_000, formatted: s("2,4 mkr"), unit: "kr" },
      delta: {
        direction: "up",
        formatted: s("+20 %"),
        favorable: true,
        againstLabel: "mot augusti 2026",
      },
      chart: {
        categories: LAST12,
        series: [
          {
            key: "fakturerat_kund",
            label: "Fakturerat per kund",
            role: "primary",
            values: [
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              2_000_000,
              2_400_000,
            ],
          },
        ],
        unit: "kr",
        highlightIndex: 11,
      },
      table: null,
      footnote: "Summa bolag (ej eliminerat)",
      notes: "",
      sourceUploadIds: [],
    });
  });

  it("uses percentage points and marks rising sick leave as unfavorable", async () => {
    const src = makeSource({
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
    const r = await resolveSlide(slide({ metricKey: "sjukfranvaro" }), ctx(src));
    expect(r.number?.formatted).toBe(s("6,5 %"));
    expect(r.delta).toEqual({
      direction: "up",
      formatted: s("+1,5 p.e."),
      favorable: false,
      againstLabel: "mot augusti 2026",
    });
    expect(r.headline).toBe("SJUKFRÅNVARON ÖKAR.");
    expect(r.footnote).toBeNull();
  });

  it("compares YTD with last year when the slide asks for the previous period", async () => {
    const r = await resolveSlide(slide({ metricKey: "fakturerat_kund", grain: "ytd" }), ctx());
    expect(r.periodLabel).toBe("jan–sep 2026");
    expect(r.number?.formatted).toBe(s("4,4 mkr"));
    expect(r.delta).toMatchObject({ formatted: s("+193 %"), againstLabel: "mot jan–sep 2025" });
    expect(r.footnote).toBe(
      "2 av 9 mån har data · MB Restart: 1 av 9 mån har data · Summa bolag (ej eliminerat)",
    );
  });

  it("shows no delta when the slide has no comparison", async () => {
    const r = await resolveSlide(slide({ metricKey: "aktiva_deltagare", compare: null }), ctx());
    expect(r.delta).toBeNull();
    expect(r.number?.formatted).toBe("42");
    expect(r.headline).toBe("DELTAGARNA: 42.");
  });

  it("phrases filters and the company in the suggested headline", async () => {
    const krom = await resolveSlide(
      slide({
        metricKey: "aktiva_deltagare",
        filters: [{ dimension: "verksamhet", valueIds: [ID.krom] }],
      }),
      ctx(),
    );
    expect(krom.headline).toBe("DELTAGARNA I KROM ÖKAR.");
    expect(krom.number?.formatted).toBe("33");
    const mbr = await resolveSlide(slide({ metricKey: "aktiva_deltagare", company: "MBR" }), ctx());
    expect(mbr.headline).toBe("DELTAGARNA I MB RESTART LIGGER STILLA.");
    expect(mbr.companyLabel).toBe("MB Restart");
    expect(mbr.delta).toMatchObject({ direction: "flat", formatted: s("±0 %"), favorable: null });
  });

  it("uses a headline override in uppercase with a dot and keeps the suggestion", async () => {
    const r = await resolveSlide(
      slide({
        metricKey: "fakturerat_kund",
        headline: "rekordmånad för faktureringen",
        notes: "Nämn IKEA.",
      }),
      ctx(),
    );
    expect(r.headline).toBe("REKORDMÅNAD FÖR FAKTURERINGEN.");
    expect(r.suggestedHeadline).toBe("FAKTURERINGEN ÖKAR.");
    expect(r.notes).toBe("Nämn IKEA.");
  });

  it("reports coverage gaps and the company sum in the footnote", async () => {
    const r = await resolveSlide(slide({ metricKey: "fakturerat_kund", grain: "quarter" }), ctx());
    expect(r.periodLabel).toBe("kv 3 2026");
    expect(r.footnote).toBe(
      "2 av 3 mån har data · MB Restart: 1 av 3 mån har data · Summa bolag (ej eliminerat)",
    );
    const single = await resolveSlide(
      slide({ metricKey: "fakturerat_kund", grain: "quarter", company: "MBAB" }),
      ctx(),
    );
    expect(single.footnote).toBe("2 av 3 mån har data");
  });

  it("flags a company missing from Summa bolag even when the month counts as covered", async () => {
    const src = makeSource({
      facts: [
        fact("k1", "fakturerat_kund", "MBAB", "2026-08", 2_000_000, { kund: ID.ikea }),
        fact("k1", "fakturerat_kund", "MBAB", "2026-09", 2_100_000, { kund: ID.ikea }),
        fact("k2", "fakturerat_kund", "MBR", "2026-08", 400_000, { kund: ID.volvo }),
      ],
    });
    const r = await resolveSlide(slide({ metricKey: "fakturerat_kund" }), ctx(src));
    expect(r.footnote).toBe("MB Restart saknar data · Summa bolag (ej eliminerat)");
    const single = await resolveSlide(
      slide({ metricKey: "fakturerat_kund", company: "MBAB" }),
      ctx(src),
    );
    expect(single.footnote).toBeNull();
  });

  it("does not flag a company that never reports the metric", async () => {
    const r = await resolveSlide(slide({ metricKey: "timmar" }), ctx());
    expect(r.footnote).toBeNull();
  });

  it("checks every metric behind a formula", async () => {
    const src = makeSource({
      facts: [
        fact("a1", "avslutade_deltagare", "MBAB", "2026-09", 10),
        fact("a1", "resultat_deltagare", "MBAB", "2026-09", 4),
        fact("a2", "avslutade_deltagare", "MBR", "2026-08", 5),
        fact("a2", "resultat_deltagare", "MBR", "2026-08", 2),
      ],
    });
    const r = await resolveSlide(slide({ metricKey: "resultatandel" }), ctx(src));
    expect(r.number?.formatted).toBe(s("40,0 %"));
    expect(r.footnote).toBe("MB Restart saknar data");
  });

  it("explains a filter the metric does not have instead of showing a total", async () => {
    const r = await resolveSlide(
      slide({ metricKey: "resultat", filters: [{ dimension: "kund", valueIds: [ID.ikea] }] }),
      ctx(),
    );
    expect(r.number).toEqual({ value: null, formatted: "–", unit: "kr" });
    expect(r.delta).toBeNull();
    expect(r.chart).toBeNull();
    expect(r.footnote).toBe("Kund finns inte för Resultat · Summa bolag (ej eliminerat)");
    expect(r.headline).toBe("RESULTATET HOS IKEA: –.");
  });

  it("says when the period has no data", async () => {
    const r = await resolveSlide(slide({ metricKey: "sjuktimmar" }), ctx());
    expect(r.footnote).toBe("Ingen data för perioden");
    expect(r.number?.formatted).toBe("–");
  });

  it("accepts definitions as a plain record", async () => {
    const c = { ...ctx(), definitionsByKey: Object.fromEntries(DEFS.map((d) => [d.key, d])) };
    const r = await resolveSlide(slide({ metricKey: "aktiva_deltagare" }), c);
    expect(r.metricName).toBe("Aktiva deltagare");
  });
});

describe("resolveSlide: line", () => {
  it("shows the last 12 months against the year before, highlighting the anchor", async () => {
    const r = await resolveSlide(
      slide({ viz: "line", metricKey: "aktiva_deltagare", company: "MBAB" }),
      ctx(),
    );
    expect(r.chart).toEqual({
      categories: LAST12,
      series: [
        {
          key: "aktiva_deltagare",
          label: "Aktiva deltagare",
          role: "primary",
          values: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
        },
        {
          key: "aktiva_deltagare_previous_year",
          label: "Föregående år",
          role: "previous",
          values: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
        },
      ],
      unit: "st",
      highlightIndex: 11,
    });
    expect(r.number?.formatted).toBe("38");
    expect(r.delta).toMatchObject({ direction: "up", formatted: s("+3 %"), favorable: true });
    expect(r.headline).toBe("DELTAGARNA I MB AB ÖKAR.");
  });
});

describe("resolveSlide: breakdowns", () => {
  it("bar: one category per group with the comparison as a previous series", async () => {
    const r = await resolveSlide(slide({ viz: "bar", groupBy: "kund" }), ctx());
    expect(r.chart).toEqual({
      categories: ["IKEA", "Volvo", "Scania"],
      series: [
        { key: "timmar", label: "September 2026", role: "primary", values: [100, 60, 30] },
        {
          key: "timmar_prev_period",
          label: "Augusti 2026",
          role: "previous",
          values: [80, 60, 40],
        },
      ],
      unit: "h",
      highlightIndex: null,
    });
    expect(r.number?.formatted).toBe(s("190 h"));
    expect(r.delta?.formatted).toBe(s("+6 %"));
    expect(r.table).toBeNull();
  });

  it("bar: budget comparison is a secondary series", async () => {
    const r = await resolveSlide(slide({ viz: "bar", groupBy: "kund", compare: "budget" }), ctx());
    expect(r.chart?.series[1]).toEqual({
      key: "timmar_budget",
      label: "Budget",
      role: "secondary",
      values: [120, 0, 0],
    });
    expect(r.delta).toMatchObject({ formatted: s("+58 %"), againstLabel: "mot budget" });
  });

  it("bar without a group shows monthly bars", async () => {
    const r = await resolveSlide(slide({ viz: "bar" }), ctx());
    expect(r.chart?.categories).toEqual(LAST12);
    expect(r.chart?.series).toHaveLength(1);
    expect(r.chart?.series[0]?.values.slice(-3)).toEqual([null, 180, 190]);
    expect(r.chart?.highlightIndex).toBe(11);
  });

  it("donut: one slice per group", async () => {
    const r = await resolveSlide(
      slide({ viz: "donut", metricKey: "aktiva_deltagare", groupBy: "verksamhet", compare: null }),
      ctx(),
    );
    expect(r.chart).toEqual({
      categories: ["KROM", "ROM2", "KVL"],
      series: [
        { key: "aktiva_deltagare", label: "September 2026", role: "primary", values: [33, 5, 4] },
      ],
      unit: "st",
      highlightIndex: null,
    });
  });

  it("toplist: top N plus Övriga, as chart and as rows with deltas", async () => {
    const r = await resolveSlide(slide({ viz: "toplist", groupBy: "kund", topN: 2 }), ctx());
    expect(r.chart?.categories).toEqual(["IKEA", "Volvo", "Övriga"]);
    expect(r.chart?.series[0]?.values).toEqual([100, 60, 30]);
    expect(r.table).toEqual({
      columns: ["Kund", "September 2026", "Augusti 2026", "Förändring"],
      rows: [
        { label: "IKEA", values: [s("100 h"), s("80 h"), s("+25 %")] },
        { label: "Volvo", values: [s("60 h"), s("60 h"), s("±0 %")] },
        { label: "Övriga", values: [s("30 h"), s("40 h"), s(`${MINUS}25 %`)] },
      ],
    });
  });

  it("toplist: shows the top 10 by default", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      fact("t9", "timmar", "MBAB", "2026-09", 100 - i, { kund: 1000 + i }),
    );
    const r = await resolveSlide(
      slide({ viz: "toplist", groupBy: "kund" }),
      ctx(makeSource({ facts: many })),
    );
    expect(r.chart?.categories).toHaveLength(11);
    expect(r.chart?.categories.at(-1)).toBe("Övriga");
  });

  it("table: formatted values, comparison, delta column and a total row", async () => {
    const r = await resolveSlide(slide({ viz: "table", groupBy: "kund" }), ctx());
    expect(r.chart).toBeNull();
    expect(r.table).toEqual({
      columns: ["Kund", "September 2026", "Augusti 2026", "Förändring"],
      rows: [
        { label: "IKEA", values: [s("100 h"), s("80 h"), s("+25 %")] },
        { label: "Volvo", values: [s("60 h"), s("60 h"), s("±0 %")] },
        { label: "Scania", values: [s("30 h"), s("40 h"), s(`${MINUS}25 %`)] },
        { label: "Totalt", values: [s("190 h"), s("180 h"), s("+6 %")] },
      ],
    });
  });

  it("table: compact amounts; a company that had not reported is unknown, not 0", async () => {
    const r = await resolveSlide(
      slide({ viz: "table", metricKey: "fakturerat_kund", groupBy: "bolag" }),
      ctx(),
    );
    expect(r.table).toEqual({
      columns: ["Bolag", "September 2026", "Augusti 2026", "Förändring"],
      rows: [
        { label: "MB AB", values: [s("2,0 mkr"), s("2,0 mkr"), s("±0 %")] },
        { label: "MB Restart", values: [s("400 tkr"), "–", "–"] },
        { label: "Totalt", values: [s("2,4 mkr"), s("2,0 mkr"), s("+20 %")] },
      ],
    });
  });

  it("table: absolute delta from a reported zero", async () => {
    const src = makeSource({
      facts: [
        ...fakturering,
        fact("k2", "fakturerat_kund", "MBR", "2026-08", 0, { kund: ID.volvo }),
      ],
    });
    const r = await resolveSlide(
      slide({ viz: "table", metricKey: "fakturerat_kund", groupBy: "bolag" }),
      ctx(src),
    );
    expect(r.table?.rows[1]).toEqual({
      label: "MB Restart",
      values: [s("400 tkr"), s("0 kr"), s("+400 tkr")],
    });
  });

  it("table without a group and without a comparison", async () => {
    const r = await resolveSlide(slide({ viz: "table", compare: null }), ctx());
    expect(r.table).toEqual({
      columns: ["Mått", "September 2026"],
      rows: [{ label: "Fakturerade timmar", values: [s("190 h")] }],
    });
  });
});

describe("resolveSlide: stacked_company", () => {
  it("stacks the companies per month over the last 12 months", async () => {
    const r = await resolveSlide(
      slide({ viz: "stacked_company", metricKey: "aktiva_deltagare" }),
      ctx(),
    );
    expect(r.chart).toEqual({
      categories: LAST12,
      series: [
        {
          key: "MBAB",
          label: "MB AB",
          role: "primary",
          values: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
        },
        { key: "MBR", label: "MB Restart", role: "secondary", values: Array(12).fill(4) },
      ],
      unit: "st",
      highlightIndex: null,
    });
    expect(r.number?.formatted).toBe("42");
  });

  it("shows only the selected company", async () => {
    const r = await resolveSlide(
      slide({ viz: "stacked_company", metricKey: "aktiva_deltagare", company: "MBR" }),
      ctx(),
    );
    expect(r.chart?.series.map((x) => x.key)).toEqual(["MBR"]);
  });
});

describe("personal dimensions", () => {
  it("refuses slides grouped or filtered by konsult", async () => {
    await expect(resolveSlide(slide({ viz: "table", groupBy: "konsult" }), ctx())).rejects.toThrow(
      PersonalDataError,
    );
    await expect(
      resolveSlide(slide({ filters: [{ dimension: "konsult", valueIds: [ID.anna] }] }), ctx()),
    ).rejects.toMatchObject({ name: "PersonalDataError", dimensions: ["konsult"] });
  });

  it("refuses the whole report", async () => {
    await expect(
      resolveReport(
        {
          name: "Styrelse",
          slides: [slide({ id: "a" }), slide({ id: "b", viz: "bar", groupBy: "konsult" })],
        },
        { ...ctx(), title: "Styrelserapport" },
      ),
    ).rejects.toThrow(
      /Rapporten får inte grupperas eller filtreras på personuppgifter \(konsult\)/,
    );
  });

  it("refuses widgets unless the workspace explicitly allows personal dimensions", async () => {
    const spec = widget({ viz: "table", metricKey: "timmar", groupBy: "konsult" });
    await expect(
      resolveWidget(spec, { company: "ALL", grain: "month", anchor: null }, ctx()),
    ).rejects.toThrow(PersonalDataError);
    const r = await resolveWidget(
      spec,
      { company: "ALL", grain: "month", anchor: null },
      { ...ctx(), allowPersonalDimensions: true },
    );
    expect(r.table?.rows.map((row) => row.label)).toEqual(["1001", "1002", "1003", "Totalt"]);
  });
});

describe("resolveReport", () => {
  it("resolves every slide in order with report metadata", async () => {
    const report = await resolveReport(
      {
        name: "Styrelse",
        slides: [
          slide({ id: "intro", metricKey: "fakturerat_kund" }),
          slide({ id: "kunder", viz: "table", groupBy: "kund" }),
        ],
      },
      { ...ctx(), title: "Styrelserapport september 2026", now: new Date("2026-10-12T08:00:00Z") },
    );
    expect(report).toMatchObject({
      schemaVersion: 1,
      title: "Styrelserapport september 2026",
      anchorMonth: "2026-09",
      periodLabel: "september 2026",
      generatedAt: "2026-10-12T08:00:00.000Z",
    });
    expect(report.slides.map((x) => [x.id, x.viz])).toEqual([
      ["intro", "kpi"],
      ["kunder", "table"],
    ]);
    expect(report.slides.every((x) => x.headline.endsWith("."))).toBe(true);
  });
});

describe("resolveWidget", () => {
  it("follows the global filters", async () => {
    const r = await resolveWidget(
      widget({}),
      { company: "MBR", grain: "month", anchor: "2026-08" },
      ctx(),
    );
    expect(r).toMatchObject({
      id: "w1",
      periodLabel: "augusti 2026",
      companyLabel: "MB Restart",
      number: { value: 4, formatted: "4" },
      delta: { direction: "flat", againstLabel: "mot juli 2026" },
      headline: "DELTAGARNA I MB RESTART LIGGER STILLA.",
      notes: "",
    });
  });

  it("lets the widget's company override the global one and uses the context anchor", async () => {
    const r = await resolveWidget(
      widget({ company: "MBAB" }),
      { company: "MBR", grain: "month", anchor: null },
      ctx(),
    );
    expect(r.companyLabel).toBe("MB AB");
    expect(r.periodLabel).toBe("september 2026");
    expect(r.number?.value).toBe(38);
  });

  it("uses the widget title as headline and last year for YTD", async () => {
    const r = await resolveWidget(
      widget({ title: "Aktiva deltagare", metricKey: "fakturerat_kund" }),
      { company: "ALL", grain: "ytd", anchor: null },
      ctx(),
    );
    expect(r.headline).toBe("AKTIVA DELTAGARE.");
    expect(r.delta?.againstLabel).toBe("mot jan–sep 2025");
  });
});
