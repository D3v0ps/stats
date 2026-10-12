// Recognition: which template fits a file, what changed since the template was
// saved, and which month and company the file most likely covers.
import type { CompanyCode, DetectedTable, SignatureDiff } from "@/lib/contracts";
import { extractMonthCandidates, parseDateSv, resultMonth } from "@/lib/core/dates-sv";
import { similarity } from "@/lib/core/levenshtein";

/** Normalized headers in source order. */
export function headerSignature(table: DetectedTable): string[] {
  return table.columns.map((c) => c.normalized);
}

const RENAME_THRESHOLD = 0.6;

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Elements of `list` not covered by `other` (multiset difference, order kept). */
function minus(list: string[], other: string[]): string[] {
  const left = counts(other);
  const out: string[] = [];
  for (const x of list) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

/** Elements of `list` also in `other` (multiset intersection, order of `list`). */
function common(list: string[], other: string[]): string[] {
  const left = counts(other);
  const out: string[] = [];
  for (const x of list) {
    const n = left.get(x) ?? 0;
    if (n > 0) {
      left.set(x, n - 1);
      out.push(x);
    }
  }
  return out;
}

/**
 * Compare a template's signature with a file's. Likely renames (similarity
 * >= 0.6, paired greedily best-first) are reported under `renamed` and not
 * repeated under added/removed. Order changes alone keep the file compatible.
 */
export function diffSignature(templateSig: string[], fileSig: string[]): SignatureDiff {
  let added = minus(fileSig, templateSig);
  let removed = minus(templateSig, fileSig);

  const pairs: { from: string; to: string; similarity: number; i: number; j: number }[] = [];
  removed.forEach((from, i) => {
    added.forEach((to, j) => {
      const sim = similarity(from, to);
      if (sim >= RENAME_THRESHOLD) pairs.push({ from, to, similarity: sim, i, j });
    });
  });
  pairs.sort((a, b) => b.similarity - a.similarity || a.i - b.i || a.j - b.j);
  const usedFrom = new Set<number>();
  const usedTo = new Set<number>();
  const renamed: SignatureDiff["renamed"] = [];
  for (const p of pairs) {
    if (usedFrom.has(p.i) || usedTo.has(p.j)) continue;
    usedFrom.add(p.i);
    usedTo.add(p.j);
    renamed.push({ from: p.from, to: p.to, similarity: Math.round(p.similarity * 100) / 100 });
  }
  removed = removed.filter((_, i) => !usedFrom.has(i));
  added = added.filter((_, j) => !usedTo.has(j));

  const tCommon = common(templateSig, fileSig);
  const fCommon = common(fileSig, templateSig);
  const reordered = tCommon.some((x, i) => fCommon[i] !== x);

  return {
    added,
    removed,
    renamed,
    reordered,
    compatible: added.length === 0 && removed.length === 0 && renamed.length === 0,
  };
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface TemplateCandidate {
  id: string;
  datasetKey: string;
  headerSignature: string[];
}

export interface TemplateMatch {
  id: string;
  datasetKey: string;
  /** Jaccard similarity of the header sets, 0..1. */
  score: number;
  diff: SignatureDiff;
}

/** Templates ranked by header overlap (best first); templates sharing no header are left out. */
export function matchTemplates(fileSig: string[], templates: TemplateCandidate[]): TemplateMatch[] {
  return templates
    .map((t) => ({
      id: t.id,
      datasetKey: t.datasetKey,
      score: Math.round(jaccard(t.headerSignature, fileSig) * 1000) / 1000,
      diff: diffSignature(t.headerSignature, fileSig),
    }))
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.diff.compatible) - Number(a.diff.compatible) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

// ---- Period ------------------------------------------------------------------

export type SuggestionSource = "filename" | "meta" | "data";

export interface PeriodSuggestion {
  month: string;
  /** 0..1 */
  confidence: number;
  source: SuggestionSource;
}

const PRINT_DATE_LINE = /utskri|skapad|genererad|printed|export|hämtad/i;
const PERIOD_LINE = /period|månad|avser|redovisning|rapport för/i;

/**
 * Rank month candidates from the file name, the meta lines above the table and
 * (optionally) the values of a date column. Evidence for the same month from
 * several sources is combined.
 */
export function suggestPeriod(
  fileName: string,
  metaLines: string[],
  dateColumnValues?: readonly unknown[],
): PeriodSuggestion[] {
  const evidence = new Map<string, { source: SuggestionSource; confidence: number }[]>();
  const add = (month: string, source: SuggestionSource, confidence: number) => {
    const list = evidence.get(month) ?? [];
    list.push({ source, confidence: Math.min(0.99, confidence) });
    evidence.set(month, list);
  };

  for (const c of extractMonthCandidates(fileName)) add(c.month, "filename", c.confidence);
  for (const line of metaLines) {
    const factor = PRINT_DATE_LINE.test(line) ? 0.5 : PERIOD_LINE.test(line) ? 1.1 : 1;
    for (const c of extractMonthCandidates(line)) add(c.month, "meta", c.confidence * factor);
  }

  if (dateColumnValues && dateColumnValues.length > 0) {
    const perMonth = new Map<string, number>();
    let parsed = 0;
    for (const v of dateColumnValues) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      const month = resultMonth(parseDateSv(v));
      if (!month) continue;
      parsed++;
      perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
    }
    for (const [month, n] of perMonth) {
      const share = n / parsed;
      if (share >= 0.05) add(month, "data", 0.9 * share);
    }
  }

  return [...evidence.entries()]
    .map(([month, list]) => {
      const best = list.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      const combined = 1 - list.reduce((p, e) => p * (1 - e.confidence), 1);
      return {
        month,
        confidence: Math.round(Math.min(0.99, combined) * 100) / 100,
        source: best.source,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || (a.month < b.month ? 1 : -1));
}

// ---- Company -----------------------------------------------------------------

export interface CompanySuggestion {
  company: CompanyCode;
  source: "filename" | "meta";
  /** 0..1 */
  confidence: number;
}

const ORG_RULES: { re: RegExp; company: CompanyCode }[] = [
  { re: /(?<!\d)(?:16)?556959-?9318(?!\d)/, company: "MBAB" },
  { re: /(?<!\d)(?:16)?559208-?9071(?!\d)/, company: "MBR" },
];

function tokenScores(text: string): { company: CompanyCode; confidence: number }[] {
  const out: { company: CompanyCode; confidence: number }[] = [];
  for (const rule of ORG_RULES) {
    if (rule.re.test(text)) out.push({ company: rule.company, confidence: 0.98 });
  }
  const tokens = text
    .normalize("NFC")
    .toLocaleLowerCase("sv")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const has = (t: string) => tokens.includes(t);
  const seq = (a: string, b: string) => tokens.some((t, i) => t === a && tokens[i + 1] === b);

  if (has("mbr")) out.push({ company: "MBR", confidence: 0.9 });
  if (has("mbab")) out.push({ company: "MBAB", confidence: 0.9 });
  if (seq("miljonbemanning", "restart") || seq("mb", "restart")) {
    out.push({ company: "MBR", confidence: 0.9 });
  } else if (has("restart")) {
    out.push({ company: "MBR", confidence: 0.8 });
  }
  if (seq("miljonbemanning", "ab")) out.push({ company: "MBAB", confidence: 0.9 });
  if (seq("mb", "ab")) out.push({ company: "MBAB", confidence: 0.85 });
  if (has("miljonbemanning") && !has("restart")) out.push({ company: "MBAB", confidence: 0.6 });
  return out;
}

/**
 * Suggest the company from org numbers (556959-9318 = MBAB, 559208-9071 = MBR)
 * and names/codes in the file name and meta lines. null when nothing points to
 * a company or the evidence is equally strong for both.
 */
export function suggestCompany(fileName: string, metaLines: string[]): CompanySuggestion | null {
  const best: Partial<Record<CompanyCode, CompanySuggestion>> = {};
  const sources: { text: string; source: CompanySuggestion["source"] }[] = [
    { text: fileName, source: "filename" },
    ...metaLines.map((text) => ({ text, source: "meta" as const })),
  ];
  for (const { text, source } of sources) {
    for (const s of tokenScores(text)) {
      const prev = best[s.company];
      if (!prev || s.confidence > prev.confidence) {
        best[s.company] = { company: s.company, source, confidence: s.confidence };
      }
    }
  }
  const a = best.MBAB;
  const b = best.MBR;
  if (a && b) {
    if (a.confidence === b.confidence) return null;
    return a.confidence > b.confidence ? a : b;
  }
  return a ?? b ?? null;
}
