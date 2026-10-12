// Server-side loading of Utforska over any MetricDataSource: one engine query for the selected
// metrics and breakdown, turned into the pivot table, chart, breadcrumb and every link the page
// needs (drill-down, entity pages, sorting), so the table itself can render without client JS.
import type { UrlFilters } from "@/lib/app/filters";
import { COMPANY_FILTER_LABELS, type ComparisonKind } from "@/lib/contracts/domain";
import {
  COMPANY_GROUP,
  type DimFilter,
  type MetricDataSource,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/contracts/metric-query";
import type { ChartData } from "@/lib/contracts/slides";
import { addMonths, compareMonths, type Month } from "@/lib/core/month";
import { FOOTNOTE_COMPANY_SUM, runMetricQuery } from "@/lib/metrics";
import { buildCsv } from "./csv";
import { DRILL_CHAIN, buildBreadcrumbs, defaultBreakdown, drillInto, type Crumb } from "./drill";
import {
  MONTH_GROUP,
  entityHref,
  exploreHref,
  toggleSort,
  type DrillFilter,
  type ExploreState,
} from "./explore-state";
import type { SourceQuery } from "./load-dashboard";
import {
  definitionMap,
  dimensionLabelOf,
  notApplicableReason,
  perGroupTitle,
  selectableMetrics,
  supportedDimensions,
  supportsBreakdown,
  type DimensionMeta,
} from "./metrics-meta";
import {
  breakdownChart,
  buildGroupPivot,
  buildMonthPivot,
  monthChart,
  pivotCsvRows,
  sortPivotRows,
  type PivotModel,
  type PivotRow,
} from "./pivot";
import {
  BOOKED_REVENUE_METRIC,
  CUSTOMER_REVENUE_METRIC,
  needsBookedRemainder,
  remainderFor,
} from "./remainder";

export const DEFAULT_EXPLORE_METRIC = "resultat";

export interface ExploreContext {
  source: MetricDataSource;
  definitions: MetricDefinition[];
  dimensions: DimensionMeta[];
  filters: UrlFilters;
  anchor: Month;
}

export interface BreakdownOption {
  key: string;
  label: string;
  enabled: boolean;
  /** Why it is disabled, or which selected metrics lack it. */
  reason: string | null;
  personal: boolean;
  href: string;
}

export interface ExploreRowLinks {
  drill: string | null;
  entity: string | null;
}

export interface ExploreView {
  /** Normalized state: valid metrics, effective breakdown. */
  state: ExploreState;
  metrics: MetricDefinition[];
  groupBy: string;
  groupLabel: string;
  /** Breakdown a click on a row leads to (null: rows lead to the entity page only). */
  nextBreakdownLabel: string | null;
  breakdownOptions: BreakdownOption[];
  crumbs: Crumb[];
  results: MetricResult[];
  /** Per metric: why there is no number (not applicable / no data). */
  notes: { metricKey: string; text: string; kind: "not_applicable" | "no_data" }[];
  footnotes: string[];
  pivot: PivotModel | null;
  sortedRows: PivotRow[];
  rowLinks: Record<string, ExploreRowLinks>;
  sortLinks: Record<string, string>;
  csv: string | null;
  chart: ChartData | null;
  chartTitle: string;
  windowLabel: string;
  companyLabel: string;
  sourceQuery: SourceQuery;
}

function throughAnchor(result: MetricResult, anchor: Month): MetricResult {
  if (!result.series) return result;
  return { ...result, series: result.series.filter((p) => compareMonths(p.month, anchor) <= 0) };
}

function toDimFilters(filters: readonly DrillFilter[]): DimFilter[] {
  return filters.map((f) => ({ dimension: f.dimension, valueIds: [f.valueId] }));
}

/** Valid selected metrics (unknown keys dropped), falling back to the default metric. */
export function normalizeMetrics(
  keys: readonly string[],
  defs: readonly MetricDefinition[],
): MetricDefinition[] {
  const selectable = new Map(selectableMetrics(defs).map((d) => [d.key, d]));
  const picked = keys.flatMap((k) => {
    const d = selectable.get(k);
    return d ? [d] : [];
  });
  if (picked.length > 0) return picked;
  const fallback = selectable.get(DEFAULT_EXPLORE_METRIC) ?? [...selectable.values()][0];
  return fallback ? [fallback] : [];
}

/** Breakdown choices: per month, bolag, then the dimensions any selectable metric has. */
export function breakdownOptions(
  selected: readonly MetricDefinition[],
  allDefs: readonly MetricDefinition[],
  dimensions: readonly DimensionMeta[],
  hrefOf: (key: string) => string,
): BreakdownOption[] {
  const known = supportedDimensions(selectableMetrics(allDefs));
  const chain: string[] = [...DRILL_CHAIN].filter((d) => d !== COMPANY_GROUP);
  const ordered = [
    ...chain.filter((d) => known.includes(d)),
    ...known.filter((d) => !chain.includes(d)),
  ];
  const keys = [MONTH_GROUP, COMPANY_GROUP, ...ordered];
  return keys.map((key) => {
    const lacking = selected.filter((d) => !supportsBreakdown(d, key));
    const enabled = lacking.length < selected.length;
    const label = dimensionLabelOf(key, dimensions);
    const names = lacking.map((d) => d.name).join(", ");
    return {
      key,
      label,
      enabled,
      reason: lacking.length === 0 ? null : `${label} finns inte för ${names}.`,
      personal: dimensions.find((d) => d.key === key)?.personal ?? key === "konsult",
      href: hrefOf(key),
    };
  });
}

export async function loadExplore(state: ExploreState, ctx: ExploreContext): Promise<ExploreView> {
  const defsByKey = definitionMap(ctx.definitions);
  const metrics = normalizeMetrics(state.metrics, ctx.definitions);
  const metricKeys = metrics.map((m) => m.key);
  const supported = supportedDimensions(metrics);
  const company = ctx.filters.company;
  const groupBy = state.groupBy ?? defaultBreakdown(company, state.filters, supported);
  const monthMode = groupBy === MONTH_GROUP;
  const normalized: ExploreState = { ...state, metrics: metricKeys, groupBy };
  const linkFilters = ctx.filters;

  // Summary cards compare even in month mode; only the group table shows budget columns.
  const compare: ComparisonKind[] = ["prev_period", "prev_year"];
  if (!monthMode && metrics.some((m) => m.kind === "ledger")) compare.push("budget");
  const dimFilters = toDimFilters(state.filters);

  const remainderWanted = !monthMode && needsBookedRemainder(metricKeys, groupBy, state.filters);
  // Per month: the window's months (a single month shows the last 12 instead).
  const seriesKind = ctx.filters.grain === "month" ? "last12" : "window";
  const [main, previousYear, booked, filterLabels] = await Promise.all([
    runMetricQuery(
      {
        metricKeys,
        period: { grain: ctx.filters.grain, anchor: ctx.anchor },
        company,
        scenario: "utfall",
        groupBy: monthMode ? null : groupBy,
        filters: dimFilters,
        compare,
        series: monthMode ? seriesKind : null,
        topN: null,
      },
      ctx.source,
    ),
    monthMode && metricKeys.length === 1
      ? runMetricQuery(
          {
            metricKeys,
            period: { grain: ctx.filters.grain, anchor: addMonths(ctx.anchor, -12) },
            company,
            scenario: "utfall",
            groupBy: null,
            filters: dimFilters,
            compare: [],
            series: seriesKind,
            topN: null,
          },
          ctx.source,
        )
      : null,
    remainderWanted && defsByKey.has(BOOKED_REVENUE_METRIC)
      ? runMetricQuery(
          {
            metricKeys: [BOOKED_REVENUE_METRIC],
            period: { grain: ctx.filters.grain, anchor: ctx.anchor },
            company,
            scenario: "utfall",
            groupBy: null,
            filters: [],
            compare: ["prev_period", "prev_year"],
            series: null,
            topN: null,
          },
          ctx.source,
        )
      : null,
    Promise.all(state.filters.map((f) => ctx.source.labels(f.dimension, [f.valueId]))),
  ]);
  // Months after the anchor (rest of a year or quarter) have no data yet: not shown per month.
  const results = monthMode ? main.results.map((r) => throughAnchor(r, ctx.anchor)) : main.results;
  const previousYearSeries =
    previousYear?.results[0]?.series?.slice(0, results[0]?.series?.length ?? 0) ?? null;
  const primary = results.find((r) => r.status !== "not_applicable") ?? results[0];
  const primaryDef = primary ? defsByKey.get(primary.metricKey) : undefined;

  const groupLabel = dimensionLabelOf(groupBy, ctx.dimensions);
  const notes: ExploreView["notes"] = [];
  for (const r of results) {
    const def = defsByKey.get(r.metricKey);
    if (!def) continue;
    if (r.status === "not_applicable") {
      const reason = notApplicableReason(def, r.notApplicable, ctx.dimensions, defsByKey);
      notes.push({
        metricKey: r.metricKey,
        kind: "not_applicable",
        // Side by side, say which metric the note is about.
        text:
          metrics.length > 1
            ? `${def.name}: ${reason.charAt(0).toLocaleLowerCase("sv-SE")}${reason.slice(1)}`
            : reason,
      });
    } else if (r.status === "no_data") {
      notes.push({
        metricKey: r.metricKey,
        kind: "no_data",
        text: `${def.name}: ingen publicerad data för ${r.window.label}.`,
      });
    }
  }

  const footnotes: string[] = [];
  if (primary && primary.status === "ok") {
    const { withData, expected } = primary.total.coverage;
    if (withData < expected) footnotes.push(`${withData} av ${expected} mån har data`);
  }
  if (company === "ALL" && metrics.some((m) => m.unit === "kr"))
    footnotes.push(FOOTNOTE_COMPANY_SUM);

  const anyApplicable = results.some((r) => r.status !== "not_applicable");
  const customers = results.find((r) => r.metricKey === CUSTOMER_REVENUE_METRIC);
  const bookedResult = booked?.results[0];
  const remainderValues =
    customers && bookedResult && customers.status === "ok"
      ? remainderFor(customers, bookedResult)
      : null;
  const pivot: PivotModel | null = !anyApplicable
    ? null
    : monthMode
      ? buildMonthPivot({
          defs: metrics,
          results,
          groupBy,
          groupLabel,
          previousYearSeries,
        })
      : buildGroupPivot({
          defs: metrics,
          results,
          groupBy,
          groupLabel,
          remainder: remainderValues
            ? { metricKey: CUSTOMER_REVENUE_METRIC, values: remainderValues }
            : null,
        });

  const validSort =
    normalized.sort &&
    (normalized.sort.key === "label" || pivot?.columns.some((c) => c.key === normalized.sort?.key))
      ? normalized.sort
      : null;
  const sortedRows = pivot ? sortPivotRows(pivot.rows, validSort) : [];
  const stateForLinks: ExploreState = { ...normalized, sort: validSort };

  const rowLinks: Record<string, ExploreRowLinks> = {};
  for (const row of pivot?.rows ?? []) {
    const drilled = row.drill ? drillInto(stateForLinks, linkFilters, row.drill, supported) : null;
    rowLinks[row.key] = {
      drill: drilled ? exploreHref(drilled.state, drilled.filters) : null,
      entity: row.entity ? entityHref(row.entity.dimension, row.entity.valueId, linkFilters) : null,
    };
  }
  const sortLinks: Record<string, string> = {};
  for (const key of ["label", ...(pivot?.columns.map((c) => c.key) ?? [])]) {
    sortLinks[key] = exploreHref(
      { ...stateForLinks, sort: toggleSort(validSort, key) },
      linkFilters,
    );
  }

  // What clicking a row leads to (same rule as the row links themselves).
  const sampleDrill = pivot?.rows.find((r) => r.drill)?.drill ?? null;
  const nextAfterRow = sampleDrill
    ? (drillInto(stateForLinks, linkFilters, sampleDrill, supported)?.state.groupBy ?? null)
    : null;

  const labelOf = (f: DrillFilter) => {
    const i = state.filters.indexOf(f);
    return (
      filterLabels[i]?.[f.valueId] ??
      `${dimensionLabelOf(f.dimension, ctx.dimensions)} ${f.valueId}`
    );
  };

  let chart: ChartData | null = null;
  if (primary && primaryDef) {
    chart = monthMode
      ? monthChart(primary, primaryDef, previousYearSeries)
      : breakdownChart(primary, primaryDef);
  }
  const windowLabel = primary?.window.label ?? "";
  const csvParts = pivot ? pivotCsvRows(pivot, sortedRows) : null;

  return {
    state: stateForLinks,
    metrics,
    groupBy,
    groupLabel,
    nextBreakdownLabel: nextAfterRow ? dimensionLabelOf(nextAfterRow, ctx.dimensions) : null,
    breakdownOptions: breakdownOptions(metrics, ctx.definitions, ctx.dimensions, (key) =>
      exploreHref({ ...stateForLinks, groupBy: key, sort: null }, linkFilters),
    ),
    crumbs: buildBreadcrumbs(stateForLinks, linkFilters, labelOf),
    results,
    notes,
    footnotes,
    pivot,
    sortedRows,
    rowLinks,
    sortLinks,
    csv: csvParts ? buildCsv(csvParts.header, csvParts.rows) : null,
    chart,
    chartTitle: primaryDef ? perGroupTitle(primaryDef.name, groupLabel) : "",
    windowLabel,
    companyLabel: COMPANY_FILTER_LABELS[company],
    sourceQuery: {
      metricKeys,
      company,
      from: primary?.series?.[0]?.month ?? primary?.window.from ?? ctx.anchor,
      to: ctx.anchor,
    },
  };
}
