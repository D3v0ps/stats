// Plain-Swedish descriptions of metrics, grouping for the settings list, live formula
// checks (built on the metric engine's parser and validator) and the wage uplift field.
import { MetricKeySchema, type MetricKind, type Unit } from "@/lib/contracts/domain";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { formatNumber } from "@/lib/core/format-sv";
import { parseNumberSv } from "@/lib/core/num-sv";
import { FormulaSyntaxError, parseFormula, referencedKeys, validateFormulas } from "@/lib/metrics";

export const KIND_LABELS: Record<MetricKind, string> = {
  sum: "Summa",
  snapshot: "Ögonblicksbild",
  distinct: "Unika",
  ledger: "Bokföring",
  formula: "Formel",
};

export const KIND_EXPLANATIONS: Record<MetricKind, string> = {
  sum: "Läggs ihop över månader och grupper.",
  snapshot: "Läget vid månadens slut. Läggs aldrig ihop över flera månader.",
  distinct: "Antal unika i perioden, till exempel konsulter som har arbetat.",
  ledger: "Summan av en kontogrupp i bokföringen.",
  formula: "Räknas fram ur andra mått.",
};

export const UNIT_LABELS: Record<Unit, string> = {
  st: "Antal (st)",
  kr: "Kronor (kr)",
  h: "Timmar (h)",
  pct: "Procent (%)",
  faktor: "Faktor",
  man: "Månader (mån)",
};

export const UNITS: readonly Unit[] = ["st", "kr", "h", "pct", "faktor", "man"];

export type Direction = "up" | "down" | "neutral";

export const DIRECTION_LABELS: Record<Direction, string> = {
  up: "Högre är bättre",
  down: "Lägre är bättre",
  neutral: "Varken eller",
};

export function toDirection(higherIsBetter: boolean | null): Direction {
  return higherIsBetter === null ? "neutral" : higherIsBetter ? "up" : "down";
}

export function fromDirection(direction: Direction): boolean | null {
  return direction === "neutral" ? null : direction === "up";
}

export const MAX_DECIMALS = 6;

// ---- Grouping ------------------------------------------------------------------

export interface MetricGroup {
  key: string;
  title: string;
  metrics: MetricDefinition[];
}

export const FORMULA_GROUP_TITLE = "Formler (beräknade mått)";
const OTHER_GROUP_TITLE = "Övriga";

