"use server";

// "Källa" popover: the uploads behind a number, fetched when the popover opens.
import { z } from "zod";
import { CompanyFilterSchema, MetricKeySchema, MonthSchema } from "@/lib/contracts/domain";
import { compareMonths, monthsBetween } from "@/lib/core/month";
import { definitionMap, leafMetricKeys } from "@/lib/dashboard/metrics-meta";
import { toSourceList, type SourceListItem } from "@/lib/dashboard/sources";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { getMetricSource } from "@/lib/db/metric-source";
import { listMetricSources } from "@/lib/db/repo/explore-extra";
import { requireSession } from "@/lib/db/session";
import { BUDGET_METRIC_KEY, companiesOf } from "@/lib/metrics";

const SourceQuerySchema = z
  .object({
    metricKeys: z.array(MetricKeySchema).min(1).max(20),
    company: CompanyFilterSchema,
    from: MonthSchema,
    to: MonthSchema,
  })
  .refine((q) => compareMonths(q.from, q.to) <= 0 && monthsBetween(q.from, q.to) < 120, {
    message: "Ogiltigt intervall",
  });

export type SourceQueryInput = z.input<typeof SourceQuerySchema>;

export type SourcesResult = { ok: true; items: SourceListItem[] } | { ok: false; message: string };

export async function getMetricSourcesAction(input: SourceQueryInput): Promise<SourcesResult> {
  await requireSession();
  const parsed = SourceQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ogiltig fråga." };
  const q = parsed.data;
  try {
    const source = await getMetricSource();
    const defs = definitionMap(await source.definitions());
    const leaves = new Set(q.metricKeys.flatMap((k) => leafMetricKeys(k, defs)));
    // Ledger numbers are compared with the budget file, so it is a source too.
    if ([...leaves].some((k) => defs.get(k)?.kind === "ledger") && defs.has(BUDGET_METRIC_KEY)) {
      leaves.add(BUDGET_METRIC_KEY);
    }
    const db = await createSupabaseServerClient();
    const rows = await listMetricSources(db, [...leaves], companiesOf(q.company), q.from, q.to);
    return { ok: true, items: toSourceList(rows) };
  } catch {
    return { ok: false, message: "Kunde inte hämta källorna just nu." };
  }
}
