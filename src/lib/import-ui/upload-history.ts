// Upload history (/ladda-upp/historik): status in plain words and the reason
// asked for when a publish is undone. Nothing is ever deleted.
import { z } from "zod";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts";
import { formatDateSv } from "@/lib/core/format-sv";
import { formatMonthSpan } from "./months";

export interface HistoryUpload {
  status: "staged" | "published" | "retracted" | "discarded";
  months: string[];
  currentMonths: string[];
}

export type HistoryStatus =
  "published" | "partly_replaced" | "replaced" | "retracted" | "staged" | "discarded";

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  published: "Publicerad",
  partly_replaced: "Delvis ersatt",
  replaced: "Ersatt",
  retracted: "Återkallad",
  staged: "Ej publicerad",
  discarded: "Avbruten",
};

/** Published uploads whose months were all taken over by a newer file are "Ersatt". */
export function historyStatus(u: HistoryUpload): HistoryStatus {
  switch (u.status) {
    case "published":
      if (u.months.length > 0 && u.currentMonths.length === 0) return "replaced";
      if (u.currentMonths.length < u.months.length) return "partly_replaced";
      return "published";
    case "retracted":
      return "retracted";
    case "staged":
      return "staged";
    case "discarded":
      return "discarded";
  }
}

/** Only published uploads can be undone (retracted ones stay in the list as they are). */
export function canRetract(u: Pick<HistoryUpload, "status">): boolean {
  return u.status === "published";
}

/** History shows what was published (also replaced and retracted), not abandoned stagings. */
export function isListed(u: Pick<HistoryUpload, "status">): boolean {
  return u.status === "published" || u.status === "retracted";
}

export const RetractInputSchema = z.object({
  uploadId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Skriv kort varför publiceringen ångras.")
    .max(500, "Förklaringen är för lång (högst 500 tecken)."),
});
export type RetractInput = z.infer<typeof RetractInputSchema>;

export interface HistorySource extends HistoryUpload {
  id: string;
  datasetKey: string;
  fileName: string;
  templateId: string | null;
  templateVersion: number | null;
  scenario: "utfall" | "budget";
  companies: ("MBAB" | "MBR")[];
  publishedAt: string | null;
  retractedAt: string | null;
  retractReason: string | null;
}

export interface HistoryRow {
  id: string;
  fileName: string;
  report: string;
  companies: string;
  months: string;
  status: HistoryStatus;
  statusLabel: string;
  publishedAt: string;
  retracted: string | null;
  canRetract: boolean;
}

/** View rows for the history table, newest publish first. */
export function historyRows(
  uploads: readonly HistorySource[],
  datasets: readonly { key: string; name: string }[],
  templates: readonly { id: string; name: string }[],
): HistoryRow[] {
  return uploads
    .filter(isListed)
    .map((u) => {
      const status = historyStatus(u);
      const template = u.templateId ? templates.find((t) => t.id === u.templateId) : undefined;
      const dataset = datasets.find((d) => d.key === u.datasetKey)?.name ?? u.datasetKey;
      const report = template
        ? `${template.name}${u.templateVersion && u.templateVersion > 1 ? ` (version ${u.templateVersion})` : ""}`
        : dataset;
      return {
        id: u.id,
        fileName: u.fileName,
        report: u.scenario === "budget" && !/budget/i.test(report) ? `${report} (budget)` : report,
        companies: u.companies.map((c) => COMPANY_FILTER_LABELS[c]).join(", "),
        months: formatMonthSpan(u.months),
        status,
        statusLabel: HISTORY_STATUS_LABELS[status],
        publishedAt: u.publishedAt ? formatDateSv(u.publishedAt) : "–",
        retracted:
          u.status === "retracted"
            ? [u.retractedAt ? formatDateSv(u.retractedAt) : null, u.retractReason]
                .filter(Boolean)
                .join(": ")
            : null,
        canRetract: canRetract(u),
      };
    })
    .sort((a, b) => {
      const pa = uploads.find((u) => u.id === a.id)?.publishedAt ?? "";
      const pb = uploads.find((u) => u.id === b.id)?.publishedAt ?? "";
      return pb.localeCompare(pa);
    });
}

/** "Föregående version är tillbaka för 2 månader." */
export function retractResultText(r: { restored: number; released: number }): string {
  if (r.restored === 0) {
    return r.released === 0
      ? "Publiceringen är ångrad."
      : "Publiceringen är ångrad. Det fanns ingen tidigare version, så månaderna saknar nu data.";
  }
  const months = r.restored === 1 ? "1 månad" : `${r.restored} månader`;
  return `Publiceringen är ångrad. Föregående version är tillbaka för ${months}.`;
}
