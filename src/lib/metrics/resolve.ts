// Slide, report and widget resolution: runs the metric queries a slide needs and
// produces the fully formatted ResolvedSlide that the deck, frozen reports, print view,
// share page and dashboard widgets render. Personal dimensions are refused up front so
// board output can never contain them.
import { GlobalFiltersSchema, WidgetSpecSchema } from "@/lib/contracts/dashboard";
import type { GlobalFilters, WidgetSpec } from "@/lib/contracts/dashboard";
import {
  SEEDED_DIMENSIONS,
  type CompanyCode,
  type CompanyFilter,
  type ComparisonKind,
  type Scenario,
  type Unit,
} from "@/lib/contracts/domain";
import {
  COMPANY_GROUP,
  type CompareCell,
  type DimFilter,
  type MetricDataSource,
  type MetricDefinition,
  type MetricQuery,
  type MetricResult,
} from "@/lib/contracts/metric-query";
import {
  ReportTemplateSpecSchema,
  SlideSpecSchema,
  type ChartData,
  type ChartSeries,
  type ReportTemplateSpec,
  type ResolvedDelta,
  type ResolvedNumber,
  type ResolvedReport,
  type ResolvedSlide,
  type SlideSpec,
  type TableData,
  type VizKind,
} from "@/lib/contracts/slides";
import { formatValue } from "@/lib/core/format-sv";
import {
  addMonths,
  compareMonths,
  formatMonthLong,
  formatMonthShort,
  resolvePeriod,
  type Month,
  type PeriodGrain,
} from "@/lib/core/month";
import { describeDelta } from "./compare";
import { comparisonPlan, dataRangeOf, runMetricQuery } from "./engine";
import { MetricConfigError, PersonalDataError } from "./errors";
import { parseFormula, referencedKeys } from "./formula";
import { headlineSubjectOf, normalizeHeadline, suggestHeadline } from "./headline";

export interface ResolveContext {
  /** Anchor month of the report (normally the latest complete month). */
  anchor: Month;
  source: MetricDataSource;
  definitionsByKey:
    ReadonlyMap<string, MetricDefinition> | Readonly<Record<string, MetricDefinition>>;
  /** Dimension keys flagged is_personal (e.g. "konsult"). */
  personalDimensions: ReadonlySet<string>;
  companyLabels: Readonly<Record<CompanyFilter, string>>;
  /** Dimension key -> display label; defaults to the seeded labels. */
  dimensionLabels?: Readonly<Record<string, string>>;
}

export interface ReportResolveContext extends ResolveContext {
  title: string;
  /** Clock for generatedAt (tests). */
  now?: Date;
}

export interface WidgetResolveContext extends ResolveContext {
  /** Workspace widgets may break down by personal dimensions; board output never. */
  allowPersonalDimensions?: boolean;
}

export const FOOTNOTE_COMPANY_SUM = "Summa bolag (ej eliminerat)";
export const FOOTNOTE_NO_DATA = "Ingen data för perioden";
export const TOTAL_ROW_LABEL = "Totalt";
export const DELTA_COLUMN_LABEL = "Förändring";
export const PREVIOUS_YEAR_SERIES_LABEL = "Föregående år";
/** The toplist shows the top 10 unless the slide says otherwise. */
export const DEFAULT_TOPLIST_N = 10;

const BREAKDOWN_VIZ: ReadonlySet<VizKind> = new Set(["bar", "donut", "toplist", "table"]);
const COMPANY_CODES: CompanyCode[] = ["MBAB", "MBR"];

/** The normalized request behind a slide or a widget. */
interface SlideRequest {
  id: string;
  viz: VizKind;
  metricKey: string;
  grain: PeriodGrain;
  anchor: Month;
  company: CompanyFilter;
  groupBy: string | null;
  filters: DimFilter[];
  compare: ComparisonKind | null;
  topN: number | null;
  headline: string | null;
  notes: string;
}

/** Seeded personal dimensions (konsult): refused even when a caller's set omits them. */
const SEEDED_PERSONAL_DIMENSIONS: ReadonlySet<string> = new Set(
  Object.entries(SEEDED_DIMENSIONS)
    .filter(([, d]) => d.personal)
    .map(([key]) => key),
);

/**
 * Throws PersonalDataError when a group-by or filter uses a personal dimension: one in
 * `personalDimensions` (is_personal in the database) or a seeded personal dimension.
 */
