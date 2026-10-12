// The Utforska table: metric results -> rows (groups or months) × columns (value, Δ föregående
// period, Δ i fjol, budget, täckning), sortable, with a total row. Every cell carries the raw
// number (sorting), the display text (format-sv) and the CSV text (Swedish decimals).
import type { ComparisonKind, Unit } from "@/lib/contracts/domain";
import type {
  CompareCell,
  GroupCell,
  MetricDefinition,
  MetricResult,
  ValueCell,
} from "@/lib/contracts/metric-query";
import type { ChartData, ChartSeries } from "@/lib/contracts/slides";
import { formatValue } from "@/lib/core/format-sv";
import { formatMonthShort } from "@/lib/core/month";
import { TOTAL_ROW_LABEL, describeDelta, makeCompareCell } from "@/lib/metrics";
import { csvNumber } from "./csv";
import type { DrillRow } from "./drill";
import type { SortState } from "./explore-state";
import { BOOKED_REMAINDER_LABEL, type RemainderValues } from "./remainder";

/** Same shape as the brand <Delta> input (ResolvedDelta). */
export interface PivotDelta {
  direction: "up" | "down" | "flat";
  formatted: string;
  favorable: boolean | null;
  againstLabel: string;
}

export interface PivotCell {
  raw: number | null;
  text: string;
  csv: string;
  /** Change shown under the value (multi-metric mode) or as the cell itself (Δ columns). */
  delta?: PivotDelta | null;
}

export type PivotColumnKind = "value" | "delta" | "budget" | "coverage";

export interface PivotColumn {
  key: string;
  label: string;
  /** Longer description for the header tooltip/abbr, e.g. "mot aug 2026". */
  title: string;
  csvLabel: string;
  metricKey: string;
  kind: PivotColumnKind;
}

export type PivotRowKind = "group" | "remainder" | "total";

export interface PivotRow {
  key: string;
  label: string;
  kind: PivotRowKind;
  drill: DrillRow | null;
  /** Entity page target (kundkort etc.) for real dimension values. */
  entity: { dimension: string; valueId: number } | null;
  cells: Record<string, PivotCell>;
}

export interface PivotModel {
  groupLabel: string;
  columns: PivotColumn[];
  /** Sortable body rows. */
  rows: PivotRow[];
  /** Remainder and total rows, always last. */
  footer: PivotRow[];
}

const EMPTY_CELL: PivotCell = { raw: null, text: "–", csv: "" };

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
}

function valueText(value: number | null, def: MetricDefinition): string {
  return formatValue(value, def.unit, { decimals: def.decimals ?? undefined });
}

function csvDecimals(def: MetricDefinition): number {
  return def.decimals ?? (def.unit === "faktor" ? 2 : 0);
}

export function valueCell(value: number | null, def: MetricDefinition): PivotCell {
  return { raw: value, text: valueText(value, def), csv: csvNumber(value, csvDecimals(def)) };
}

/** Delta as the brand <Delta> shows it; favorable follows the metric's higherIsBetter. */
export function toPivotDelta(
  cell: CompareCell | undefined,
  unit: Unit,
  higherIsBetter: boolean | null,
): PivotDelta | null {
  if (!cell) return null;
  const described = describeDelta(cell, unit, { compact: true });
  if (!described) return null;
  const favorable =
    higherIsBetter === null || described.direction === "flat"
      ? null
      : (described.direction === "up") === higherIsBetter;
  return { ...described, favorable, againstLabel: `mot ${cell.label}` };
}

/** Raw change used for sorting/CSV: p.e. for percent metrics, else relative percent. */
function deltaRaw(cell: CompareCell | undefined, unit: Unit): number | null {
  if (!cell) return null;
  return unit === "pct" ? cell.deltaPp : cell.deltaPct;
}

function deltaCell(cell: CompareCell | undefined, def: MetricDefinition): PivotCell {
  const delta = toPivotDelta(cell, def.unit, def.higherIsBetter);
  const raw = deltaRaw(cell, def.unit);
  return { raw, text: delta?.formatted ?? "–", csv: csvNumber(raw, 1), delta };
}

function coverageCell(cell: ValueCell): PivotCell {
  const { withData, expected } = cell.coverage;
  return {
    raw: expected === 0 ? null : withData / expected,
    text: `${withData}/${expected} mån`,
    // "1/3" would turn into a date in Excel.
    csv: `${withData} av ${expected}`,
  };
}

