import "server-only";

// Per-request data every workspace page needs: the metric source (RLS via the user's session),
// metric definitions, dimensions, the default anchor month and the anchor hint for the filter bar.
import { cache } from "react";
import type { UrlFilters } from "@/lib/app/filters";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { lastClosedMonth, type Month } from "@/lib/core/month";
import { SEEDED_DIMENSION_META, type DimensionMeta } from "@/lib/dashboard/metrics-meta";
import {
  anchorHint,
  effectiveAnchor,
  hintCoverageRange,
  monthOptions,
  type AnchorHint,
  type MonthOption,
} from "@/lib/dashboard/period";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { getMetricSource } from "@/lib/db/metric-source";
import { listDimensions } from "@/lib/db/repo/catalog";
import type { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import { KEY_METRICS, defaultAnchorMonth } from "@/lib/metrics/anchor";

export interface Workspace {
  source: SupabaseMetricDataSource;
  definitions: MetricDefinition[];
  dimensions: DimensionMeta[];
  lastClosed: Month;
  defaultAnchor: { month: Month; complete: boolean };
}

/** Deduplicated per request (layout-free pages call it once, nested components reuse it). */
export const loadWorkspace = cache(async (): Promise<Workspace> => {
  const now = new Date();
  const [source, db] = await Promise.all([getMetricSource(), createSupabaseServerClient()]);
  const [definitions, dimensions, defaultAnchor] = await Promise.all([
    source.definitions(),
    listDimensions(db).then((rows) =>
      rows.length > 0
        ? rows.map((d) => ({ key: d.key, label: d.label, personal: d.personal }))
        : SEEDED_DIMENSION_META,
    ),
    defaultAnchorMonth(source, now),
  ]);
  return { source, definitions, dimensions, lastClosed: lastClosedMonth(now), defaultAnchor };
});

export interface FilterBarData {
  anchor: Month;
  months: MonthOption[];
  hint: AnchorHint;
}

/** The anchor the page shows plus what the filter bar needs to describe it. */
export async function loadFilterBarData(
  ws: Workspace,
  filters: UrlFilters,
): Promise<FilterBarData> {
  const anchor = effectiveAnchor(filters, ws.defaultAnchor.month);
  const coverage = await ws.source.coverage([...KEY_METRICS], {
    companies: filters.company === "ALL" ? ["MBAB", "MBR"] : [filters.company],
    scenario: "utfall",
    ...hintCoverageRange(anchor, ws.lastClosed),
    groupBy: [],
    filters: [],
  });
  return {
    anchor,
    months: monthOptions(ws.lastClosed, anchor),
    hint: anchorHint({
      anchor,
      defaultAnchor: ws.defaultAnchor,
      coverage,
      metricNames: Object.fromEntries(ws.definitions.map((d) => [d.key, d.name])),
    }),
  };
}
