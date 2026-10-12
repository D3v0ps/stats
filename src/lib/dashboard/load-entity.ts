// The entity page (/utforska/[dimension]/[value]), e.g. the kundkort for Budbee Södertälje:
// every metric that supports the dimension, filtered to the value, with a 12-month trend, a
// breakdown by the next dimension and comparisons. Works for any dimension (verksamhet, ort,
// kostnadsställe, uppdrag, konsult). Pure orchestration over a MetricDataSource.
import type { UrlFilters } from "@/lib/app/filters";
import { COMPANY_FILTER_LABELS, DimensionKeySchema } from "@/lib/contracts/domain";
import {
  COMPANY_GROUP,
  type CompareCell,
  type DimFilter,
  type MetricDataSource,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/contracts/metric-query";
import type { ChartData } from "@/lib/contracts/slides";
import { addMonths } from "@/lib/core/month";
import { FOOTNOTE_COMPANY_SUM, runMetricQuery } from "@/lib/metrics";
import { buildCsv } from "./csv";
import { DRILL_CHAIN, entityBreakdown } from "./drill";
import { MONTH_GROUP, entityHref, exploreHref, toggleSort, type SortState } from "./explore-state";
import type { ExploreContext, ExploreRowLinks } from "./load-explore";
import type { SourceQuery } from "./load-dashboard";
import {
  definitionMap,
  dimensionLabelOf,
  metricArea,
  selectableMetrics,
  supportedDimensions,
  type DimensionMeta,
} from "./metrics-meta";
import {
  buildGroupPivot,
  capitalize,
  monthChart,
  pivotCsvRows,
  sortPivotRows,
  toPivotDelta,
  valueCell,
  type PivotDelta,
  type PivotModel,
  type PivotRow,
} from "./pivot";

/** Card order on entity pages: the kundkort figures first, then the rest in catalog order. */
export const ENTITY_METRIC_ORDER = [
  "konsulter",
  "timmar",
  "pass",
  "fakturerat_ip",
  "fakturerat_kund",
  "faktor",
  "sjukpass",
  "sjukpass_per_konsult",
  "sjukfranvaro",
  "timmar_per_konsult",
  "intakt_per_konsult",
  "aktiva_deltagare",
  "nya_deltagare",
  "resultatandel",
  "resultat_deltagare",
  "avslutade_deltagare",
  "avbrott_deltagare",
  "af_intakt",
  "resultat",
  "intakter",
  "kostnader",
  "personal",
] as const;

/** The trend chart shows the first of these the entity has data for. */
export const TREND_ORDER = [
  "timmar",
  "aktiva_deltagare",
  "resultat",
  "fakturerat_kund",
  "af_intakt",
];

/** Breakdown tables show at most this many metrics side by side. */
export const ENTITY_BREAKDOWN_METRICS = 5;

/** Whether the entity has any non-zero number for the metric in the window or the last 12 months. */
export function hasActivity(result: MetricResult): boolean {
  const nonZero = (v: number | null | undefined) => v !== null && v !== undefined && v !== 0;
  return (
    result.status === "ok" &&
    (nonZero(result.total.value) || (result.series ?? []).some((p) => nonZero(p.value)))
  );
}

export function orderEntityMetrics(defs: readonly MetricDefinition[]): MetricDefinition[] {
  const rank = (key: string) => {
    const i = (ENTITY_METRIC_ORDER as readonly string[]).indexOf(key);
    return i === -1 ? ENTITY_METRIC_ORDER.length : i;
  };
  return defs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.key) - rank(b.d.key) || a.i - b.i)
    .map(({ d }) => d);
}

export interface EntityKpi {
  key: string;
  name: string;
  unit: MetricDefinition["unit"];
  decimals: number | null;
  value: number | null;
  delta: PivotDelta | null;
  sparkline: (number | null)[] | null;
  footnote: string | null;
  lastUpdatedAt: string | null;
  href: string;
  status: MetricResult["status"];
}

export interface EntityBreakdown {
  dimension: string;
  label: string;
  options: { key: string; label: string; href: string; active: boolean; personal: boolean }[];
  pivot: PivotModel | null;
  sortedRows: PivotRow[];
  rowLinks: Record<string, ExploreRowLinks>;
  sortLinks: Record<string, string>;
  csv: string | null;
}