/** Metrics grouped by dataset (in the given dataset order), formula metrics last. */
export function groupMetrics(
  definitions: readonly MetricDefinition[],
  datasets: readonly { key: string; name: string }[],
): MetricGroup[] {
  const groups: MetricGroup[] = datasets.map((d) => ({ key: d.key, title: d.name, metrics: [] }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const formulas: MetricGroup = { key: "__formula", title: FORMULA_GROUP_TITLE, metrics: [] };
  const others: MetricGroup = { key: "__other", title: OTHER_GROUP_TITLE, metrics: [] };
  for (const def of definitions) {
    if (def.kind === "formula") formulas.metrics.push(def);
    else (byKey.get(def.datasetKey ?? "") ?? others).metrics.push(def);
  }
  return [...groups, others, formulas].filter((g) => g.metrics.length > 0);
}

// ---- Formula checks --------------------------------------------------------------

export interface FormulaCheck {
  ok: boolean;
  /** Swedish messages, empty when ok. */
  errors: string[];
  /** Known metrics the formula uses, in order of first appearance. */
  referenced: { key: string; name: string; unit: Unit }[];
  /** Dimensions every referenced metric has (what the result can be grouped by). */
  dimensions: string[];
}

/**
 * Check a formula as it would be saved for `key` (an existing formula metric or a new one):
 * syntax, unknown metrics and reference cycles, via validateFormulas over the whole catalog.
 */
export function checkFormula(
  definitions: readonly MetricDefinition[],
  key: string,
  formula: string,
): FormulaCheck {
  const source = formula.trim();
  const candidate: MetricDefinition = {
    ...(definitions.find((d) => d.key === key) ?? {
      key,
      name: key,
      unit: "st",
      datasetKey: null,
      higherIsBetter: null,
      decimals: null,
      dimensions: [],
    }),
    kind: "formula",
    formula: source,
  };
  const all = [...definitions.filter((d) => d.key !== key), candidate];
  const errors = validateFormulas(all)
    .filter((issue) => issue.metricKey === key)
    .map((issue) => issue.message);

  let refs: string[] = [];
  try {
    refs = referencedKeys(parseFormula(source));
  } catch (e) {
    if (!(e instanceof FormulaSyntaxError)) throw e;
  }
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const referenced = refs
    .map((k) => byKey.get(k))
    .filter((d): d is MetricDefinition => d !== undefined && d.key !== key);
  if (errors.length === 0 && refs.length === 0 && source !== "") {
    errors.push("Formeln måste använda minst ett mått.");
  }
  const dimensions =
    referenced.length === 0
      ? []
      : referenced
          .map((d) => d.dimensions)
          .reduce((acc, dims) => acc.filter((k) => dims.includes(k)));
  return {
    ok: errors.length === 0,
    errors,
    referenced: referenced.map((d) => ({ key: d.key, name: d.name, unit: d.unit })),
    dimensions,
  };
}

// ---- Wage uplift (faktor) --------------------------------------------------------

export const WAGE_METRIC_KEY = "lonekostnad";
export const MAX_WAGE_UPLIFT_PCT = 300;

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const WAGE_FACTOR = new RegExp(
  String.raw`\b${WAGE_METRIC_KEY}\s*\*\s*${NUMBER}(?![\d.])|(?<![\w.])${NUMBER}\s*\*\s*${WAGE_METRIC_KEY}\b`,
);
const WAGE_REF = new RegExp(String.raw`\b${WAGE_METRIC_KEY}\b`, "g");

/** True when the formula uses lonekostnad, so a "Lönepåslag %" field makes sense. */
export function usesWageCost(formula: string): boolean {
  WAGE_REF.lastIndex = 0;
  return WAGE_REF.test(formula);
}

/** The wage uplift in percent encoded as "lonekostnad * 1.31" (31), 0 without a multiplier. */
export function wageUpliftPct(formula: string): number | null {
  if (!usesWageCost(formula)) return null;
  const m = WAGE_FACTOR.exec(formula);
  if (!m) return 0;
  const factor = Number(m[1] ?? m[2]);
  return Math.round((factor - 1) * 100 * 10_000) / 10_000;
}

/** "1.0", "1.31", "1.315": the multiplier as written into formulas. */
export function formatMultiplier(pct: number): string {
  const factor = Math.round((1 + pct / 100) * 10_000) / 10_000;
  return Number.isInteger(factor) ? factor.toFixed(1) : String(factor);
}

/**
 * Rewrite the wage multiplier for a new uplift: "fakturerat_ip / (lonekostnad * 1.0)" with
 * 31 % becomes "fakturerat_ip / (lonekostnad * 1.31)". A formula without a multiplier gets
 * one around every lonekostnad reference.
 */
export function withWageUplift(formula: string, pct: number): string {
  if (!Number.isFinite(pct) || pct < 0 || pct > MAX_WAGE_UPLIFT_PCT) {
    throw new Error(`Lönepåslaget måste vara mellan 0 och ${MAX_WAGE_UPLIFT_PCT} %.`);
  }
  const factor = formatMultiplier(pct);
  if (WAGE_FACTOR.test(formula)) {
    return formula.replace(WAGE_FACTOR, (_all, after: string | undefined) =>
      after !== undefined ? `${WAGE_METRIC_KEY} * ${factor}` : `${factor} * ${WAGE_METRIC_KEY}`,
    );
  }
  return formula.replace(WAGE_REF, `(${WAGE_METRIC_KEY} * ${factor})`);
}

/**
 * Insert a metric key at the cursor (replacing a selection), padding with spaces so it never
 * glues onto a neighbouring key or number. Returns the new text and cursor position.
 */
export function insertIntoFormula(
  formula: string,
  start: number,
  end: number,
  key: string,
): { formula: string; cursor: number } {
  const before = formula.slice(0, start);
  const after = formula.slice(end);
  const lead = before === "" || /[\s(]$/.test(before) ? "" : " ";
  const trail = after === "" || /^[\s)]/.test(after) ? "" : " ";
  const inserted = `${lead}${key}${trail}`;
  return {
    formula: `${before}${inserted}${after}`,
    cursor: before.length + lead.length + key.length,
  };
}

// ---- Percent inputs (Lönepåslag, avvikelsegräns) ------------------------------------

/** "31,5", "31.5" or "31 %" -> 31.5; null for empty or non-numeric text. */
export function parsePercentInput(text: string): number | null {
  const parsed = parseNumberSv(text, "percent");
  return parsed.ok && parsed.value !== null && Number.isFinite(parsed.value) ? parsed.value : null;
}

/** 31.5 -> "31,5" for an input field (no grouping, at most four decimals). */
export function percentInputText(pct: number): string {
  const rounded = Math.round(pct * 10_000) / 10_000;
  const decimals = (String(rounded).split(".")[1] ?? "").length;
  return formatNumber(rounded, decimals).replace(/\s/g, "");
}

// ---- New metric keys -------------------------------------------------------------

/** A metric key from a Swedish name: "Intäkt per konsult" -> "intakt_per_konsult", unique. */
export function suggestMetricKey(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 50)
    .replace(/_+$/, "");
  if (base.length < 2) base = "matt";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`;
    if (!taken.has(key)) return key;
  }
}

/** Swedish error for a metric key typed by hand, or null when it is valid and free. */
export function metricKeyError(key: string, existing: Iterable<string>): string | null {
  if (!MetricKeySchema.safeParse(key).success) {
    return "Nyckeln får bara innehålla a–z, 0–9 och understreck, börja med en bokstav och vara 2–61 tecken.";
  }
  for (const k of existing) if (k === key) return "Det finns redan ett mått med den nyckeln.";
  return null;
}
