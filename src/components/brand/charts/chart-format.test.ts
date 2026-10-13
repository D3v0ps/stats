import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartData } from "@/lib/contracts";
import { ANTRACIT, BLA, LJUSGRA, ROD } from "../tokens";
import { MbBarChart, MbDonut, MbLineChart, MbStackedCompanyBar } from "./index";
import { AXIS_TICK, axisTick, fittedCategoryTick } from "./chart-parts";
import {
  CATEGORY_AXIS_MAX_SHARE,
  CATEGORY_TICK_GAP,
  barFill,
  chartConfigFor,
  chartTableRows,
  donutSlices,
  donutTotal,
  estimateTextWidth,
  fitCategoryAxis,
  fitLabel,
  formatAxisTick,
  formatChartValue,
  seriesDataKey,
  seriesStyles,
  toChartRows,
} from "./chart-format";

const NBSP = " ";

const monthly: ChartData = {
  categories: ["jul", "aug", "sep"],
  series: [
    { key: "current", label: "2026", role: "primary", values: [1200, null, 1500] },
    { key: "previous", label: "2025", role: "previous", values: [1000, 1100, 1300] },
  ],
  unit: "h",
  highlightIndex: 2,
};

describe("formatAxisTick", () => {
  it("formats amounts compactly", () => {
    expect(formatAxisTick(2_400_000, "kr")).toBe(`2,4${NBSP}mkr`);
    expect(formatAxisTick(500_000, "kr")).toBe(`500${NBSP}tkr`);
    expect(formatAxisTick(0, "kr")).toBe(`0${NBSP}kr`);
  });

  it("keeps whole ticks whole and uses Swedish separators", () => {
    expect(formatAxisTick(12, "pct")).toBe(`12${NBSP}%`);
    expect(formatAxisTick(12.5, "pct")).toBe(`12,5${NBSP}%`);
    expect(formatAxisTick(1200, "h")).toBe(`1${NBSP}200${NBSP}h`);
    expect(formatAxisTick(1500, "st")).toBe(`1${NBSP}500`);
    expect(formatAxisTick(-3, "st")).toBe("−3");
    expect(formatAxisTick(1.5, "faktor")).toBe("1,5");
    expect(formatAxisTick(6, "man")).toBe(`6${NBSP}mån`);
  });

  it("never prints NaN", () => {
    expect(formatAxisTick(Number.NaN, "kr")).toBe("–");
  });
});

describe("formatChartValue", () => {
  it("formats numbers with unit and missing values as a dash", () => {
    expect(formatChartValue(1234567, "kr")).toBe(`1${NBSP}234${NBSP}567${NBSP}kr`);
    expect(formatChartValue(null, "kr")).toBe("–");
    expect(formatChartValue(undefined, "h")).toBe("–");
    expect(formatChartValue("12", "h")).toBe("–");
  });
});

describe("toChartRows", () => {
  it("pivots series into rows with CSS-safe keys and keeps gaps as null", () => {
    expect(toChartRows(monthly)).toEqual([
      { category: "jul", index: 0, s0: 1200, s1: 1000 },
      { category: "aug", index: 1, s0: null, s1: 1100 },
      { category: "sep", index: 2, s0: 1500, s1: 1300 },
    ]);
    expect(seriesDataKey(3)).toBe("s3");
  });

  it("treats short series and NaN as missing", () => {
    const rows = toChartRows({
      categories: ["a", "b"],
      series: [{ key: "x", label: "X", role: "primary", values: [Number.NaN] }],
      unit: "st",
      highlightIndex: null,
    });
    expect(rows.map((r) => r.s0)).toEqual([null, null]);
  });
});

describe("seriesStyles / chartConfigFor", () => {
  it("colours by role and dashes the previous period", () => {
    const styles = seriesStyles(monthly.series, "hex");
    expect(styles.map((s) => [s.dataKey, s.color, s.dashed])).toEqual([
      ["s0", ANTRACIT, false],
      ["s1", LJUSGRA, true],
    ]);
    expect(chartConfigFor(styles)).toEqual({
      s0: { label: "2026", color: ANTRACIT },
      s1: { label: "2025", color: LJUSGRA },
    });
  });
});

