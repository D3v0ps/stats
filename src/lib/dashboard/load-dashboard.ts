// Server-side loading of the start dashboard over any MetricDataSource: every widget is
// resolved with resolveWidget (the same resolver as board slides), then enriched with what a
// workspace card needs on top: drill-down links, a budget comparison for ledger KPIs and a
// budget series for monthly ledger bars. Pure orchestration (no I/O of its own), so tests run
// it over MemoryMetricDataSource.
import type { UrlFilters } from "@/lib/app/filters";
import type { GlobalFilters, WidgetSpec } from "@/lib/contracts/dashboard";
import {
  COMPANY_FILTER_LABELS,
  type CompanyCode,
  type CompanyFilter,
} from "@/lib/contracts/domain";
import {
  COMPANY_GROUP,
  type MetricDataSource,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/contracts/metric-query";
import type { ResolvedDelta, ResolvedSlide } from "@/lib/contracts/slides";
import {
  addMonths,
  compareMonths,
  lastClosedMonth,
  resolvePeriod,
  type Month,
} from "@/lib/core/month";
import {
  MetricConfigError,
  PersonalDataError,
  companiesOf,
  dataRangeOf,
  resolveWidget,
  runMetricQuery,
  type WidgetResolveContext,
} from "@/lib/metrics";
import { BUDGET_ONLY_WIDGET_IDS } from "./default-dashboard";
import { defaultBreakdown } from "./drill";
import { MONTH_GROUP, entityHref, exploreHref, type DrillFilter } from "./explore-state";
import {
  definitionMap,
  leafMetricKeys,
  personalDimensionSet,
  type DimensionMeta,
} from "./metrics-meta";
import { toPivotDelta } from "./pivot";

export interface DashboardContext {
  source: MetricDataSource;
  definitions: MetricDefinition[];
  dimensions: DimensionMeta[];
  /** Global filters from the URL (anchor null = default). */
  filters: UrlFilters;
  /** The month actually shown (URL month or the default anchor). */
  anchor: Month;
}

export interface CategoryLink {
  label: string;
  href: string | null;
}

/** What the Källa popover asks the server for. */
export interface SourceQuery {
  metricKeys: string[];
  company: CompanyFilter;
  from: Month;
  to: Month;
}

export interface LoadedWidget {
  spec: WidgetSpec;
  status: "ok" | "hidden" | "error";
  slide: ResolvedSlide | null;
  error: string | null;
  metric: Pick<
    MetricDefinition,
    "key" | "name" | "unit" | "decimals" | "kind" | "higherIsBetter"
  > | null;
  /** The card's drill-down into Utforska. */
  href: string;
  /** Per chart category / toplist row (same order as the chart), null href = not drillable. */
  categoryLinks: CategoryLink[];
  /** Ledger KPIs: comparison with budget when the window has one. */
  budgetDelta: ResolvedDelta | null;
  budgetValue: number | null;
  /** e.g. "MB Restart saknar budget" when the budget covers only one company. */
  budgetNote: string | null;
  sourceQuery: SourceQuery;
}

const BREAKDOWN_VIZ = new Set(["bar", "donut", "toplist", "table"]);
export const BUDGET_SERIES_LABEL = "Budget";

function resolveContext(ctx: DashboardContext): WidgetResolveContext {
  return {
    anchor: ctx.anchor,
    source: ctx.source,
    definitionsByKey: definitionMap(ctx.definitions),
    personalDimensions: personalDimensionSet(ctx.dimensions),
    companyLabels: COMPANY_FILTER_LABELS,
    dimensionLabels: Object.fromEntries(ctx.dimensions.map((d) => [d.key, d.label])),
  };
}

function globalFilters(ctx: DashboardContext): GlobalFilters {
  return { company: ctx.filters.company, grain: ctx.filters.grain, anchor: ctx.anchor };
}

function drillFilters(spec: WidgetSpec): DrillFilter[] {
  return spec.filters.flatMap((f) =>
    f.valueIds[0] === undefined ? [] : [{ dimension: f.dimension, valueId: f.valueIds[0] }],
  );
}

/** The Utforska view behind a widget: same metric, filters and company, matching breakdown. */
export function widgetExploreHref(
  spec: WidgetSpec,
  def: MetricDefinition | undefined,
  filters: UrlFilters,
): string {
  const company = spec.company ?? filters.company;
  const path = drillFilters(spec);
  let groupBy: string;
  if (spec.groupBy) groupBy = spec.groupBy;
  else if (spec.viz === "stacked_company") groupBy = COMPANY_GROUP;
  else if (spec.viz === "line" || spec.viz === "bar") groupBy = MONTH_GROUP;
  else groupBy = defaultBreakdown(company, path, def?.dimensions ?? []);
  return exploreHref(
    { metrics: [spec.metricKey], groupBy, filters: path },
    { ...filters, company },
  );
}

const earlier = (a: Month, b: Month): Month => (compareMonths(a, b) <= 0 ? a : b);
const later = (a: Month, b: Month): Month => (compareMonths(a, b) >= 0 ? a : b);

/** Months the widget's numbers cover (for the Källa popover). */
function widgetRange(
  spec: WidgetSpec,
  ctx: DashboardContext,
  fiscalStart: number,
): { from: Month; to: Month } {
  if (spec.viz === "line") return { from: addMonths(ctx.anchor, -23), to: ctx.anchor };
  const window = dataRangeOf(
    resolvePeriod({ grain: ctx.filters.grain, anchor: ctx.anchor }, fiscalStart),
  );
  const monthly = spec.viz === "stacked_company" || (spec.viz === "bar" && !spec.groupBy);
  // KPI sparklines and monthly charts show the last 12 months as well as the window.
  if (monthly || spec.viz === "kpi") {
    return { from: earlier(window.from, addMonths(ctx.anchor, -11)), to: ctx.anchor };
  }
  return { from: window.from, to: window.to };
}

function errorMessage(e: unknown): string {
  if (e instanceof PersonalDataError || e instanceof MetricConfigError) return e.message;
  return "Kunde inte beräkna widgeten.";
}

/**
 * Drill-down per chart category / table row, from the group ids the resolver put on the
 * slide (ChartData.categoryIds, TableData row ids): entity pages for dimension values, the
 * company's own view for "bolag"; months, "Övriga", unassigned and totals are not drillable.
 */
function categoryLinks(
  spec: WidgetSpec,
  slide: ResolvedSlide,
  ctx: DashboardContext,
  company: CompanyFilter,
  def: MetricDefinition,
): CategoryLink[] {
  const groupBy = spec.groupBy;
  if (!groupBy || !BREAKDOWN_VIZ.has(spec.viz)) return [];
  const chart = slide.chart;
  const entries = chart
    ? chart.categories.map((label, i) => ({ label, id: chart.categoryIds?.[i] ?? null }))
    : (slide.table?.rows ?? []).map((r) => ({ label: r.label, id: r.id ?? null }));
  const urlFilters = { ...ctx.filters, company };
  return entries.map(({ label, id }) => {
    if (id === null) return { label, href: null };
    if (groupBy === COMPANY_GROUP) {
      const code = id as CompanyCode;
      return {
        label,
        href: exploreHref(
          {
            metrics: [spec.metricKey],
            groupBy: defaultBreakdown(code, [], def.dimensions),
          },
          { ...urlFilters, company: code },
        ),
      };
    }
    return typeof id === "number"
      ? { label, href: entityHref(groupBy, id, urlFilters) }
      : { label, href: null };
  });
}

interface BudgetComparison {
  delta: ResolvedDelta | null;
  value: number | null;
  /** Summa bolag against a budget that covers only one company is not like for like. */
  note: string | null;
}

async function budgetComparison(
  spec: WidgetSpec,
  ctx: DashboardContext,
  company: CompanyFilter,
  def: MetricDefinition,
): Promise<BudgetComparison> {
  // Grouped by company so a company without budget shows up (its budget cell is null).
  const result = (
    await runMetricQuery(
      {
        metricKeys: [def.key],
        period: { grain: ctx.filters.grain, anchor: ctx.anchor },
        company,
        scenario: "utfall",
        groupBy: company === "ALL" ? COMPANY_GROUP : null,
        filters: spec.filters,
        compare: ["budget"],
        series: null,
        topN: null,
      },
      ctx.source,
    )
  ).results[0] as MetricResult;
  const cell = result.total.compare.budget;
  if (!cell || cell.value === null) return { delta: null, value: null, note: null };
  const lacking = result.groups
    .filter((g) => g.value !== null && (g.compare.budget?.value ?? null) === null)
    .map((g) => `${g.label} saknar budget`);
  return {
    delta: toPivotDelta(cell, def.unit, def.higherIsBetter),
    value: cell.value,
    note: lacking.length > 0 ? lacking.join(" · ") : null,
  };
}

async function budgetSeries(
  spec: WidgetSpec,
  ctx: DashboardContext,
  company: CompanyFilter,
  def: MetricDefinition,
): Promise<(number | null)[] | null> {
  const result = (
    await runMetricQuery(
      {
        metricKeys: [def.key],
        period: { grain: "month", anchor: ctx.anchor },
        company,
        scenario: "budget",
        groupBy: null,
        filters: spec.filters,
        compare: [],
        series: "last12",
        topN: null,
      },
      ctx.source,
    )
  ).results[0] as MetricResult;
  const values = (result.series ?? []).map((p) => p.value);
  return values.some((v) => v !== null) ? values : null;
}

/** Resolve one widget for the dashboard. Never throws: a broken widget shows its error. */
export async function loadWidget(spec: WidgetSpec, ctx: DashboardContext): Promise<LoadedWidget> {
  const defs = definitionMap(ctx.definitions);
  const def = defs.get(spec.metricKey);
  const company = spec.company ?? ctx.filters.company;
  let range: { from: Month; to: Month };
  try {
    range = widgetRange(spec, ctx, await ctx.source.fiscalStartMonth());
  } catch {
    // The widget below fails the same way and shows its error; Källa still gets a range.
    range = { from: ctx.anchor, to: ctx.anchor };
  }
  const base: LoadedWidget = {
    spec,
    status: "ok",
    slide: null,
    error: null,
    metric: def
      ? {
          key: def.key,
          name: def.name,
          unit: def.unit,
          decimals: def.decimals,
          kind: def.kind,
          higherIsBetter: def.higherIsBetter,
        }
      : null,
    href: widgetExploreHref(spec, def, ctx.filters),
    categoryLinks: [],
    budgetDelta: null,
    budgetValue: null,
    budgetNote: null,
    sourceQuery: { metricKeys: [spec.metricKey], company, ...range },
  };
  if (!def) return { ...base, status: "error", error: `Okänt mått: ${spec.metricKey}.` };

  try {
    const monthlyLedgerBar = spec.viz === "bar" && !spec.groupBy && def.kind === "ledger";
    const [slide, budget, series] = await Promise.all([
      resolveWidget(spec, globalFilters(ctx), resolveContext(ctx)),
      // A KPI that already compares with budget (WidgetSpec.compare) gets no second budget delta.
      spec.viz === "kpi" && def.kind === "ledger" && spec.compare !== "budget"
        ? budgetComparison(spec, ctx, company, def)
        : Promise.resolve<BudgetComparison>({ delta: null, value: null, note: null }),
      monthlyLedgerBar ? budgetSeries(spec, ctx, company, def) : Promise.resolve(null),
    ]);
    if (BUDGET_ONLY_WIDGET_IDS.has(spec.id) && series === null) {
      return { ...base, status: "hidden" };
    }
    let finalSlide = slide;
    if (series && slide.chart) {
      finalSlide = {
        ...slide,
        chart: {
          ...slide.chart,
          series: [
            ...slide.chart.series,
            {
              key: `${def.key}_budget`,
              label: BUDGET_SERIES_LABEL,
              role: "secondary",
              values: series,
            },
          ],
        },
      };
    }
    return {
      ...base,
      slide: finalSlide,
      categoryLinks: categoryLinks(spec, slide, ctx, company, def),
      budgetDelta: budget.delta,
      budgetValue: budget.value,
      budgetNote: budget.note,
    };
  } catch (e) {
    return { ...base, status: "error", error: errorMessage(e) };
  }
}

export interface DashboardMeta {
  /** false when nothing at all is published for the dashboard's metrics (empty state). */
  hasData: boolean;
  /** Newest published upload per widget metric key, for the window. */
  lastUpdated: Record<string, string | null>;
  newest: string | null;
}

/** Whether anything is published, and when the numbers were last updated. */
export async function loadDashboardMeta(input: {
  widgets: readonly WidgetSpec[];
  source: MetricDataSource;
  definitions: MetricDefinition[];
  filters: UrlFilters;
  anchor: Month;
  now: Date;
}): Promise<DashboardMeta> {
  const defs = definitionMap(input.definitions);
  const keys = [...new Set(input.widgets.map((w) => w.metricKey))].filter((k) => defs.has(k));
  const leaves = [...new Set(keys.flatMap((k) => leafMetricKeys(k, defs)))];
  const lastClosed = lastClosedMonth(input.now);
  const companies = companiesOf(input.filters.company);
  const fiscalStart = await input.source.fiscalStartMonth();
  const window = dataRangeOf(
    resolvePeriod({ grain: input.filters.grain, anchor: input.anchor }, fiscalStart),
  );
  const [coverage, lastUpdated] = await Promise.all([
    input.source.coverage(leaves, {
      companies: ["MBAB", "MBR"],
      scenario: "utfall",
      from: addMonths(lastClosed, -23),
      to: later(input.anchor, lastClosed),
      groupBy: [],
      filters: [],
    }),
    input.source.lastUpdated(keys, {
      companies,
      scenario: "utfall",
      from: earlier(window.from, addMonths(input.anchor, -11)),
      to: input.anchor,
      groupBy: [],
      filters: [],
    }),
  ]);
  let newest: string | null = null;
  for (const t of Object.values(lastUpdated)) {
    if (t && (newest === null || Date.parse(t) > Date.parse(newest))) newest = t;
  }
  return {
    hasData: Object.values(coverage).some((months) => months.length > 0),
    lastUpdated,
    newest,
  };
}