export function assertNoPersonalDimensions(
  spec: { groupBy: string | null; filters: readonly DimFilter[] },
  personalDimensions: ReadonlySet<string>,
  context = "Bilden",
): void {
  const personal = (key: string) =>
    personalDimensions.has(key) || SEEDED_PERSONAL_DIMENSIONS.has(key);
  const found = new Set<string>();
  if (spec.groupBy !== null && personal(spec.groupBy)) found.add(spec.groupBy);
  for (const f of spec.filters) if (personal(f.dimension)) found.add(f.dimension);
  if (found.size > 0) throw new PersonalDataError([...found], context);
}

function tryDefinition(ctx: ResolveContext, key: string): MetricDefinition | undefined {
  const defs = ctx.definitionsByKey;
  return defs instanceof Map
    ? defs.get(key)
    : (defs as Readonly<Record<string, MetricDefinition>>)[key];
}

function lookupDefinition(ctx: ResolveContext, key: string): MetricDefinition {
  const def = tryDefinition(ctx, key);
  if (!def) throw new MetricConfigError(`Okänt mått: ${key}.`, key);
  return def;
}

function dimensionLabel(ctx: ResolveContext, key: string): string {
  const custom = ctx.dimensionLabels?.[key];
  if (custom) return custom;
  if (key === COMPANY_GROUP) return "Bolag";
  return (SEEDED_DIMENSIONS as Record<string, { label: string }>)[key]?.label ?? key;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
}

/** Slides show amounts compactly ("2,4 mkr"); other units use the metric's decimals. */
function formatSlideValue(value: number | null, def: MetricDefinition): string {
  return formatValue(
    value,
    def.unit,
    def.unit === "kr" ? { compact: true } : { decimals: def.decimals ?? undefined },
  );
}

function formatCellDelta(cell: CompareCell | undefined, unit: Unit): string {
  return (cell && describeDelta(cell, unit, { compact: true })?.formatted) ?? "–";
}

function resolveDelta(cell: CompareCell | undefined, def: MetricDefinition): ResolvedDelta | null {
  if (!cell || cell.delta === null) return null;
  const described = describeDelta(cell, def.unit, { compact: true });
  if (!described) return null;
  const favorable =
    def.higherIsBetter === null || described.direction === "flat"
      ? null
      : (described.direction === "up") === def.higherIsBetter;
  return {
    direction: described.direction,
    formatted: described.formatted,
    favorable,
    againstLabel: `mot ${cell.label}`,
  };
}

/** prev_period has no meaning for YTD; the board compares against last year instead. */
function effectiveCompare(
  compare: ComparisonKind | null,
  grain: PeriodGrain,
): ComparisonKind | null {
  return compare === "prev_period" && grain === "ytd" ? "prev_year" : compare;
}

function monthCategories(series: { month: string }[]): string[] {
  return series.map((p) => formatMonthShort(p.month));
}

/** The non-formula metrics whose data stands behind a metric. */
function leafMetricKeys(
  def: MetricDefinition,
  ctx: ResolveContext,
  seen = new Set<string>(),
): string[] {
  if (seen.has(def.key)) return [];
  seen.add(def.key);
  if (def.kind !== "formula") return [def.key];
  let operands: string[];
  try {
    operands = referencedKeys(parseFormula(def.formula ?? ""));
  } catch {
    return [];
  }
  return operands.flatMap((key) => {
    const operand = tryDefinition(ctx, key);
    return operand ? leafMetricKeys(operand, ctx, seen) : [];
  });
}

/**
 * Summa bolag can silently lack a company whose upload is missing (coverage counts a
 * month when any company has data). Among the companies that have reported the data
 * behind this metric during the last 12 months, flag one with fewer months in the window
 * than the other, and one that has data now but fewer months in the comparison window
 * (or budget months) than the other: that delta is not like for like.
 */