describe("barFill", () => {
  it("paints only the highlighted bar red", () => {
    expect(barFill(ANTRACIT, 2, 2, "hex")).toBe(ROD);
    expect(barFill(ANTRACIT, 1, 2, "hex")).toBe(ANTRACIT);
    expect(barFill(ANTRACIT, 0, null, "hex")).toBe(ANTRACIT);
    expect(barFill("var(--color-s0)", 0, 0)).toBe("var(--chart-highlight)");
  });
});

describe("donutSlices", () => {
  const shares: ChartData = {
    categories: ["ROM2", "KROM", "KVL", "Övrigt"],
    series: [{ key: "v", label: "Deltagare", role: "primary", values: [50, 30, null, 20] }],
    unit: "st",
    highlightIndex: 1,
  };

  it("computes shares, skips missing values and highlights in red", () => {
    const slices = donutSlices(shares, "hex");
    expect(slices.map((s) => s.label)).toEqual(["ROM2", "KROM", "Övrigt"]);
    expect(slices.map((s) => s.share)).toEqual([0.5, 0.3, 0.2]);
    expect(slices[1]!.color).toBe(ROD);
    expect(slices[0]!.color).toBe(ANTRACIT);
    expect(slices[2]!.color).toBe(BLA);
  });

  it("drops non-positive values and copes with an empty chart", () => {
    expect(
      donutSlices({ ...shares, series: [{ ...shares.series[0]!, values: [0, -5, 0, 0] }] }),
    ).toEqual([]);
    expect(donutSlices({ ...shares, series: [] })).toEqual([]);
  });
});

describe("donutTotal", () => {
  const donut = (values: (number | null)[]): ChartData => ({
    categories: values.map((_, i) => `k${i}`),
    series: [{ key: "v", label: "Deltagare", role: "primary", values }],
    unit: "st",
    highlightIndex: null,
  });

  it("adds the drawn (positive) slices", () => {
    expect(donutTotal(donut([50, 30, null, 20]))).toBe(100);
    expect(donutTotal(donut([3, -1, 2]))).toBe(5);
  });

  it("is zero only when real zeros were reported", () => {
    expect(donutTotal(donut([0, null, 0]))).toBe(0);
  });

  it("is null (missing, never 0) when no category has data", () => {
    expect(donutTotal(donut([null, null]))).toBeNull();
    expect(donutTotal(donut([]))).toBeNull();
    expect(donutTotal({ ...donut([1]), series: [] })).toBeNull();
  });
});

describe("chartTableRows", () => {
  it("formats every value for the hidden data table", () => {
    expect(chartTableRows(monthly)).toEqual([
      { label: "jul", values: [`1${NBSP}200${NBSP}h`, `1${NBSP}000${NBSP}h`] },
      { label: "aug", values: ["–", `1${NBSP}100${NBSP}h`] },
      { label: "sep", values: [`1${NBSP}500${NBSP}h`, `1${NBSP}300${NBSP}h`] },
    ]);
  });
});