export interface EntityView {
  found: boolean;
  dimension: string;
  dimensionLabel: string;
  label: string;
  personal: boolean;
  kpis: EntityKpi[];
  trend: { title: string; chart: ChartData } | null;
  comparison: PivotModel | null;
  breakdown: EntityBreakdown | null;
  windowLabel: string;
  companyLabel: string;
  footnotes: string[];
  sourceQuery: SourceQuery;
  exploreHref: string;
}

export interface EntityInput {
  dimension: string;
  valueId: number;
  /** Breakdown from the URL (?grupp=), null = suggested next dimension. */
  breakdown: string | null;
  sort: SortState | null;
}

/** The route params of /utforska/[dimension]/[value], or null when they cannot name an entity. */
export function parseEntityParams(
  dimension: string,
  value: string,
): Pick<EntityInput, "dimension" | "valueId"> | null {
  if (!DimensionKeySchema.safeParse(dimension).success || !/^\d{1,15}$/.test(value)) return null;
  const valueId = Number(value);
  return valueId > 0 ? { dimension, valueId } : null;
}

/**
 * Whether the entity page has something to show: a dimension of the catalog and a value of
 * it. The page checks this before streaming, so an unknown entity answers with a real 404.
 */
export async function entityExists(
  input: Pick<EntityInput, "dimension" | "valueId">,
  ctx: { source: Pick<MetricDataSource, "labels">; dimensions: readonly DimensionMeta[] },
): Promise<boolean> {
  if (!ctx.dimensions.some((d) => d.key === input.dimension)) return false;
  const labels = await ctx.source.labels(input.dimension, [input.valueId]);
  return labels[input.valueId] !== undefined;
}

function comparisonPivot(defs: MetricDefinition[], results: MetricResult[]): PivotModel | null {
  const rows: PivotRow[] = [];
  const first = results.find((r) => r.status === "ok");
  if (!first) return null;
  const labelOf = (kind: "prev_period" | "prev_year") =>
    results.find((r) => r.total.compare[kind])?.total.compare[kind]?.label ?? null;
  const prevLabel = labelOf("prev_period");
  const yearLabel = labelOf("prev_year");
  results.forEach((r, i) => {
    const def = defs[i] as MetricDefinition;
    if (r.status !== "ok") return;
    const deltaCell = (cell: CompareCell | undefined) => {
      const delta = toPivotDelta(cell, def.unit, def.higherIsBetter);
      return { raw: null, text: delta?.formatted ?? "–", csv: "", delta };
    };
    rows.push({
      key: def.key,
      label: def.name,
      kind: "group",
      drill: null,
      entity: null,
      cells: {
        value: valueCell(r.total.value, def),
        prev: valueCell(r.total.compare.prev_period?.value ?? null, def),
        prev_delta: deltaCell(r.total.compare.prev_period),
        year: valueCell(r.total.compare.prev_year?.value ?? null, def),
        year_delta: deltaCell(r.total.compare.prev_year),
      },
    });
  });
  const columns: PivotModel["columns"] = [
    {
      key: "value",
      label: capitalize(first.window.label),
      title: first.window.label,
      csvLabel: first.window.label,
      metricKey: "",
      kind: "value",
    },
  ];
  if (prevLabel) {
    columns.push(
      {
        key: "prev",
        label: capitalize(prevLabel),
        title: prevLabel,
        csvLabel: prevLabel,
        metricKey: "",
        kind: "value",
      },
      {
        key: "prev_delta",
        label: "Förändring",
        title: `mot ${prevLabel}`,
        csvLabel: "Förändring",
        metricKey: "",
        kind: "delta",
      },
    );
  }
  if (yearLabel) {
    columns.push(
      {
        key: "year",
        label: capitalize(yearLabel),
        title: yearLabel,
        csvLabel: yearLabel,
        metricKey: "",
        kind: "value",
      },
      {
        key: "year_delta",
        label: "Förändring",
        title: `mot ${yearLabel}`,
        csvLabel: "Förändring",
        metricKey: "",
        kind: "delta",
      },
    );
  }
  return { groupLabel: "Mått", columns, rows, footer: [] };
}

