// Builds the metric engine's ResolveContext for board output from catalog data, so the
// deck, the editor preview and the freeze action resolve reports the same way.
import {
  COMPANY_FILTER_LABELS,
  SEEDED_DIMENSIONS,
  type CompanyFilter,
} from "@/lib/contracts/domain";
import type { MetricDataSource, MetricDefinition } from "@/lib/contracts/metric-query";
import type { Month } from "@/lib/core/month";
import type { ReportResolveContext } from "@/lib/metrics";

/** What board output needs to know about a dimension. */
export interface ReportDimension {
  key: string;
  label: string;
  personal: boolean;
}

/** Dimensions flagged personal in the catalog plus the seeded personal ones (konsult). */
export function personalDimensionKeys(dimensions: readonly ReportDimension[]): Set<string> {
  const keys = new Set(dimensions.filter((d) => d.personal).map((d) => d.key));
  for (const [key, d] of Object.entries(SEEDED_DIMENSIONS)) if (d.personal) keys.add(key);
  return keys;
}

/** The seeded dimensions as ReportDimension[] (fallback when the catalog is unavailable). */
export function seededReportDimensions(): ReportDimension[] {
  return Object.entries(SEEDED_DIMENSIONS).map(([key, d]) => ({
    key,
    label: d.label,
    personal: d.personal,
  }));
}

export interface ReportContextInput {
  anchor: Month;
  title: string;
  source: MetricDataSource;
  definitions: readonly MetricDefinition[];
  dimensions: readonly ReportDimension[];
  companyLabels?: Readonly<Record<CompanyFilter, string>>;
  now?: Date;
}

export function buildReportContext(input: ReportContextInput): ReportResolveContext {
  return {
    anchor: input.anchor,
    title: input.title,
    source: input.source,
    definitionsByKey: new Map(input.definitions.map((d) => [d.key, d])),
    personalDimensions: personalDimensionKeys(input.dimensions),
    companyLabels: input.companyLabels ?? COMPANY_FILTER_LABELS,
    dimensionLabels: Object.fromEntries(input.dimensions.map((d) => [d.key, d.label])),
    now: input.now,
  };
}