describe("chart components (server render)", () => {
  const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

  it("label the figure and ship an accessible data table", () => {
    for (const html of [
      render(createElement(MbLineChart, { data: monthly, title: "Timmar per månad" })),
      render(
        createElement(MbBarChart, { data: monthly, title: "Timmar per månad", animate: false }),
      ),
      render(
        createElement(MbBarChart, {
          data: monthly,
          title: "Timmar per månad",
          orientation: "horizontal",
          showValues: true,
        }),
      ),
      render(
        createElement(MbStackedCompanyBar, {
          data: monthly,
          title: "Timmar per månad",
          showTotals: true,
        }),
      ),
    ]) {
      expect(html).toContain('aria-label="Timmar per månad"');
      expect(html).toContain("<caption>Timmar per månad</caption>");
      expect(html).toContain(`<td>1${NBSP}500${NBSP}h</td>`);
      expect(html).not.toMatch(/green|emerald/);
    }
  });

  it("renders the donut total and legend", () => {
    const html = render(
      createElement(MbDonut, {
        data: {
          categories: ["MB AB", "MB Restart"],
          series: [
            { key: "v", label: "Intäkter", role: "primary", values: [3_000_000, 1_000_000] },
          ],
          unit: "kr",
          highlightIndex: null,
        },
        title: "Intäkter per bolag",
        centerLabel: "Totalt",
      }),
    );
    expect(html).toContain(`4,0${NBSP}mkr`);
    expect(html).toContain("Totalt");
    expect(html).toContain(`75${NBSP}%`);
  });

  it("shows a dash, not 0, in the donut hole when nothing is published", () => {
    const html = render(
      createElement(MbDonut, {
        data: {
          categories: ["MB AB", "MB Restart"],
          series: [{ key: "v", label: "Intäkter", role: "primary", values: [null, null] }],
          unit: "kr",
          highlightIndex: null,
        },
        title: "Intäkter per bolag",
      }),
    );
    expect(html).toMatch(/<span class="num[^"]*">–<\/span>/);
    expect(html).not.toMatch(/<span class="num[^"]*">0( |&nbsp;| )kr<\/span>/);
  });

  const donut: ChartData = {
    categories: ["MB AB", "MB Restart"],
    series: [{ key: "v", label: "Intäkter", role: "primary", values: [3_000_000, 1_000_000] }],
    unit: "kr",
    highlightIndex: null,
  };

  it("hides the donut total when asked (slides show it beside the chart)", () => {
    const shown = render(createElement(MbDonut, { data: donut, title: "Intäkter per bolag" }));
    expect(shown).toContain('data-slot="donut-total"');
    const hidden = render(
      createElement(MbDonut, {
        data: donut,
        title: "Intäkter per bolag",
        centerLabel: "Totalt",
        showTotal: false,
      }),
    );
    expect(hidden).not.toContain('data-slot="donut-total"');
    expect(hidden).not.toContain(`4,0${NBSP}mkr`);
    expect(hidden).not.toContain("Totalt");
    // The legend still gives every share.
    expect(hidden).toContain(`75${NBSP}%`);
  });

  it("lists the drill-down links of bars and slices for the keyboard", () => {
    const hrefs = ["/utforska/verksamhet/1", null];
    for (const html of [
      render(
        createElement(MbBarChart, {
          data: donut,
          title: "Intäkter per bolag",
          orientation: "horizontal",
          categoryHrefs: hrefs,
        }),
      ),
      render(
        createElement(MbDonut, { data: donut, title: "Intäkter per bolag", categoryHrefs: hrefs }),
      ),
    ]) {
      const nav = /<nav [^>]*data-slot="chart-links"[^>]*>(.*?)<\/nav>/.exec(html);
      expect(nav?.[0]).toContain('aria-label="Öppna i Intäkter per bolag"');
      expect(nav?.[0]).toContain('class="sr-only focus-within:not-sr-only"');
      const link = /<a ([^>]*)>MB AB<\/a>/.exec(nav?.[1] ?? "")?.[1] ?? "";
      expect(link).toContain('href="/utforska/verksamhet/1"');
      expect(link).toContain('data-category-index="0"');
      // Not drillable: no link.
      expect(nav?.[1]).not.toContain("MB Restart");
    }
    const plain = render(createElement(MbBarChart, { data: donut, title: "Intäkter per bolag" }));
    expect(plain).not.toContain("chart-links");
    expect(
      render(createElement(MbBarChart, { data: donut, title: "X", categoryHrefs: [null, null] })),
    ).not.toContain("chart-links");
  });

  it("sizes axis labels for miniatures", () => {
    expect(axisTick()).toBe(AXIS_TICK);
    expect(axisTick(12)).toBe(AXIS_TICK);
    expect(axisTick(7)).toEqual({ fill: "var(--muted-foreground)", fontSize: 7 });
  });
});

