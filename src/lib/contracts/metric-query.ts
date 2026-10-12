// The metric engine's input/output and the data-source interface it reads through.
// The engine (src/lib/metrics) is pure TS over MetricDataSource; the Supabase
// adapter (src/lib/db/repo/metrics.ts) implements MetricDataSource with SQL RPCs.
// Tests use an in-memory MetricDataSource.
import { z } from "zod";
import {
  ComparisonKindSchema,
  CompanyFilterSchema,
  DimensionKeySchema,
  MetricKeySchema,
  PeriodSelectionSchema,
  ScenarioSchema,
  type CompanyCode,
  type ComparisonKind,
  type MetricKind,
  type Scenario,
  type SnapshotRollup,
  type Unit,
} from "./domain";

export interface MetricDefinition {
  key: string;
  name: string;
  unit: Unit;
  kind: MetricKind;
  /** Dataset the metric's facts come from (null for formula metrics). */
  datasetKey: string | null;
  higherIsBetter: boolean | null;
  decimals: number | null;
  description?: string | null;
  snapshotRollup?: SnapshotRollup | null;
  /** distinct: facts of this metric (value > 0) are counted. */
  baseMetricKey?: string | null;
  /** distinct: dimension whose distinct values are counted. */
  distinctDimension?: string | null;
  /** ledger: account group key (see AccountGroup). */
  accountGroupKey?: string | null;
  /** formula: e.g. "fakturerat / lonekostnad", "sjuktimmar / (timmar + sjuktimmar) * 100". */
  formula?: string | null;
  /** Dimension keys available for grouping/filtering (from the dataset). Formula: intersection of operands. */
  dimensions: string[];
}

export interface AccountGroup {
  key: string;
  name: string;
  /** Multiplier applied to raw SIE amounts (revenue -1 so it shows positive). */
  sign: 1 | -1;
  ranges: { from: number; to: number }[];
}

export const DimFilterSchema = z.object({
  dimension: DimensionKeySchema,
  valueIds: z.array(z.number().int().positive()).min(1),
});
export type DimFilter = z.infer<typeof DimFilterSchema>;

/** "bolag" is a pseudo-dimension: group by company. */
export const COMPANY_GROUP = "bolag";

export const MetricQuerySchema = z.object({
  metricKeys: z.array(MetricKeySchema).min(1),
  period: PeriodSelectionSchema,
  company: CompanyFilterSchema,
  scenario: ScenarioSchema.default("utfall"),
  /** One dimension key (or "bolag") to break the totals down by. */
  groupBy: z
    .union([DimensionKeySchema, z.literal(COMPANY_GROUP)])
    .nullable()
    .default(null),
  filters: z.array(DimFilterSchema).default([]),
  compare: z.array(ComparisonKindSchema).default([]),
  /** Include a monthly series: the window's months, or the 12 months ending at the anchor. */
  series: z.enum(["window", "last12"]).nullable().default(null),
  /** Limit groups (top N by value); the rest is summed into an "Övriga" row when applicable. */
  topN: z.number().int().positive().nullable().default(null),
});
export type MetricQuery = z.infer<typeof MetricQuerySchema>;

export interface Coverage {
  /** Months in the window that have published data for this metric. */
  withData: number;
  expected: number;
}

export interface CompareCell {
  value: number | null;
  /** value(current) − value(compare). */
  delta: number | null;
  /** Relative change in percent (12 = +12 %). null when the base is 0/null. */
  deltaPct: number | null;
  /** For pct units: change in percentage points. */
  deltaPp: number | null;
  /** Window label of the comparison, e.g. "aug 2026", "kv 3 2025", "budget". */
  label: string;
}

export interface ValueCell {
  value: number | null;
  coverage: Coverage;
  compare: Partial<Record<ComparisonKind, CompareCell>>;
}

export interface GroupCell extends ValueCell {
  /** dimension_values.id, or company code for "bolag", or null for "Övriga"/unassigned. */
  id: number | string | null;
  label: string;
}

export interface MetricResult {
  metricKey: string;
  name: string;
  unit: Unit;
  kind: MetricKind;
  higherIsBetter: boolean | null;
  /** ok | no_data (nothing published in window) | not_applicable (a filter/group dim is not in the dataset). */
  status: "ok" | "no_data" | "not_applicable";
  notApplicable: string[];
  window: { from: string; to: string; label: string };
  total: ValueCell;
  groups: GroupCell[];
  series: { month: string; value: number | null }[] | null;
  /** ISO timestamp of the newest published upload behind the number. */
  lastUpdatedAt: string | null;
}

export interface MetricQueryResult {
  query: MetricQuery;
  results: MetricResult[];
}

// ---- Data source -----------------------------------------------------------

export interface SourceScope {
  companies: CompanyCode[];
  scenario: Scenario;
  from: string;
  to: string;
  /** Dimension keys (or "bolag") to group by; [] = totals only. */
  groupBy: string[];
  filters: DimFilter[];
}

/** Monthly sums of sum/snapshot facts. One row per metric x month x group. */
export interface MonthlyRow {
  metricKey: string;
  month: string;
  /** groupBy key -> dimension_values.id (or company code for "bolag"); null = fact lacks that dim. */
  group: Record<string, number | string | null>;
  value: number;
}

/** Distinct counts over the whole scope window. */
export interface DistinctRow {
  group: Record<string, number | string | null>;
  count: number;
}

/** Monthly ledger sums per account group (already multiplied by the group's sign). */
export interface LedgerMonthlyRow {
  accountGroupKey: string;
  month: string;
  group: Record<string, number | string | null>;
  value: number;
}

export interface MetricDataSource {
  definitions(): Promise<MetricDefinition[]>;
  accountGroups(): Promise<AccountGroup[]>;
  monthly(metricKeys: string[], scope: SourceScope): Promise<MonthlyRow[]>;
  /** Per-month distinct counts when perMonth is true (for series), else over the whole window. */
  distinct(
    baseMetricKey: string,
    distinctDimension: string,
    scope: SourceScope,
    perMonth: boolean,
  ): Promise<(DistinctRow & { month: string | null })[]>;
  ledger(accountGroupKeys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]>;
  /** Months that have published data, per metric key, within [from, to] for the companies. */
  coverage(metricKeys: string[], scope: SourceScope): Promise<Record<string, string[]>>;
  labels(dimension: string, ids: number[]): Promise<Record<number, string>>;
  lastUpdated(metricKeys: string[], scope: SourceScope): Promise<Record<string, string | null>>;
  fiscalStartMonth(): Promise<number>;
}