const COMPARE_LABELS: Record<Exclude<ComparisonKind, "budget">, string> = {
  prev_period: "Δ föreg. period",
  prev_year: "Δ i fjol",
};

export interface PivotInput {
  defs: MetricDefinition[];
  results: MetricResult[];
  groupBy: string;
  groupLabel: string;
  /** Booked revenue remainder for fakturerat_kund per kund (see remainder.ts). */
  remainder?: { metricKey: string; values: RemainderValues } | null;
  /** Month mode, single metric: the same 12 months a year earlier. */
  previousYearSeries?: { month: string; value: number | null }[] | null;
}

function hasBudget(result: MetricResult): boolean {
  const b = result.total.compare.budget;
  return b !== undefined && b.value !== null;
}

/** Columns for one metric; `single` adds Δ, budget and coverage columns. */
function metricColumns(
  def: MetricDefinition,
  result: MetricResult,
  index: number,
  single: boolean,
  monthMode: boolean,
): PivotColumn[] {
  const id = `m${index}`;
  const unitSuffix = def.unit === "pct" ? "p.e." : "%";
  if (!single) {
    return [
      {
        key: id,
        label: def.name,
        title: `${def.name}, ${result.window.label}`,
        csvLabel: def.name,
        metricKey: def.key,
        kind: "value",
      },
    ];
  }
  const cols: PivotColumn[] = [
    {
      key: id,
      label: monthMode ? def.name : capitalize(result.window.label),
      title: `${def.name}, ${result.window.label}`,
      csvLabel: monthMode ? def.name : `${def.name} ${result.window.label}`,
      metricKey: def.key,
      kind: "value",
    },
  ];
  if (monthMode) {
    cols.push(
      {
        key: `${id}:prev_year_value`,
        label: "Föregående år",
        title: "Samma månad året innan",
        csvLabel: `${def.name} föregående år`,
        metricKey: def.key,
        kind: "value",
      },
      {
        key: `${id}:prev_year`,
        label: COMPARE_LABELS.prev_year,
        title: "Förändring mot samma månad året innan",
        csvLabel: `Förändring mot föregående år (${unitSuffix})`,
        metricKey: def.key,
        kind: "delta",
      },
    );
    return cols;
  }
  for (const kind of ["prev_period", "prev_year"] as const) {
    const cell = result.total.compare[kind];
    if (!cell) continue;
    cols.push({
      key: `${id}:${kind}`,
      label: COMPARE_LABELS[kind],
      title: `Förändring mot ${cell.label}`,
      csvLabel: `Förändring mot ${cell.label} (${unitSuffix})`,
      metricKey: def.key,
      kind: "delta",
    });
  }
  if (hasBudget(result)) {
    cols.push(
      {
        key: `${id}:budget_value`,
        label: "Budget",
        title: `Budget för ${result.window.label}`,
        csvLabel: "Budget",
        metricKey: def.key,
        kind: "budget",
      },
      {
        key: `${id}:budget`,
        label: "Δ budget",
        title: "Förändring mot budget",
        csvLabel: `Förändring mot budget (${unitSuffix})`,
        metricKey: def.key,
        kind: "delta",
      },
    );
  }
  cols.push({
    key: `${id}:coverage`,
    label: "Täckning",
    title: "Månader med publicerad data i perioden",
    csvLabel: "Månader med data",
    metricKey: def.key,
    kind: "coverage",
  });
  return cols;
}

function cellsFor(
  cell: ValueCell | null,
  def: MetricDefinition,
  index: number,
  single: boolean,
): Record<string, PivotCell> {
  const id = `m${index}`;
  if (!cell) return {};
  if (!single) {
    return {
      [id]: {
        ...valueCell(cell.value, def),
        delta: toPivotDelta(
          cell.compare.prev_period ?? cell.compare.prev_year,
          def.unit,
          def.higherIsBetter,
        ),
      },
    };
  }
  return {
    [id]: valueCell(cell.value, def),
    [`${id}:prev_period`]: deltaCell(cell.compare.prev_period, def),
    [`${id}:prev_year`]: deltaCell(cell.compare.prev_year, def),
    [`${id}:budget_value`]: valueCell(cell.compare.budget?.value ?? null, def),
    [`${id}:budget`]: deltaCell(cell.compare.budget, def),
    [`${id}:coverage`]: coverageCell(cell),
  };
}

const groupKeyOf = (id: GroupCell["id"]) => JSON.stringify(id);

