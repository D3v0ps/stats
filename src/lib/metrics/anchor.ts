// Which month the dashboard and the board report show by default: the latest month that has
// ended and has published data for every key metric ("senaste kompletta månad").
import { addMonths, compareMonths, lastClosedMonth, type Month } from "../core/month";
import type { MetricDataSource } from "../contracts/metric-query";
import type { CompanyCode } from "../contracts/domain";

/** Metrics that must all have data for a month to count as complete (the board's top KPIs). */
export const KEY_METRICS = ["resultat", "aktiva_deltagare", "timmar"] as const;

/**
 * Pure selection: the latest month <= lastClosed where every required metric has data.
 * Falls back to the latest month any required metric has data, then to lastClosed itself.
 */
export function pickAnchorMonth(
  coverage: Record<string, string[]>,
  required: readonly string[],
  lastClosed: Month,
): { month: Month; complete: boolean } {
  const sets = required.map((key) => new Set(coverage[key] ?? []));
  const candidates = new Set<string>();
  for (const s of sets) for (const m of s) if (compareMonths(m, lastClosed) <= 0) candidates.add(m);
  const sorted = [...candidates].sort((a, b) => compareMonths(b, a));
  const complete = sorted.find((m) => sets.every((s) => s.has(m)));
  if (complete) return { month: complete, complete: true };
  if (sorted[0]) return { month: sorted[0], complete: false };
  return { month: lastClosed, complete: false };
}

/** Looks back 24 months from the last closed month (Europe/Stockholm) using source coverage. */
export async function defaultAnchorMonth(
  source: MetricDataSource,
  now: Date,
  companies: CompanyCode[] = ["MBAB", "MBR"],
  required: readonly string[] = KEY_METRICS,
): Promise<{ month: Month; complete: boolean }> {
  const lastClosed = lastClosedMonth(now);
  const coverage = await source.coverage([...required], {
    companies,
    scenario: "utfall",
    from: addMonths(lastClosed, -23),
    to: lastClosed,
    groupBy: [],
    filters: [],
  });
  return pickAnchorMonth(coverage, required, lastClosed);
}
