// Month handling around review: months that have not ended yet, months after a
// file's export date, the export date suggestion for cases files, and the
// month list offered in the period chip.
import type { CompanyCode, IngestResult } from "@/lib/contracts";
import { parseDateSv } from "@/lib/core/dates-sv";
import { sha256Hex } from "@/lib/core/hash";
import { addMonths, currentMonth, dateToMonth, formatMonthShort, isMonth } from "@/lib/core/month";
import { factsContentHash } from "@/lib/ingest/run";
import { canonicalLedger } from "@/lib/sie/index";

const COMPANY_ORDER: CompanyCode[] = ["MBAB", "MBR"];

/** Today's date in Europe/Stockholm as YYYY-MM-DD. */
export function todayInStockholm(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Months covered by a result, sorted and unique. */
export function resultMonths(result: Pick<IngestResult, "slices">): string[] {
  return [...new Set(result.slices.map((s) => s.month))].sort();
}

/**
 * Months that have not ended yet in Europe/Stockholm (the current month and
 * later). They are left out of a publish by default: their numbers are partial
 * and would replace complete data until the next export.
 */
export function openMonths(result: Pick<IngestResult, "slices">, now: Date): string[] {
  const current = currentMonth(now);
  return resultMonths(result).filter((m) => m >= current);
}

/** Months after the month of the file's export date (#GEN / chosen export date). */
export function monthsAfterExport(result: Pick<IngestResult, "slices" | "asOfDate">): string[] {
  if (!result.asOfDate) return [];
  const exportMonth = dateToMonth(result.asOfDate);
  return resultMonths(result).filter((m) => m > exportMonth);
}

/** The result without the given months (facts, ledger rows, slices, totals). */
export function withoutMonths(result: IngestResult, months: readonly string[]): IngestResult {
  if (months.length === 0) return result;
  const drop = new Set(months);
  const keep = (m: { month: string }) => !drop.has(m.month);
  const slices = result.slices.filter(keep);
  const out: IngestResult = {
    ...result,
    slices,
    facts: result.facts.filter(keep),
    totals: result.totals.filter(keep),
    companies: COMPANY_ORDER.filter((c) => slices.some((s) => s.company === c)),
  };
  if (result.ledger) out.ledger = { ...result.ledger, rows: result.ledger.rows.filter(keep) };
  return out;
}

/** Recompute the content hash after facts or ledger rows changed (same rules as ingest). */
export async function rehashResult(result: IngestResult): Promise<IngestResult> {
  const contentHash = result.ledger
    ? await sha256Hex(canonicalLedger(result.ledger.rows))
    : await factsContentHash(result.facts);
  return contentHash === result.contentHash ? result : { ...result, contentHash };
}

/** Exclude months and recompute the hash in one go. */
export async function excludeMonths(
  result: IngestResult,
  months: readonly string[],
): Promise<IngestResult> {
  if (months.length === 0) return result;
  return rehashResult(withoutMonths(result, months));
}

const EXPORT_LINE = /export|utskri|skapad|genererad|hämtad|uttag|printed|per\s/i;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;

/**
 * Export date suggestion for cases files: the latest valid date (not after
 * today) found in export/print lines, otherwise in any line or the file name,
 * otherwise today.
 */
export function suggestAsOfDate(texts: readonly string[], today: string): string {
  const found = (onlyExportLines: boolean): string | null => {
    let best: string | null = null;
    for (const text of texts) {
      if (onlyExportLines && !EXPORT_LINE.test(text)) continue;
      for (const m of text.matchAll(ISO_DATE)) {
        const r = parseDateSv(m[0]);
        if (!r.ok || !("date" in r) || r.date > today) continue;
        if (best === null || r.date > best) best = r.date;
      }
    }
    return best;
  };
  return found(true) ?? found(false) ?? today;
}

export interface MonthOption {
  value: string;
  label: string;
}

/**
 * Months for the period chip, newest first: `ahead` months after the current
 * month down to `back` months before it, plus any extra months (suggestions)
 * outside that range.
 */
export function monthOptions(
  now: Date,
  extra: readonly string[] = [],
  range: { back?: number; ahead?: number } = {},
): MonthOption[] {
  const current = currentMonth(now);
  const set = new Set<string>();
  for (let i = -(range.ahead ?? 12); i <= (range.back ?? 48); i++) set.add(addMonths(current, -i));
  for (const m of extra) if (isMonth(m)) set.add(m);
  return [...set]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((value) => ({ value, label: formatMonthShort(value) }));
}

/** "sep 2026", "jan–sep 2026", "nov 2025 – feb 2026". */
export function formatMonthSpan(months: readonly string[]): string {
  const sorted = [...new Set(months)].filter(isMonth).sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "";
  if (first === last) return formatMonthShort(first);
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${formatMonthShort(first).split(" ")[0]}–${formatMonthShort(last)}`;
  }
  return `${formatMonthShort(first)} – ${formatMonthShort(last)}`;
}
