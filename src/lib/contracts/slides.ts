// Board report templates (what to show) and resolved reports (what was shown).
// The presentation deck, frozen reports, PDF print view and share page ALL render
// a ResolvedReport only, so they can never disagree.
import { z } from "zod";
import {
  ComparisonKindSchema,
  CompanyFilterSchema,
  DimensionKeySchema,
  MetricKeySchema,
  PeriodGrainSchema,
  type Unit,
} from "./domain";
import { COMPANY_GROUP, DimFilterSchema } from "./metric-query";

export const VizKindSchema = z.enum([
  "kpi",
  "line",
  "bar",
  "stacked_company",
  "donut",
  "table",
  "toplist",
]);
export type VizKind = z.infer<typeof VizKindSchema>;

export const VIZ_LABELS: Record<VizKind, string> = {
  kpi: "KPI-kort",
  line: "Linje",
  bar: "Stapel",
  stacked_company: "Staplad per bolag",
  donut: "Donut",
  table: "Tabell",
  toplist: "Topplista",
};

export const SlideSpecSchema = z.object({
  id: z.string().min(1),
  viz: VizKindSchema,
  metricKey: MetricKeySchema,
  /** Grain; the anchor month comes from the report (latest complete month by default). */
  grain: PeriodGrainSchema,
  company: CompanyFilterSchema,
  groupBy: z
    .union([DimensionKeySchema, z.literal(COMPANY_GROUP)])
    .nullable()
    .default(null),
  filters: z.array(DimFilterSchema).default([]),
  compare: ComparisonKindSchema.nullable().default("prev_period"),
  topN: z.number().int().positive().nullable().default(null),
  /** Override of the suggested headline. Uppercase is applied at render time. */
  headline: z.string().max(80).nullable().default(null),
  /** Speaker notes: only visible in the notes window, never on the slide. */
  notes: z.string().max(4000).default(""),
});
export type SlideSpec = z.infer<typeof SlideSpecSchema>;

export const ReportTemplateSpecSchema = z.object({
  name: z.string().min(1).max(120),
  slides: z.array(SlideSpecSchema),
});
export type ReportTemplateSpec = z.infer<typeof ReportTemplateSpecSchema>;

export type Direction = "up" | "down" | "flat";

export interface ResolvedNumber {
  value: number | null;
  /** Fully formatted with unit, e.g. "2,4 mkr". */
  formatted: string;
  unit: Unit;
}

export interface ResolvedDelta {
  direction: Direction;
  /** "+12 %", "−4 %", "+1,3 p.e." */
  formatted: string;
  /** true = good news, false = bad, null = neutral/unknown (no higherIsBetter). */
  favorable: boolean | null;
  /** "mot aug 2026" */
  againstLabel: string;
}

export type SeriesRole = "primary" | "secondary" | "previous" | "highlight";

export interface ChartSeries {
  key: string;
  label: string;
  role: SeriesRole;
  values: (number | null)[];
}

export interface ChartData {
  /** Category labels on the x-axis (months, customers, programs...). */
  categories: string[];
  /**
   * Aligned with categories: the group behind each category (dimension_values.id, or the
   * company code for "bolag"); null for months, "Övriga" and unassigned. Absent in reports
   * frozen before it existed.
   */
  categoryIds?: (number | string | null)[];
  series: ChartSeries[];
  unit: Unit;
  /** Index into categories to highlight in red (e.g. the current month), if any. */
  highlightIndex: number | null;
}

export interface TableData {
  columns: string[];
  /** id: the group behind the row like ChartData.categoryIds (null for totals, "Övriga"). */
  rows: { label: string; values: string[]; id?: number | string | null }[];
}

export interface ResolvedSlide {
  id: string;
  viz: VizKind;
  /** Final headline (override or suggestion), already uppercase, ends with "." */
  headline: string;
  suggestedHeadline: string;
  metricName: string;
  periodLabel: string;
  companyLabel: string;
  number: ResolvedNumber | null;
  delta: ResolvedDelta | null;
  chart: ChartData | null;
  table: TableData | null;
  /** e.g. "2 av 3 mån har data", "Summa bolag (ej eliminerat)". */
  footnote: string | null;
  notes: string;
  /** Upload ids behind the numbers (for the source popover). */
  sourceUploadIds: string[];
  /** ISO timestamp of the newest published upload behind the number (absent in old snapshots). */
  lastUpdatedAt?: string | null;
}

export interface ResolvedReport {
  schemaVersion: 1;
  title: string;
  anchorMonth: string;
  periodLabel: string;
  generatedAt: string;
  slides: ResolvedSlide[];
}
