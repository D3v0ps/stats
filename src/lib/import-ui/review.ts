// Review before publishing: resolving dimension labels to ids, the comparison
// table (this file vs published data vs previous month), the parse report in
// plain words, and the summary line after publishing.
import {
  COMPANY_FILTER_LABELS,
  type CompanyCode,
  type FactDraft,
  type FactRow,
  type IngestResult,
  type ParseIssue,
  type SkipReason,
  type SkippedRow,
} from "@/lib/contracts";
import { formatDateSv } from "@/lib/core/format-sv";
import { formatMonthShort } from "@/lib/core/month";
import { normalizeValue } from "@/lib/core/normalize";
import { kostnadsstalleCode } from "@/lib/db/repo/uploads";
import { MISSING_LABEL } from "@/lib/ingest/aggregate";
import type { AliasTables } from "@/lib/ingest/pipeline";
import { resolveDims, type DimensionDictionary } from "@/lib/ingest/resolve";
import { formatMonthSpan } from "./months";

// ---- Dimensions -------------------------------------------------------------------

/** A dimension dictionary as loaded from the database (resolveDims input plus labels). */
export interface DictionaryEntry extends DimensionDictionary {
  personal: boolean;
  /** dimension_values.id -> label (inactive values included). */
  labels: Record<number, string>;
}

export const KOSTNADSSTALLE = "kostnadsstalle";
const SCOPED = /^(?:MBAB|MBR):/;

/** Dimension keys used by the facts, sorted. */
export function factDimensions(facts: readonly FactDraft[]): string[] {
  const keys = new Set<string>();
  for (const f of facts) for (const k of Object.keys(f.dims)) keys.add(k);
  return [...keys].sort();
}

/** Kostnadsställe codes in table data belong to a company: "100" -> "MBAB:100". */
export function scopeKostnadsstalle(facts: readonly FactDraft[]): FactDraft[] {
  return facts.map((f) => {
    const label = f.dims[KOSTNADSSTALLE];
    if (label === undefined || SCOPED.test(label)) return f;
    return { ...f, dims: { ...f.dims, [KOSTNADSSTALLE]: kostnadsstalleCode(f.company, label) } };
  });
}

/** Lookup tables for the "Översätt" step: every known spelling -> its label. */
export function aliasTablesFromDictionary(
  dict: Readonly<Record<string, DictionaryEntry>>,
): AliasTables {
  const out: AliasTables = {};
  for (const [dim, entry] of Object.entries(dict)) {
    const table: Record<string, string> = {};
    for (const [norm, id] of Object.entries(entry.byNorm)) {
      const label = entry.labels[id];
      if (label !== undefined) table[norm] = label;
    }
    out[dim] = table;
  }
  return out;
}

export interface UnknownGroup {
  dimension: string;
  label: string;
  personal: boolean;
  /** Values the user decides on: add as new, or "Samma som…" an existing value. */
  ask: string[];
  /** Values added automatically when staging (auto_create dimensions). */
  create: string[];
}

export interface Resolution {
  /** Facts with dimension ids, or null while values are unknown. */
  rows: FactRow[] | null;
  unknown: UnknownGroup[];
  /** True when only auto-created values are missing (staging can proceed after creating them). */
  onlyAutoCreate: boolean;
}

/** Resolve the facts' labels with the dictionary (kostnadsställe scoped per company). */
export function resolveFacts(
  facts: readonly FactDraft[],
  dict: Readonly<Record<string, DictionaryEntry>>,
  dimensionLabels: Readonly<Record<string, string>> = {},
): Resolution {
  const r = resolveDims(scopeKostnadsstalle(facts), dict as Record<string, DimensionDictionary>);
  const dims = [...new Set([...Object.keys(r.toAsk), ...Object.keys(r.toCreate)])].sort();
  const unknown = dims.map((dimension) => ({
    dimension,
    label: dimensionLabels[dimension] ?? dimension,
    personal: dict[dimension]?.personal ?? false,
    ask: r.toAsk[dimension] ?? [],
    create: r.toCreate[dimension] ?? [],
  }));
  return { rows: r.rows, unknown, onlyAutoCreate: Object.keys(r.toAsk).length === 0 };
}