describe("category axis of horizontal bars", () => {
  // A fixed 7 px per character, roughly Montserrat at 12 px.
  const measure = (text: string) => [...text].length * 7;

  it("keeps a label that fits and cuts a longer one with an ellipsis", () => {
    expect(fitLabel("Early Bird AB", 91, measure)).toBe("Early Bird AB");
    expect(fitLabel("Early Bird AB", 90, measure)).toBe("Early Bird…");
    // No space before the ellipsis.
    expect(fitLabel("Early Bird AB", 49, measure)).toBe("Early…");
    expect(fitLabel("Early Bird AB", 6, measure)).toBe("…");
    for (const max of [10, 35, 63, 84]) {
      const label = fitLabel("Göteborgs Stads Bostadsbolag AB", max, measure);
      expect(measure(label)).toBeLessThanOrEqual(max);
    }
  });

  it("is as wide as the longest label on a wide slide", () => {
    const names = ["Early Bird AB", "Volvo", "Övriga"];
    expect(fitCategoryAxis(names, 560, measure)).toEqual({
      width: 13 * 7 + CATEGORY_TICK_GAP,
      labels: names,
    });
  });

  it("leaves the bars their room on a phone and never clips a name's first letters", () => {
    const fit = fitCategoryAxis(["Göteborgs Stads Bostadsbolag AB", "Early Bird AB"], 300, measure);
    expect(fit.width).toBeLessThanOrEqual(300 * CATEGORY_AXIS_MAX_SHARE);
    expect(fit.labels).toEqual(["Göteborgs Stads…", "Early Bird AB"]);
    for (const label of fit.labels) {
      expect(measure(label) + CATEGORY_TICK_GAP).toBeLessThanOrEqual(fit.width);
    }
  });

  it("estimates text widths on the server", () => {
    expect(estimateTextWidth("Volvo", 10)).toBeCloseTo(31);
    expect(fitCategoryAxis([], 300, measure)).toEqual({ width: CATEGORY_TICK_GAP, labels: [] });
  });

  it("draws a cut label with the full name as its title", () => {
    const names = ["Göteborgs Stads Bostadsbolag AB", "Volvo"];
    const tick = fittedCategoryTick(names, fitCategoryAxis(names, 300, measure), AXIS_TICK);
    const draw = (value: string) =>
      renderToStaticMarkup(createElement("svg", null, tick({ x: 112, y: 40, payload: { value } })));
    expect(draw("Göteborgs Stads Bostadsbolag AB")).toBe(
      '<svg><text x="112" y="40" dy="0.355em" text-anchor="end" fill="var(--muted-foreground)"' +
        ' font-size="12"><title>Göteborgs Stads Bostadsbolag AB</title>Göteborgs Stads…</text></svg>',
    );
    expect(draw("Volvo")).toBe(
      '<svg><text x="112" y="40" dy="0.355em" text-anchor="end" fill="var(--muted-foreground)"' +
        ' font-size="12">Volvo</text></svg>',
    );
  });

  it("renders a horizontal chart fitted to its width on the server", () => {
    const names = ["Göteborgs Stads Bostadsbolag AB", "Early Bird AB"];
    const data: ChartData = {
      categories: names,
      series: [{ key: "x", label: "Fakturerat", role: "primary", values: [3, 2] }],
      unit: "kr",
      highlightIndex: null,
    };
    // The server render has no canvas: the estimate stands in, and the data table keeps names whole.
    const html = renderToStaticMarkup(
      createElement(MbBarChart, { data, title: "Kunder", orientation: "horizontal", width: 300 }),
    );
    expect(html).toContain("Göteborgs Stads Bostadsbolag AB");
  });
});
