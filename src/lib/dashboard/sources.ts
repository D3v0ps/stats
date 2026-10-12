// "Källa" popover: which published uploads stand behind a number (metric_sources RPC), shown
// as fil, rapport, mallversion, publicerad and months.
import { SEEDED_DATASETS } from "@/lib/contracts/domain";
import { formatDateSv } from "@/lib/core/format-sv";
import { MONTH_ABBR_SV, compareMonths, monthIndex, parseMonth, type Month } from "@/lib/core/month";

export interface SourceUpload {
  uploadId: string;
  fileName: string;
  datasetKey: string;
  templateName: string | null;
  templateVersion: number | null;
  publishedAt: string;
  months: Month[];
}

export interface SourceListItem {
  uploadId: string;
  file: string;
  report: string;
  template: string;
  published: string;
  months: string;
}

/** "jan–mar 2026, maj 2026, nov 2025–feb 2026": consecutive months collapse into ranges. */
export function summarizeMonths(months: readonly Month[]): string {
  const sorted = [...new Set(months)].sort(compareMonths);
  const runs: [Month, Month][] = [];
  for (const m of sorted) {
    const last = runs.at(-1);
    if (last && monthIndex(m) === monthIndex(last[1]) + 1) last[1] = m;
    else runs.push([m, m]);
  }
  return runs
    .map(([from, to]) => {
      const a = parseMonth(from);
      const b = parseMonth(to);
      const abbr = (n: number) => MONTH_ABBR_SV[n - 1];
      if (from === to) return `${abbr(a.month)} ${a.year}`;
      if (a.year === b.year) return `${abbr(a.month)}–${abbr(b.month)} ${b.year}`;
      return `${abbr(a.month)} ${a.year}–${abbr(b.month)} ${b.year}`;
    })
    .join(", ");
}

export function datasetName(key: string): string {
  return (SEEDED_DATASETS as Record<string, string>)[key] ?? key;
}

/** Newest first (the RPC already orders so; kept stable here for other callers). */
export function toSourceList(rows: readonly SourceUpload[]): SourceListItem[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((r) => ({
      uploadId: r.uploadId,
      file: r.fileName,
      report: datasetName(r.datasetKey),
      template:
        r.templateName === null
          ? "Ingen mall"
          : `${r.templateName}${r.templateVersion !== null ? ` v${r.templateVersion}` : ""}`,
      published: formatDateSv(r.publishedAt),
      months: summarizeMonths(r.months),
    }));
}