async function missingCompanyNotes(
  result: MetricResult,
  req: SlideRequest,
  def: MetricDefinition,
  ctx: ResolveContext,
  compareKind: ComparisonKind | null,
): Promise<string[]> {
  if (req.company !== "ALL" || result.status !== "ok") return [];
  const leaves = leafMetricKeys(def, ctx);
  if (leaves.length === 0) return [];
  const fiscalStart = await ctx.source.fiscalStartMonth();
  const window = resolvePeriod({ grain: req.grain, anchor: req.anchor }, fiscalStart);
  const windowMonths = dataRangeOf(window).months;
  const plan =
    compareKind !== null && result.total.compare[compareKind]
      ? comparisonPlan(compareKind, window, fiscalStart)
      : null;
  const lookbackFrom = [
    window.from,
    addMonths(req.anchor, -12),
    ...(plan?.scenario === "utfall" ? [plan.range.from] : []),
  ].reduce((a, b) => (compareMonths(a, b) <= 0 ? a : b));

  // A month counts for a company when every metric behind the number has data.
  const monthsWithData = async (
    company: CompanyCode,
    scenario: Scenario,
    from: Month,
    to: Month,
  ): Promise<Set<Month>> => {
    const coverage = await ctx.source.coverage(leaves, {
      companies: [company],
      scenario,
      from,
      to,
      groupBy: [],
      filters: [],
    });
    return leaves
      .map((k) => new Set(coverage[k] ?? []))
      .reduce((acc, set) => new Set([...acc].filter((m) => set.has(m))));
  };
  const count = (months: Set<Month>, of: Month[]) => of.filter((m) => months.has(m)).length;

  const perCompany = await Promise.all(
    COMPANY_CODES.map(async (company) => {
      const [actual, budget] = await Promise.all([
        monthsWithData(company, "utfall", lookbackFrom, req.anchor),
        plan?.scenario === "budget"
          ? monthsWithData(company, "budget", plan.range.from, plan.range.to)
          : null,
      ]);
      return {
        company,
        label: ctx.companyLabels[company],
        reported: actual.size > 0,
        inWindow: count(actual, windowMonths),
        inCompare: plan === null ? 0 : count(budget ?? actual, plan.range.months),
      };
    }),
  );
  const reporting = perCompany.filter((c) => c.reported);
  const notes: string[] = [];

  const bestWindow = Math.max(0, ...reporting.map((c) => c.inWindow));
  for (const c of reporting) {
    if (c.inWindow >= bestWindow) continue;
    notes.push(
      c.inWindow === 0
        ? `${c.label} saknar data`
        : `${c.label}: ${c.inWindow} av ${windowMonths.length} mån har data`,
    );
  }

  if (plan !== null) {
    const bestCompare = Math.max(0, ...reporting.map((c) => c.inCompare));
    const months = plan.range.months.length;
    for (const c of reporting) {
      if (c.inWindow === 0 || c.inCompare >= bestCompare) continue;
      if (plan.scenario === "budget") {
        notes.push(
          c.inCompare === 0
            ? `${c.label} saknar budget`
            : `${c.label}: budget för ${c.inCompare} av ${months} mån`,
        );
      } else {
        notes.push(
          c.inCompare === 0
            ? `${c.label} saknar data för ${plan.label}`
            : `${c.label}: ${c.inCompare} av ${months} mån har data för ${plan.label}`,
        );
      }
    }
  }
  return notes;
}