function drillFor(groupBy: string, id: GroupCell["id"]): Pick<PivotRow, "drill" | "entity"> {
  if (id === null) return { drill: null, entity: null };
  if (groupBy === "bolag") {
    return typeof id === "string"
      ? { drill: { kind: "company", company: id }, entity: null }
      : { drill: null, entity: null };
  }
  if (typeof id !== "number") return { drill: null, entity: null };
  return {
    drill: { kind: "value", dimension: groupBy, valueId: id },
    entity: { dimension: groupBy, valueId: id },
  };
}

/** Breakdown table (rows = groups) for one or several metrics. */
export function buildGroupPivot(input: PivotInput): PivotModel {
  const { defs, results, groupBy, groupLabel } = input;
  const single = results.length === 1;
  const columns = results.flatMap((r, i) =>
    metricColumns(defs[i] as MetricDefinition, r, i, single, false),
  );

  // Union of groups, in the primary metric's order, then the others' new groups.
  const order: string[] = [];
  const labels = new Map<string, { id: GroupCell["id"]; label: string }>();
  for (const r of results) {
    for (const g of r.groups) {
      const k = groupKeyOf(g.id);
      if (!labels.has(k)) {
        labels.set(k, { id: g.id, label: g.label });
        order.push(k);
      }
    }
  }
  const byMetric = results.map((r) => new Map(r.groups.map((g) => [groupKeyOf(g.id), g])));

  const rows: PivotRow[] = order.map((k) => {
    const meta = labels.get(k) as { id: GroupCell["id"]; label: string };
    const cells: Record<string, PivotCell> = {};
    results.forEach((r, i) => {
      const def = defs[i] as MetricDefinition;
      if (r.status === "not_applicable") return;
      Object.assign(cells, cellsFor(byMetric[i]?.get(k) ?? null, def, i, single));
    });
    return { key: k, label: meta.label, kind: "group", ...drillFor(groupBy, meta.id), cells };
  });

  const footer: PivotRow[] = [];
  const remainder = input.remainder;
  const remainderIndex = remainder
    ? results.findIndex((r) => r.metricKey === remainder.metricKey)
    : -1;
  if (remainder && remainderIndex >= 0 && remainder.values.value !== null) {
    const def = defs[remainderIndex] as MetricDefinition;
    const v = remainder.values;
    const cell: ValueCell = {
      value: v.value,
      coverage: (results[remainderIndex] as MetricResult).total.coverage,
      compare: Object.fromEntries(
        Object.entries(v.compare).map(([kind, c]) => [
          kind,
          makeCompareCell(
            v.value,
            c.value,
            def.unit,
            (results[remainderIndex] as MetricResult).total.compare[kind as ComparisonKind]
              ?.label ?? "",
          ),
        ]),
      ),
    };
    // A change in the remainder is neither good nor bad news: deltas stay neutral.
    const cells = Object.fromEntries(
      Object.entries(cellsFor(cell, def, remainderIndex, single)).map(([k, c]) => [
        k,
        c.delta ? { ...c, delta: { ...c.delta, favorable: null } } : c,
      ]),
    );
    footer.push({
      key: "__remainder",
      label: BOOKED_REMAINDER_LABEL,
      kind: "remainder",
      drill: null,
      entity: null,
      cells,
    });
  }

  const totalCells: Record<string, PivotCell> = {};
  results.forEach((r, i) => {
    const def = defs[i] as MetricDefinition;
    if (r.status === "not_applicable") return;
    let cell: ValueCell = r.total;
    if (i === remainderIndex && remainder && remainder.values.booked !== null) {
      const v = remainder.values;
      cell = {
        ...r.total,
        value: v.booked,
        compare: {
          ...Object.fromEntries(
            Object.entries(v.compare).map(([kind, c]) => [
              kind,
              makeCompareCell(
                v.booked,
                c.booked,
                def.unit,
                r.total.compare[kind as ComparisonKind]?.label ?? "",
              ),
            ]),
          ),
          ...(r.total.compare.budget ? { budget: r.total.compare.budget } : {}),
        },
      };
    }
    Object.assign(totalCells, cellsFor(cell, def, i, single));
  });
  footer.push({
    key: "__total",
    label: TOTAL_ROW_LABEL,
    kind: "total",
    drill: null,
    entity: null,
    cells: totalCells,
  });

  return { groupLabel, columns, rows, footer };
}