export async function loadEntity(input: EntityInput, ctx: ExploreContext): Promise<EntityView> {
  const { dimension, valueId } = input;
  const company = ctx.filters.company;
  const metrics = orderEntityMetrics(
    selectableMetrics(ctx.definitions).filter((d) => d.dimensions.includes(dimension)),
  );
  const dimensionMeta: DimensionMeta | undefined = ctx.dimensions.find((d) => d.key === dimension);
  const dimensionLabel = dimensionLabelOf(dimension, ctx.dimensions);
  const filter: DimFilter = { dimension, valueIds: [valueId] };
  const drillPath = [{ dimension, valueId }];

  const [labels, main] = await Promise.all([
    ctx.source.labels(dimension, [valueId]),
    metrics.length === 0
      ? null
      : runMetricQuery(
          {
            metricKeys: metrics.map((m) => m.key),
            period: { grain: ctx.filters.grain, anchor: ctx.anchor },
            company,
            scenario: "utfall",
            groupBy: null,
            filters: [filter],
            compare: ["prev_period", "prev_year"],
            series: "last12",
            topN: null,
          },
          ctx.source,
        ),
  ]);
  const label = labels[valueId];
  // Utforska filtered to the value, broken down by what these metrics can show next (per
  // month when nothing is left); never by a dimension the metrics lack.
  const exploreLink = (defs: readonly MetricDefinition[], filters: UrlFilters = ctx.filters) =>
    exploreHref(
      {
        metrics: defs.map((m) => m.key),
        filters: drillPath,
        groupBy:
          entityBreakdown(dimension, supportedDimensions(defs)) ??
          (filters.company === "ALL" ? COMPANY_GROUP : MONTH_GROUP),
      },
      filters,
    );
  const base: EntityView = {
    found: label !== undefined,
    dimension,
    dimensionLabel,
    label: label ?? `${dimensionLabel} ${valueId}`,
    personal: dimensionMeta?.personal ?? dimension === "konsult",
    kpis: [],
    trend: null,
    comparison: null,
    breakdown: null,
    windowLabel: main?.results[0]?.window.label ?? "",
    companyLabel: COMPANY_FILTER_LABELS[company],
    footnotes: [],
    sourceQuery: {
      metricKeys: metrics.map((m) => m.key),
      company,
      from: addMonths(ctx.anchor, -11),
      to: ctx.anchor,
    },
    exploreHref: exploreLink(metrics.slice(0, 1)),
  };
  if (!main || label === undefined) return base;
  const results = main.results;

  // Areas the entity never appears in (a WB program has no hours) are left out, unless that
  // would leave nothing to show. Within an area every metric stays: a customer without sick
  // leave shows 0 sjukpass rather than no card.
  const active = results.map(hasActivity);
  const defsByKey = definitionMap(ctx.definitions);
  const areas = metrics.map((m) => metricArea(m, defsByKey));
  const activeAreas = new Set(areas.filter((_, i) => active[i]));
  const shown = activeAreas.size > 0 ? areas.map((a) => activeAreas.has(a)) : areas.map(() => true);
  const shownMetrics = metrics.filter((_, i) => shown[i]);
  // Breakdowns follow the metrics the page shows (an AF program has no customers).
  const supported = supportedDimensions(shownMetrics);
  const nextDefault = entityBreakdown(dimension, supported);
  const kpis: EntityKpi[] = results.flatMap((r, i) => {
    const def = metrics[i] as MetricDefinition;
    if (!shown[i]) return [];
    const cell = r.total.compare.prev_period ?? r.total.compare.prev_year;
    const { withData, expected } = r.total.coverage;
    return [
      {
        key: def.key,
        name: def.name,
        unit: def.unit,
        decimals: def.decimals,
        value: r.total.value,
        delta: r.status === "ok" ? toPivotDelta(cell, def.unit, def.higherIsBetter) : null,
        sparkline: r.series?.map((p) => p.value) ?? null,
        footnote:
          r.status === "ok" && withData < expected
            ? `${withData} av ${expected} mån har data`
            : null,
        lastUpdatedAt: r.lastUpdatedAt,
        href: exploreLink([def]),
        status: r.status,
      },
    ];
  });

  // Trend: the preferred metric with data, else the first metric with data.
  const activeIndex = (key: string) =>
    results.findIndex((r, i) => r.metricKey === key && active[i]);
  const trendIndex = [...TREND_ORDER.map(activeIndex), active.findIndex(Boolean)].find(
    (i) => i >= 0,
  );
  const trendDef = trendIndex === undefined ? undefined : metrics[trendIndex];

  const breakdownKeys = [
    COMPANY_GROUP,
    ...[...DRILL_CHAIN].filter((d) => d !== COMPANY_GROUP && supported.includes(d)),
    ...supported.filter((d) => !(DRILL_CHAIN as readonly string[]).includes(d)),
  ].filter((d) => d !== dimension && d !== "kontogrupp");
  const breakdownDim =
    input.breakdown && breakdownKeys.includes(input.breakdown)
      ? input.breakdown
      : ((nextDefault && breakdownKeys.includes(nextDefault) ? nextDefault : breakdownKeys[0]) ??
        null);
  const breakdownMetrics = breakdownDim
    ? shownMetrics
        .filter((m) => breakdownDim === COMPANY_GROUP || m.dimensions.includes(breakdownDim))
        .slice(0, ENTITY_BREAKDOWN_METRICS)
    : [];

  const [previousYear, breakdownResult] = await Promise.all([
    trendDef
      ? runMetricQuery(
          {
            metricKeys: [trendDef.key],
            period: { grain: "month", anchor: addMonths(ctx.anchor, -12) },
            company,
            scenario: "utfall",
            groupBy: null,
            filters: [filter],
            compare: [],
            series: "last12",
            topN: null,
          },
          ctx.source,
        )
      : null,
    breakdownDim && breakdownMetrics.length > 0
      ? runMetricQuery(
          {
            metricKeys: breakdownMetrics.map((m) => m.key),
            period: { grain: ctx.filters.grain, anchor: ctx.anchor },
            company,
            scenario: "utfall",
            groupBy: breakdownDim,
            filters: [filter],
            compare: ["prev_period"],
            series: null,
            topN: null,
          },
          ctx.source,
        )
      : null,
  ]);

  let trend: EntityView["trend"] = null;
  if (trendDef && trendIndex !== undefined) {
    const chart = monthChart(
      results[trendIndex] as MetricResult,
      trendDef,
      previousYear?.results[0]?.series ?? null,
    );
    if (chart) trend = { title: `${trendDef.name} per månad`, chart };
  }

  let breakdown: EntityBreakdown | null = null;
  if (breakdownDim) {
    const pageHref = (extra: { groupBy?: string; sort?: SortState | null }) =>
      entityHref(dimension, valueId, ctx.filters, {
        groupBy: extra.groupBy ?? breakdownDim,
        sort: extra.sort ?? null,
      });
    const groupLabel = dimensionLabelOf(breakdownDim, ctx.dimensions);
    const pivot = breakdownResult
      ? buildGroupPivot({
          defs: breakdownMetrics,
          results: breakdownResult.results,
          groupBy: breakdownDim,
          groupLabel,
        })
      : null;
    const sort =
      input.sort &&
      (input.sort.key === "label" || pivot?.columns.some((c) => c.key === input.sort?.key))
        ? input.sort
        : null;
    const sortedRows = pivot ? sortPivotRows(pivot.rows, sort) : [];
    const rowLinks: Record<string, ExploreRowLinks> = {};
    for (const row of pivot?.rows ?? []) {
      const drill =
        row.drill?.kind === "company"
          ? exploreLink(breakdownMetrics, {
              ...ctx.filters,
              company: row.drill.company as "MBAB" | "MBR",
            })
          : null;
      rowLinks[row.key] = {
        drill,
        entity: row.entity
          ? entityHref(row.entity.dimension, row.entity.valueId, ctx.filters)
          : null,
      };
    }
    const sortLinks: Record<string, string> = {};
    for (const key of ["label", ...(pivot?.columns.map((c) => c.key) ?? [])]) {
      sortLinks[key] = pageHref({ sort: toggleSort(sort, key) });
    }
    const csvParts = pivot ? pivotCsvRows(pivot, sortedRows) : null;
    breakdown = {
      dimension: breakdownDim,
      label: groupLabel,
      options: breakdownKeys.map((key) => ({
        key,
        label: dimensionLabelOf(key, ctx.dimensions),
        href: pageHref({ groupBy: key }),
        active: key === breakdownDim,
        personal: ctx.dimensions.find((d) => d.key === key)?.personal ?? key === "konsult",
      })),
      pivot,
      sortedRows,
      rowLinks,
      sortLinks,
      csv: csvParts ? buildCsv(csvParts.header, csvParts.rows) : null,
    };
  }

  const footnotes: string[] = [];
  if (company === "ALL" && metrics.some((m) => m.unit === "kr"))
    footnotes.push(FOOTNOTE_COMPANY_SUM);

  return {
    ...base,
    kpis,
    trend,
    comparison: comparisonPivot(
      shownMetrics,
      results.filter((_, i) => shown[i]),
    ),
    breakdown,
    footnotes,
    exploreHref: exploreLink(shownMetrics.slice(0, 1)),
  };
}