function footnoteFor(
  result: MetricResult,
  req: SlideRequest,
  def: MetricDefinition,
  ctx: ResolveContext,
  companyNotes: string[],
): string | null {
  const parts: string[] = [];
  if (result.status === "not_applicable") {
    const dims = result.notApplicable.map((k) => dimensionLabel(ctx, k)).join(", ");
    parts.push(`${dims} finns inte för ${def.name}`);
  } else if (result.status === "no_data") {
    parts.push(FOOTNOTE_NO_DATA);
  } else {
    const { withData, expected } = result.total.coverage;
    if (withData < expected) parts.push(`${withData} av ${expected} mån har data`);
  }
  parts.push(...companyNotes);
  if (req.company === "ALL" && def.unit === "kr") parts.push(FOOTNOTE_COMPANY_SUM);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function breakdownTable(
  result: MetricResult,
  def: MetricDefinition,
  compareKind: ComparisonKind | null,
  groupHeader: string,
  withTotal: boolean,
): TableData {
  const compareLabel = compareKind ? result.total.compare[compareKind]?.label : undefined;
  const columns = [groupHeader, capitalize(result.window.label)];
  if (compareKind && compareLabel !== undefined) {
    columns.push(capitalize(compareLabel), DELTA_COLUMN_LABEL);
  }
  const row = (label: string, cell: MetricResult["total"]) => {
    const values = [formatSlideValue(cell.value, def)];
    if (compareKind && compareLabel !== undefined) {
      const c = cell.compare[compareKind];
      values.push(formatSlideValue(c?.value ?? null, def), formatCellDelta(c, def.unit));
    }
    return { label, values };
  };
  const rows = result.groups.map((g) => row(g.label, g));
  if (withTotal) rows.push(row(TOTAL_ROW_LABEL, result.total));
  return { columns, rows };
}

async function resolveRequest(req: SlideRequest, ctx: ResolveContext): Promise<ResolvedSlide> {
  const def = lookupDefinition(ctx, req.metricKey);
  const compareKind = effectiveCompare(req.compare, req.grain);
  const breakdown = BREAKDOWN_VIZ.has(req.viz) && req.groupBy !== null;
  const monthlyBars = req.viz === "bar" && !breakdown;
  const wantsSeries = req.viz === "kpi" || req.viz === "line" || monthlyBars;
  const topN = req.viz === "toplist" ? (req.topN ?? DEFAULT_TOPLIST_N) : req.topN;

  const baseQuery: MetricQuery = {
    metricKeys: [def.key],
    period: { grain: req.grain, anchor: req.anchor },
    company: req.company,
    scenario: "utfall",
    groupBy: null,
    filters: req.filters,
    compare: [],
    series: null,
    topN: null,
  };
  const mainQuery: MetricQuery = {
    ...baseQuery,
    groupBy: breakdown ? req.groupBy : null,
    compare: compareKind ? [compareKind] : [],
    series: wantsSeries ? "last12" : null,
    topN: breakdown ? topN : null,
  };
  const seriesOnly = (anchor: Month, company: CompanyFilter): Promise<MetricResult> =>
    runMetricQuery(
      { ...baseQuery, period: { grain: "month", anchor }, company, series: "last12" },
      ctx.source,
    ).then((r) => r.results[0] as MetricResult);

  const stackCompanies = req.company === "ALL" ? COMPANY_CODES : [req.company as CompanyCode];
  const [main, previousYearSeries, companySeries, filterLabels] = await Promise.all([
    runMetricQuery(mainQuery, ctx.source).then((r) => r.results[0] as MetricResult),
    req.viz === "line" ? seriesOnly(addMonths(req.anchor, -12), req.company) : null,
    req.viz === "stacked_company"
      ? Promise.all(stackCompanies.map((c) => seriesOnly(req.anchor, c)))
      : null,
    Promise.all(req.filters.map((f) => ctx.source.labels(f.dimension, f.valueIds))),
  ]);

  const applicable = main.status !== "not_applicable";
  const companyNotes = await missingCompanyNotes(main, req, def, ctx, compareKind);
  const cell = compareKind ? main.total.compare[compareKind] : undefined;
  const number: ResolvedNumber = {
    value: main.total.value,
    formatted: formatSlideValue(main.total.value, def),
    unit: def.unit,
  };

  let chart: ChartData | null = null;
  let table: TableData | null = null;
  const groupHeader = req.groupBy ? dimensionLabel(ctx, req.groupBy) : "Mått";

  if (applicable) {
    if ((req.viz === "kpi" || req.viz === "line" || monthlyBars) && main.series) {
      const series: ChartSeries[] = [
        {
          key: def.key,
          label: def.name,
          role: "primary",
          values: main.series.map((p) => p.value),
        },
      ];
      if (req.viz === "line" && previousYearSeries?.series) {
        series.push({
          key: `${def.key}_previous_year`,
          label: PREVIOUS_YEAR_SERIES_LABEL,
          role: "previous",
          values: previousYearSeries.series.map((p) => p.value),
        });
      }
      chart = {
        categories: monthCategories(main.series),
        series,
        unit: def.unit,
        highlightIndex: main.series.length - 1,
      };
    } else if (req.viz === "stacked_company" && companySeries) {
      const first = companySeries[0]?.series ?? [];
      chart = {
        categories: monthCategories(first),
        series: companySeries.map((r, i) => ({
          key: stackCompanies[i] as string,
          label: ctx.companyLabels[stackCompanies[i] as CompanyCode],
          role: i === 0 ? "primary" : "secondary",
          values: (r.series ?? []).map((p) => p.value),
        })),
        unit: def.unit,
        highlightIndex: null,
      };
    } else if (BREAKDOWN_VIZ.has(req.viz)) {
      const groups = breakdown ? main.groups : [{ ...main.total, id: null, label: def.name }];
      if (req.viz !== "table") {
        const series: ChartSeries[] = [
          {
            key: def.key,
            label: capitalize(main.window.label),
            role: "primary",
            values: groups.map((g) => g.value),
          },
        ];
        if (req.viz === "bar" && compareKind && cell) {
          series.push({
            key: `${def.key}_${compareKind}`,
            label: capitalize(cell.label),
            role: compareKind === "budget" ? "secondary" : "previous",
            values: groups.map((g) => g.compare[compareKind]?.value ?? null),
          });
        }
        chart = {
          categories: groups.map((g) => g.label),
          series,
          unit: def.unit,
          highlightIndex: null,
        };
      }
      if (req.viz === "table" || req.viz === "toplist") {
        table = breakdownTable(
          breakdown ? main : { ...main, groups },
          def,
          compareKind,
          groupHeader,
          req.viz === "table" && breakdown,
        );
      }
    }
  }

  const suggestedHeadline = suggestHeadline({
    subject: headlineSubjectOf(def),
    filterLabels: req.filters.flatMap((f, i) =>
      f.valueIds.map((id) => ({
        dimension: f.dimension,
        label: filterLabels[i]?.[id] ?? String(id),
      })),
    ),
    companyLabel: req.company === "ALL" ? null : ctx.companyLabels[req.company],
    current: main.total.value,
    // ÖKAR/MINSKAR describe a change over time; against budget the headline states the value.
    compare: applicable && compareKind !== "budget" ? (cell ?? null) : null,
    unit: def.unit,
    decimals: def.decimals,
  });

  return {
    id: req.id,
    viz: req.viz,
    headline: req.headline?.trim() ? normalizeHeadline(req.headline) : suggestedHeadline,
    suggestedHeadline,
    metricName: def.name,
    periodLabel: main.window.label,
    companyLabel: ctx.companyLabels[req.company],
    number,
    delta: applicable ? resolveDelta(cell, def) : null,
    chart,
    table,
    footnote: footnoteFor(main, req, def, ctx, companyNotes),
    notes: req.notes,
    sourceUploadIds: [],
  };
}

/** Resolve one board slide at the context's anchor month. */
export async function resolveSlide(spec: SlideSpec, ctx: ResolveContext): Promise<ResolvedSlide> {
  const s = SlideSpecSchema.parse(spec);
  assertNoPersonalDimensions(s, ctx.personalDimensions);
  return resolveRequest({ ...s, anchor: ctx.anchor }, ctx);
}

/** Resolve every slide of a report template; refuses the whole report on personal data. */
export async function resolveReport(
  template: ReportTemplateSpec,
  ctx: ReportResolveContext,
): Promise<ResolvedReport> {
  const t = ReportTemplateSpecSchema.parse(template);
  for (const s of t.slides) assertNoPersonalDimensions(s, ctx.personalDimensions, "Rapporten");
  const slides = await Promise.all(t.slides.map((s) => resolveSlide(s, ctx)));
  return {
    schemaVersion: 1,
    title: ctx.title,
    anchorMonth: ctx.anchor,
    periodLabel: formatMonthLong(ctx.anchor),
    generatedAt: (ctx.now ?? new Date()).toISOString(),
    slides,
  };
}

/**
 * Resolve a dashboard widget under the global filters (company, grain, anchor). The
 * widget's own company wins over the global one; its title overrides the headline.
 */
export async function resolveWidget(
  spec: WidgetSpec,
  filters: GlobalFilters,
  ctx: WidgetResolveContext,
): Promise<ResolvedSlide> {
  const w = WidgetSpecSchema.parse(spec);
  const f = GlobalFiltersSchema.parse(filters);
  if (!ctx.allowPersonalDimensions) {
    assertNoPersonalDimensions(w, ctx.personalDimensions, "Widgeten");
  }
  return resolveRequest(
    {
      id: w.id,
      viz: w.viz,
      metricKey: w.metricKey,
      grain: f.grain,
      anchor: f.anchor ?? ctx.anchor,
      company: w.company ?? f.company,
      groupBy: w.groupBy,
      filters: w.filters,
      compare: "prev_period",
      topN: w.topN,
      headline: w.title,
      notes: "",
    },
    ctx,
  );
}
