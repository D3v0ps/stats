// Pure data shaping and Swedish formatting for the Mb* charts. Charts take the contract's
// ChartData (categories × series) so dashboard widgets and report slides feed them directly.
import type { ChartData, ChartSeries, Unit } from "@/lib/contracts";
import { MISSING, formatAmount, formatNumber, formatValue } from "@/lib/core/format-sv";
import { assignSeriesColors, categoricalColor, roleColor, type ColorMode } from "../tokens";

/** Quiet axis labels: compact amounts, whole percent, no decimals on large numbers. */
export function formatAxisTick(value: number, unit: Unit): string {
  if (!Number.isFinite(value)) return MISSING;
  switch (unit) {
    case "kr":
      return formatAmount(value, { compact: true });
    case "pct":
      return formatValue(value, "pct", { decimals: Number.isInteger(value) ? 0 : 1 });
    case "h":
      return formatValue(value, "h", { decimals: Number.isInteger(value) ? 0 : 1 });
    case "faktor":
      return formatNumber(value, Number.isInteger(value) ? 0 : 1);
    case "man":
      return formatValue(value, "man", { decimals: Number.isInteger(value) ? 0 : 1 });
    case "st":
      return formatNumber(value, Number.isInteger(value) ? 0 : 1);
  }
}

/** Tooltip and data-table values: full precision with unit; missing month -> "–". */
export function formatChartValue(value: unknown, unit: Unit): string {
  return typeof value === "number" ? formatValue(value, unit) : MISSING;
}

/** Recharts data keys must be CSS-safe (they become --color-<key>), so series are s0, s1, … */
export function seriesDataKey(index: number): string {
  return `s${index}`;
}

export type ChartRow = { category: string; index: number } & Record<string, string | number | null>;

/** One row per category with each series under its data key. */
export function toChartRows(data: ChartData): ChartRow[] {
  return data.categories.map((category, index) => {
    const row: ChartRow = { category, index };
    data.series.forEach((s, i) => {
      const v = s.values[index];
      row[seriesDataKey(i)] = typeof v === "number" && Number.isFinite(v) ? v : null;
    });
    return row;
  });
}

export interface SeriesStyle {
  dataKey: string;
  label: string;
  role: ChartSeries["role"];
  color: string;
  /** Previous-period series are dashed so they never depend on colour alone. */
  dashed: boolean;
}

export function seriesStyles(
  series: readonly ChartSeries[],
  mode: ColorMode = "css",
): SeriesStyle[] {
  const colors = assignSeriesColors(series, mode);
  return series.map((s, i) => ({
    dataKey: seriesDataKey(i),
    label: s.label,
    role: s.role,
    color: colors[i]!,
    dashed: s.role === "previous",
  }));
}

/** Config for the shadcn ChartContainer (labels + colours keyed by data key). */
export function chartConfigFor(styles: readonly SeriesStyle[]) {
  return Object.fromEntries(styles.map((s) => [s.dataKey, { label: s.label, color: s.color }]));
}

/** Colour of one bar: the highlighted category is red, the rest follow the series. */
export function barFill(
  seriesColor: string,
  categoryIndex: number,
  highlightIndex: number | null,
  mode: ColorMode = "css",
): string {
  return highlightIndex !== null && categoryIndex === highlightIndex
    ? roleColor("highlight", mode)
    : seriesColor;
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** 0..1 of the total of positive values. */
  share: number;
  color: string;
  index: number;
}

/**
 * Donut slices from the first series. Missing and non-positive values cannot be drawn as a
 * share and are left out; the highlighted category is red.
 */
export function donutSlices(data: ChartData, mode: ColorMode = "css"): DonutSlice[] {
  const values = data.series[0]?.values ?? [];
  const entries = data.categories
    .map((label, index) => ({ label, index, value: values[index] }))
    .filter((e): e is { label: string; index: number; value: number } => {
      return typeof e.value === "number" && Number.isFinite(e.value) && e.value > 0;
    });
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  let colorCursor = 0;
  return entries.map((e) => {
    const highlighted = data.highlightIndex === e.index;
    const color = highlighted
      ? roleColor("highlight", mode)
      : categoricalColor(colorCursor++, mode);
    return {
      key: `d${e.index}`,
      label: e.label,
      value: e.value,
      share: total > 0 ? e.value / total : 0,
      color,
      index: e.index,
    };
  });
}

/**
 * The total shown in the donut hole: the sum of the drawn (positive) slices, or null when no
 * category has a value at all. A missing month is not 0, so it must not read "0 kr".
 */
export function donutTotal(data: ChartData): number | null {
  const values = data.series[0]?.values ?? [];
  const hasData = data.categories.some((_, index) => {
    const v = values[index];
    return typeof v === "number" && Number.isFinite(v);
  });
  if (!hasData) return null;
  return donutSlices(data, "hex").reduce((sum, s) => sum + s.value, 0);
}

/** Rows for the visually hidden data table that accompanies every chart. */
export function chartTableRows(data: ChartData): { label: string; values: string[] }[] {
  return data.categories.map((label, index) => ({
    label,
    values: data.series.map((s) => formatChartValue(s.values[index], data.unit)),
  }));
}

/** Room between a category label and its bar: Recharts' tick size (6) plus tick margin (2). */
export const CATEGORY_TICK_GAP = 8;

/** The most of a horizontal bar chart's width its category axis may take. */
export const CATEGORY_AXIS_MAX_SHARE = 0.4;

/** Text width when nothing can measure it (server render): about 0.62 em per character. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * 0.62;
}

/** `text` whole when it fits `maxWidth`, else as much of it as fits followed by "…". */
export function fitLabel(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  const cut = (n: number) => `${chars.slice(0, n).join("").trimEnd()}…`;
  // The longest prefix that fits; a longer prefix is never narrower.
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(cut(mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return cut(lo);
}

export interface CategoryAxisFit {
  /** Axis width in px, the gap to the bars included. */
  width: number;
  /** The label shown per category, aligned with the categories. */
  labels: string[];
}

/**
 * The category axis of horizontal bars in a chart `chartWidth` px wide: as wide as its
 * longest label, but at most CATEGORY_AXIS_MAX_SHARE of the chart so the bars keep their
 * room on a phone. Longer labels are cut with "…" instead of running off the chart's edge.
 */
export function fitCategoryAxis(
  categories: readonly string[],
  chartWidth: number,
  measure: (text: string) => number,
): CategoryAxisFit {
  const room = Math.max(0, chartWidth * CATEGORY_AXIS_MAX_SHARE - CATEGORY_TICK_GAP);
  const labels = categories.map((c) => fitLabel(c, room, measure));
  const widest = Math.max(0, ...labels.map(measure));
  return { width: Math.ceil(widest) + CATEGORY_TICK_GAP, labels };
}
