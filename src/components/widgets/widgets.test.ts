import { describe, expect, it } from "vitest";
import { WidgetSpecSchema } from "@/lib/contracts/dashboard";
import type { ResolvedSlide } from "@/lib/contracts/slides";
import { MINUS, NBSP } from "@/lib/core/format-sv";
import type { LoadedWidget } from "@/lib/dashboard/load-dashboard";
import { layoutBlocks } from "@/lib/dashboard/layout";
import { DEFAULT_DASHBOARD } from "@/lib/dashboard/default-dashboard";
import { blockClass, itemClass } from "./grid-classes";
import { directionOf, toplistRows } from "./toplist-rows";
import { kpiFootnote, kpiSparkline, widgetSubtitle, widgetTitle } from "./widget-text";

const slide = (over: Partial<ResolvedSlide> = {}): ResolvedSlide => ({
  id: "w",
  viz: "kpi",
  headline: "X.",
  suggestedHeadline: "X.",
  metricName: "Intäkter",
  periodLabel: "september 2026",
  companyLabel: "Summa bolag",
  number: { value: 2_400_000, formatted: "2,4 mkr", unit: "kr" },
  delta: {
    direction: "up",
    formatted: `+12${NBSP}%`,
    favorable: true,
    againstLabel: "mot aug 2026",
  },
  chart: null,
  table: null,
  footnote: "Summa bolag (ej eliminerat)",
  notes: "",
  sourceUploadIds: [],
  ...over,
});

const widget = (over: Partial<LoadedWidget> = {}): LoadedWidget => ({
  spec: WidgetSpecSchema.parse({
    id: "intakter",
    viz: "kpi",
    metricKey: "intakter",
    layout: { x: 0, y: 0, w: 6, h: 1 },
  }),
  status: "ok",
  slide: slide(),
  error: null,
  metric: {
    key: "intakter",
    name: "Intäkter",
    unit: "kr",
    decimals: 0,
    kind: "ledger",
    higherIsBetter: true,
  },
  href: "/utforska?matt=intakter",
  categoryLinks: [],
  budgetDelta: null,
  budgetValue: null,
  budgetNote: null,
  sourceQuery: { metricKeys: ["intakter"], company: "ALL", from: "2025-10", to: "2026-09" },
  ...over,
});

describe("widget texts", () => {
  it("titles and subtitles", () => {
    expect(widgetTitle(widget())).toBe("Intäkter");
    expect(widgetTitle(widget({ spec: { ...widget().spec, title: "Egen titel" } }))).toBe(
      "Egen titel",
    );
    expect(widgetSubtitle(widget())).toBe("September 2026 · Summa bolag");
    expect(widgetSubtitle(widget({ spec: { ...widget().spec, viz: "line" } }))).toBe(
      "Senaste 12 månaderna · Summa bolag",
    );
    expect(widgetSubtitle(widget({ slide: null }))).toBeNull();
  });

  it("adds the budget amount to the footnote when the card compares with budget", () => {
    expect(kpiFootnote(widget())).toBe("Summa bolag (ej eliminerat)");
    const withBudget = widget({
      budgetValue: 2_600_000,
      budgetNote: "MB Restart saknar budget",
      budgetDelta: {
        direction: "down",
        formatted: `${MINUS}8${NBSP}%`,
        favorable: false,
        againstLabel: "mot budget",
      },
    });
    expect(kpiFootnote(withBudget)).toBe(
      `Budget 2,6${NBSP}mkr · MB Restart saknar budget · Summa bolag (ej eliminerat)`,
    );
    expect(
      kpiFootnote(
        widget({
          slide: slide({ footnote: null, number: { value: null, formatted: "–", unit: "kr" } }),
        }),
      ),
    ).toBe("Ingen publicerad data");
  });

  it("uses the 12-month series as sparkline only when it has values", () => {
    const series = (values: (number | null)[]) =>
      slide({
        chart: {
          categories: [],
          series: [{ key: "k", label: "k", role: "primary", values }],
          unit: "kr",
          highlightIndex: null,
        },
      });
    expect(kpiSparkline(series([1, null, 3]))).toEqual([1, null, 3]);
    expect(kpiSparkline(series([null, null]))).toBeNull();
    expect(kpiSparkline(slide())).toBeNull();
  });
});

describe("toplist rows", () => {
  const toplist = slide({
    viz: "toplist",
    chart: {
      categories: ["Budbee", "IKEA", "Övriga"],
      series: [{ key: "timmar", label: "September 2026", role: "primary", values: [200, 50, 10] }],
      unit: "h",
      highlightIndex: null,
    },
    table: {
      columns: ["Kund", "September 2026", "Augusti 2026", "Förändring"],
      rows: [
        { label: "Budbee", values: ["200 h", "180 h", `+11${NBSP}%`] },
        { label: "IKEA", values: ["50 h", "60 h", `${MINUS}17${NBSP}%`] },
        { label: "Övriga", values: ["10 h", "10 h", `±0${NBSP}%`] },
      ],
    },
  });

  it("ranks, scales bars and links named rows", () => {
    const rows = toplistRows(
      toplist,
      [
        { label: "Budbee", href: "/utforska/kund/1" },
        { label: "IKEA", href: "/utforska/kund/2" },
        { label: "Övriga", href: null },
      ],
      true,
    );
    expect(rows.map((r) => [r.rank, r.label, r.href, r.share])).toEqual([
      [1, "Budbee", "/utforska/kund/1", 1],
      [2, "IKEA", "/utforska/kund/2", 0.25],
      [null, "Övriga", null, 0.05],
    ]);
    expect(rows[0]?.delta).toEqual({
      direction: "up",
      formatted: `+11${NBSP}%`,
      favorable: true,
      againstLabel: "mot augusti 2026",
    });
    expect(rows[1]?.delta?.favorable).toBe(false);
    expect(rows[2]?.delta?.favorable).toBeNull();
  });

  it("reads delta directions from formatted text", () => {
    expect(directionOf("+3 %")).toBe("up");
    expect(directionOf(`${MINUS}3 %`)).toBe("down");
    expect(directionOf("±0 %")).toBe("flat");
    expect(directionOf("–")).toBeNull();
  });
});

describe("grid classes", () => {
  it("lays out KPI rows and bento rows responsively", () => {
    const blocks = layoutBlocks(DEFAULT_DASHBOARD.widgets);
    const [money, volume, quality, charts] = blocks;
    expect(blockClass(money!)).toContain("@2xl:grid-cols-2");
    expect(itemClass(money!, 0)).toBe("min-w-0 @4xl:col-span-6 @7xl:col-span-6");
    expect(itemClass(volume!, 0)).toBe("min-w-0 @2xl:col-span-2 @4xl:col-span-4 @7xl:col-span-4");
    expect(itemClass(quality!, 1)).toBe("min-w-0 @4xl:col-span-6 @7xl:col-span-3");
    expect(blockClass(charts!)).not.toContain("@2xl:grid-cols-2");
    expect(itemClass(charts!, 0)).toBe("min-w-0 @4xl:col-span-8");
    expect(itemClass(charts!, 1)).toBe("min-w-0 @4xl:col-span-4");
  });
});