/** Existing values of a dimension for the "Samma som…" picker, sorted by label. */
export function existingValues(
  entry: DictionaryEntry | undefined,
): { id: number; label: string }[] {
  if (!entry) return [];
  const active = new Set(Object.values(entry.byNorm));
  return Object.entries(entry.labels)
    .map(([id, label]) => ({ id: Number(id), label }))
    .filter((v) => active.has(v.id))
    .sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

/** Add values to a dictionary entry after they were created or aliased. */
export function withResolvedValues(
  dict: Readonly<Record<string, DictionaryEntry>>,
  dimension: string,
  values: Readonly<Record<string, number>>,
): Record<string, DictionaryEntry> {
  const entry = dict[dimension] ?? { byNorm: {}, policy: "ask", personal: false, labels: {} };
  const byNorm = { ...entry.byNorm };
  const labels = { ...entry.labels };
  for (const [label, id] of Object.entries(values)) {
    byNorm[normalizeValue(label)] = id;
    labels[id] ??= label;
  }
  return { ...dict, [dimension]: { ...entry, byNorm, labels } };
}

/** Facts that have an empty dimension cell, counted per dimension (source rows). */
export function emptyDimensionRows(
  facts: readonly FactDraft[],
): { dimension: string; rows: number }[] {
  const rows = new Map<string, Set<number>>();
  for (const f of facts) {
    for (const [dim, label] of Object.entries(f.dims)) {
      if (label !== MISSING_LABEL) continue;
      const set = rows.get(dim) ?? new Set<number>();
      for (const r of f.sourceRows) set.add(r);
      rows.set(dim, set);
    }
  }
  return [...rows.entries()]
    .map(([dimension, set]) => ({ dimension, rows: set.size }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

// ---- Comparison -------------------------------------------------------------------

export interface ComparisonInputRow {
  metricKey: string;
  company: CompanyCode;
  month: string;
  staged: number;
  current: number | null;
  previous: number | null;
  changePct: number | null;
  deviationPct: number | null;
  flagged: boolean;
  replacesCurrent: boolean;
}

export interface ReviewMetricInfo {
  key: string;
  name: string;
  unit: "st" | "kr" | "h" | "pct" | "faktor" | "man";
  decimals: number | null;
  higherIsBetter: boolean | null;
}

export interface ReviewRow extends ComparisonInputRow {
  key: string;
  metricName: string;
  unit: ReviewMetricInfo["unit"];
  decimals: number | null;
  higherIsBetter: boolean | null;
  companyLabel: string;
  monthLabel: string;
  /** Published data for the same month is replaced. */
  replacing: boolean;
  /** Direction of the change vs the previous month (null without a previous month). */
  direction: "up" | "down" | "flat" | null;
}

/** Comparison rows in catalog metric order, then company, then month. */
export function buildReviewRows(
  rows: readonly ComparisonInputRow[],
  metrics: readonly ReviewMetricInfo[],
): ReviewRow[] {
  const index = new Map(metrics.map((m, i) => [m.key, i]));
  const companyOrder: CompanyCode[] = ["MBAB", "MBR"];
  return [...rows]
    .sort(
      (a, b) =>
        (index.get(a.metricKey) ?? 1e9) - (index.get(b.metricKey) ?? 1e9) ||
        a.metricKey.localeCompare(b.metricKey) ||
        companyOrder.indexOf(a.company) - companyOrder.indexOf(b.company) ||
        a.month.localeCompare(b.month),
    )
    .map((r) => {
      const m = metrics.find((x) => x.key === r.metricKey);
      return {
        ...r,
        key: `${r.metricKey}|${r.company}|${r.month}`,
        metricName: m?.name ?? r.metricKey,
        unit: m?.unit ?? "st",
        decimals: m?.decimals ?? null,
        higherIsBetter: m?.higherIsBetter ?? null,
        companyLabel: COMPANY_FILTER_LABELS[r.company],
        monthLabel: formatMonthShort(r.month),
        replacing: r.current !== null && r.replacesCurrent,
        direction:
          r.deviationPct === null
            ? null
            : r.deviationPct > 0
              ? "up"
              : r.deviationPct < 0
                ? "down"
                : "flat",
      };
    });
}

export function flaggedCount(rows: readonly ReviewRow[]): number {
  return rows.filter((r) => r.flagged).length;
}

// ---- Parse report -------------------------------------------------------------------

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  empty: "Tomma rader",
  sum_row: "Summarader",
  footer: "Sidfot och utskriftsinformation",
  repeated_header: "Upprepade rubrikrader",
  filtered: "Bortfiltrerade rader",
  unparseable: "Rader som inte kunde läsas",
  meta: "Information ovanför tabellen",
};

export interface SkippedGroup {
  reason: SkipReason;
  label: string;
  count: number;
  examples: SkippedRow[];
}

/** Skipped rows grouped by reason (largest group first) with a few examples each. */
export function groupSkipped(skipped: readonly SkippedRow[], maxExamples = 3): SkippedGroup[] {
  const groups = new Map<SkipReason, SkippedRow[]>();
  for (const s of skipped) groups.set(s.reason, [...(groups.get(s.reason) ?? []), s]);
  return [...groups.entries()]
    .map(([reason, rows]) => ({
      reason,
      label: SKIP_REASON_LABELS[reason],
      count: rows.length,
      examples: rows.slice(0, maxExamples),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "sv"));
}

/** Issues split into problems with the mapping (no row) and unreadable cells. */
export function splitIssues(issues: readonly ParseIssue[]): {
  general: ParseIssue[];
  cells: ParseIssue[];
} {
  return {
    general: issues.filter((i) => i.sourceRow === 0),
    cells: issues.filter((i) => i.sourceRow > 0),
  };
}

/** Metrics with values in the result (facts), in first-seen order. */
export function resultMetricKeys(result: Pick<IngestResult, "facts" | "totals">): string[] {
  const keys: string[] = [];
  for (const f of [...result.facts, ...result.totals])
    if (!keys.includes(f.metricKey)) keys.push(f.metricKey);
  return keys;
}

// ---- After publishing -----------------------------------------------------------------

export interface PublishSummaryInput {
  metricCount: number;
  months: readonly string[];
  companies: readonly CompanyCode[];
  /** published_at of the version this upload replaced, if any. */
  replacedPublishedAt?: string | null;
  now?: Date;
}

/** "Publicerat: 3 mått, sep 2026, MB AB. Ersatte version från 2 okt." */
export function publishSummaryText(input: PublishSummaryInput): string {
  const companies = input.companies.map((c) => COMPANY_FILTER_LABELS[c]);
  const companyText =
    companies.length <= 1
      ? (companies[0] ?? "")
      : `${companies.slice(0, -1).join(", ")} och ${companies.at(-1)}`;
  const parts = [`${input.metricCount} mått`, formatMonthSpan(input.months), companyText].filter(
    Boolean,
  );
  let text = `Publicerat: ${parts.join(", ")}.`;
  if (input.replacedPublishedAt) {
    const date = formatDateSv(input.replacedPublishedAt);
    const year = String((input.now ?? new Date()).getFullYear());
    text += ` Ersatte version från ${date.endsWith(` ${year}`) ? date.slice(0, -year.length - 1) : date}.`;
  }
  return text;
}