/** Per-month table (rows = the series months, newest first) for one or several metrics. */
export function buildMonthPivot(input: PivotInput): PivotModel {
  const { defs, results } = input;
  const single = results.length === 1;
  const columns = results.flatMap((r, i) =>
    metricColumns(defs[i] as MetricDefinition, r, i, single, true),
  );
  const months = [...(results[0]?.series ?? [])].map((p) => p.month);
  const previous = new Map((input.previousYearSeries ?? []).map((p, i) => [i, p.value]));

  const rows: PivotRow[] = months
    .map((month, mi) => {
      const cells: Record<string, PivotCell> = {};
      results.forEach((r, i) => {
        const def = defs[i] as MetricDefinition;
        if (r.status === "not_applicable" || !r.series) return;
        const value = r.series.find((p) => p.month === month)?.value ?? null;
        cells[`m${i}`] = valueCell(value, def);
        if (single) {
          const prev = previous.get(mi) ?? null;
          const cmp = makeCompareCell(value, prev, def.unit, "samma månad i fjol");
          cells[`m${i}:prev_year_value`] = valueCell(prev, def);
          cells[`m${i}:prev_year`] = deltaCell(cmp, def);
        }
      });
      return {
        key: month,
        label: formatMonthShort(month),
        kind: "group" as const,
        drill: { kind: "month" as const, month },
        entity: null,
        cells,
      };
    })
    .reverse();

  return { groupLabel: "Månad", columns, rows, footer: [] };
}

/** Sort body rows; missing values always last, ties by label. */
export function sortPivotRows(rows: readonly PivotRow[], sort: SortState | null): PivotRow[] {
  if (!sort) return [...rows];
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "label") return a.label.localeCompare(b.label, "sv") * factor;
    const av = a.cells[sort.key]?.raw ?? null;
    const bv = b.cells[sort.key]?.raw ?? null;
    if (av === null && bv === null) return a.label.localeCompare(b.label, "sv");
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * factor || a.label.localeCompare(b.label, "sv");
  });
}

/** Header + rows for CSV export (label column first; footer rows last). */
export function pivotCsvRows(
  model: PivotModel,
  rows: readonly PivotRow[],
): {
  header: string[];
  rows: string[][];
} {
  const header = [model.groupLabel, ...model.columns.map((c) => c.csvLabel)];
  const body = [...rows, ...model.footer].map((r) => [
    r.label,
    ...model.columns.map((c) => (r.cells[c.key] ?? EMPTY_CELL).csv),
  ]);
  return { header, rows: body };
}

export function cellOf(row: PivotRow, key: string): PivotCell {
  return row.cells[key] ?? EMPTY_CELL;
}

/** Chart categories are capped so labels stay legible; the table shows everything. */
export const MAX_CHART_CATEGORIES = 12;

/** Horizontal bars per group for the primary metric, against the previous period. */
export function breakdownChart(result: MetricResult, def: MetricDefinition): ChartData | null {
  if (result.status !== "ok") return null;
  const groups = result.groups.filter((g) => g.value !== null).slice(0, MAX_CHART_CATEGORIES);
  if (groups.length === 0) return null;
  const series: ChartSeries[] = [
    {
      key: def.key,
      label: capitalize(result.window.label),
      role: "primary",
      values: groups.map((g) => g.value),
    },
  ];
  const prev = result.total.compare.prev_period ?? result.total.compare.prev_year;
  const prevKind = result.total.compare.prev_period ? "prev_period" : "prev_year";
  if (prev) {
    const values = groups.map((g) => g.compare[prevKind]?.value ?? null);
    if (values.some((v) => v !== null)) {
      series.push({
        key: `${def.key}_${prevKind}`,
        label: capitalize(prev.label),
        role: "previous",
        values,
      });
    }
  }
  return { categories: groups.map((g) => g.label), series, unit: def.unit, highlightIndex: null };
}

/** Monthly line for the primary metric against the same months a year earlier. */
export function monthChart(
  result: MetricResult,
  def: MetricDefinition,
  previousYear: { month: string; value: number | null }[] | null,
): ChartData | null {
  if (result.status !== "ok" || !result.series || result.series.every((p) => p.value === null)) {
    return null;
  }
  const series: ChartSeries[] = [
    { key: def.key, label: def.name, role: "primary", values: result.series.map((p) => p.value) },
  ];
  if (previousYear && previousYear.some((p) => p.value !== null)) {
    series.push({
      key: `${def.key}_previous_year`,
      label: "Föregående år",
      role: "previous",
      values: previousYear.map((p) => p.value),
    });
  }
  return {
    categories: result.series.map((p) => formatMonthShort(p.month)),
    series,
    unit: def.unit,
    highlightIndex: result.series.length - 1,
  };
}
