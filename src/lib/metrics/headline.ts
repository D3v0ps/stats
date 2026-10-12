// Suggested slide headlines in the board style: "DELTAGARNA I KROM ÖKAR."
// Uppercase (Swedish locale), always ending with ".", kept within ~60 characters by
// shortening filter labels before anything is dropped.
import { COMPANY_FILTER_LABELS, type Unit } from "@/lib/contracts/domain";
import type { CompareCell, MetricDefinition } from "@/lib/contracts/metric-query";
import { formatValue } from "@/lib/core/format-sv";

export const HEADLINE_MAX_LENGTH = 60;
/** |deltaPct| below this (percent) reads as unchanged. */
export const FLAT_PCT_THRESHOLD = 2;
/** For pct metrics: |delta| below this many percentage points reads as unchanged. */
export const FLAT_PP_THRESHOLD = 1;

const MIN_LABEL_LENGTH = 8;
const ELLIPSIS = "…";

export type HeadlineTrend = "up" | "down" | "flat";

const VERBS: Record<HeadlineTrend, string> = {
  up: "ÖKAR",
  down: "MINSKAR",
  flat: "LIGGER STILLA",
};

export interface HeadlineInput {
  /** Definite-form subject, e.g. "DELTAGARNA" (see headlineSubjectOf). */
  subject: string;
  /** One entry per filtered value, e.g. { dimension: "verksamhet", label: "KROM" }. */
  filterLabels: { dimension: string; label: string }[];
  /** Single-company label ("MB AB", "MB Restart"); "Summa bolag" adds nothing. */
  companyLabel?: string | null;
  current: number | null;
  compare: CompareCell | null;
  unit: Unit;
  /** Decimals for the value in the no-comparison form (not used for kr, which is compact). */
  decimals?: number | null;
}

export function upperSv(text: string): string {
  return text.toLocaleUpperCase("sv-SE");
}

/** definition.headlineSubject, or the metric name in uppercase. */
export function headlineSubjectOf(def: Pick<MetricDefinition, "name" | "headlineSubject">): string {
  const subject = def.headlineSubject?.trim();
  return upperSv(subject ? subject : def.name);
}

/** Uppercase, trimmed, ending with "." (for user-written headline overrides). */
export function normalizeHeadline(text: string): string {
  const upper = upperSv(text.trim().replace(/\s+/g, " "));
  return upper.endsWith(".") ? upper : `${upper}.`;
}

/** up / down / flat by the headline thresholds; null when there is nothing to compare. */
export function headlineTrend(compare: CompareCell | null, unit: Unit): HeadlineTrend | null {
  if (!compare || compare.delta === null) return null;
  const classify = (v: number, threshold: number): HeadlineTrend =>
    Math.abs(v) < threshold ? "flat" : v > 0 ? "up" : "down";
  if (unit === "pct" && compare.deltaPp !== null) {
    return classify(compare.deltaPp, FLAT_PP_THRESHOLD);
  }
  if (compare.deltaPct !== null) return classify(compare.deltaPct, FLAT_PCT_THRESHOLD);
  // Base 0: no relative change exists, so any change counts.
  return compare.delta === 0 ? "flat" : compare.delta > 0 ? "up" : "down";
}

interface Phrase {
  kind: "filter" | "company";
  preposition: string;
  labels: string[];
  /** Show only the first label followed by "M.FL.". */
  collapsed: boolean;
  /** Max characters for the (first) label; longer labels end with "…". */
  limit: number | null;
}

function prepositionFor(dimension: string): string {
  if (dimension === "kund") return "HOS";
  if (dimension === "verksamhet" || dimension === "ort") return "I";
  return "FÖR";
}

function joinSv(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} OCH ${labels.at(-1)}`;
}

/** Shorten to `limit` characters including "…", preferring to cut between words. */
function truncate(label: string, limit: number | null): string {
  if (limit === null || label.length <= limit) return label;
  const max = Math.max(1, limit - 1);
  let cut = label.slice(0, max);
  if (label[max] !== " ") {
    const space = cut.lastIndexOf(" ");
    if (space >= Math.max(Math.ceil(max / 2), MIN_LABEL_LENGTH - 1)) cut = cut.slice(0, space);
  }
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

function renderPhrase(p: Phrase): string {
  const labels = p.collapsed
    ? `${truncate(p.labels[0] ?? "", p.limit)} M.FL.`
    : p.labels.length === 1
      ? truncate(p.labels[0] ?? "", p.limit)
      : joinSv(p.labels);
  return `${p.preposition} ${labels}`;
}

export function suggestHeadline(input: HeadlineInput): string {
  const subject = upperSv(input.subject.trim()).replace(/[.:]+$/, "");
  const trend = headlineTrend(input.compare, input.unit);
  const tail =
    trend !== null
      ? ` ${VERBS[trend]}.`
      : `: ${upperSv(
          formatValue(
            input.current,
            input.unit,
            input.unit === "kr" ? { compact: true } : { decimals: input.decimals ?? undefined },
          ),
        )}.`;

  const phrases: Phrase[] = [];
  const byDimension = new Map<string, string[]>();
  for (const f of input.filterLabels) {
    const label = upperSv(f.label.trim());
    if (label === "") continue;
    const list = byDimension.get(f.dimension) ?? [];
    if (!list.includes(label)) list.push(label);
    byDimension.set(f.dimension, list);
  }
  for (const [dimension, labels] of byDimension) {
    phrases.push({
      kind: "filter",
      preposition: prepositionFor(dimension),
      labels,
      collapsed: false,
      limit: null,
    });
  }
  const company = input.companyLabel?.trim();
  if (company && company !== COMPANY_FILTER_LABELS.ALL) {
    phrases.push({
      kind: "company",
      preposition: "I",
      labels: [upperSv(company)],
      collapsed: false,
      limit: null,
    });
  }

  const compose = (list: Phrase[]): string => [subject, ...list.map(renderPhrase)].join(" ") + tail;

  // Fit one set of phrases: collapse multi-value filters, then shorten the longest
  // filter label step by step (never below MIN_LABEL_LENGTH; company names stay whole).
  const fit = (list: Phrase[]): string => {
    let fitted = list.map((p) => ({ ...p }));
    const overflow = (): number => compose(fitted).length - HEADLINE_MAX_LENGTH;
    if (overflow() > 0) {
      fitted = fitted.map((p) => (p.labels.length > 1 ? { ...p, collapsed: true } : p));
    }
    while (overflow() > 0) {
      let longest: Phrase | null = null;
      let longestLength = MIN_LABEL_LENGTH;
      for (const p of fitted) {
        if (p.kind !== "filter") continue;
        const length = Math.min(p.labels[0]?.length ?? 0, p.limit ?? Infinity);
        if (length > longestLength) {
          longest = p;
          longestLength = length;
        }
      }
      if (longest === null) break;
      longest.limit = Math.max(MIN_LABEL_LENGTH, longestLength - overflow());
    }
    return compose(fitted);
  };

  // Keep as much context as fits: everything, then without the company, then fewer filters.
  const candidates: Phrase[][] = [phrases];
  let rest = phrases.filter((p) => p.kind !== "company");
  if (rest.length !== phrases.length) candidates.push(rest);
  while (rest.length > 0) {
    rest = rest.slice(0, -1);
    candidates.push(rest);
  }
  for (const candidate of candidates) {
    const text = fit(candidate);
    if (text.length <= HEADLINE_MAX_LENGTH) return text;
  }
  return compose([]);
}
