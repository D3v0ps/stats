// Reads for the dashboard and Utforska that the metric engine does not need: the uploads behind
// a number ("Källa" popover) via metric_sources.
import type { CompanyCode } from "@/lib/contracts/domain";
import { dateToMonth, monthToDate, type Month } from "@/lib/core/month";
import type { SourceUpload } from "@/lib/dashboard/sources";
import { fetchAll, type DbClient } from "./shared";

/**
 * Current published uploads covering any of the (non-formula) metric keys for the companies
 * within [from, to], newest first. Formula metrics have no dataset: pass their operands.
 */
export async function listMetricSources(
  db: DbClient,
  metricKeys: readonly string[],
  companies: readonly CompanyCode[],
  from: Month,
  to: Month,
): Promise<SourceUpload[]> {
  if (metricKeys.length === 0 || companies.length === 0) return [];
  const rows = await fetchAll("metric_sources", (start, end) =>
    db
      .rpc("metric_sources", {
        p_metric_keys: [...metricKeys],
        p_company_codes: [...companies],
        p_from: monthToDate(from),
        p_to: monthToDate(to),
      })
      .range(start, end),
  );
  return rows.map((r) => ({
    uploadId: r.upload_id,
    fileName: r.file_name,
    datasetKey: r.dataset_key,
    templateName: r.template_name,
    templateVersion: r.template_version,
    publishedAt: r.published_at,
    months: (r.months ?? []).map(dateToMonth),
  }));
}
