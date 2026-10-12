// Dashboards are JSON specs (validated with zod), rendered by WidgetRenderer.
// Phase 1 ships a fixed default dashboard; phase 2 adds the builder + grid.
import { z } from "zod";
import {
  ComparisonKindSchema,
  CompanyFilterSchema,
  DimensionKeySchema,
  MetricKeySchema,
} from "./domain";
import { COMPANY_GROUP, DimFilterSchema } from "./metric-query";
import { VizKindSchema } from "./slides";

export const WidgetSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(80).nullable().default(null),
  viz: VizKindSchema,
  metricKey: MetricKeySchema,
  /** null = follow the global company filter. */
  company: CompanyFilterSchema.nullable().default(null),
  groupBy: z
    .union([DimensionKeySchema, z.literal(COMPANY_GROUP)])
    .nullable()
    .default(null),
  filters: z.array(DimFilterSchema).default([]),
  /** What the delta compares against; omitted = prev_period (YTD: prev_year), null = none. */
  compare: ComparisonKindSchema.nullable().optional(),
  topN: z.number().int().positive().nullable().default(null),
  /** Grid placement (12-column grid). */
  layout: z.object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(12),
  }),
});
export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

export const DashboardSpecSchema = z.object({
  name: z.string().min(1).max(120),
  widgets: z.array(WidgetSpecSchema),
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

/** Global filters, kept in the URL (?bolag=MBAB&period=ytd&manad=2026-09). */
export const GlobalFiltersSchema = z.object({
  company: CompanyFilterSchema.default("ALL"),
  grain: z.enum(["month", "quarter", "year", "ytd", "r12"]).default("month"),
  anchor: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable()
    .default(null),
});
export type GlobalFilters = z.infer<typeof GlobalFiltersSchema>;
