// Column type inference and first-guess mappings for the mapping view.
// Personal columns default to removed; personnummer columns can never be kept.
import type { ColumnMapping, ColumnType, ColumnUsage } from "@/lib/contracts";
import { CATALOG_DATASETS, CATALOG_METRICS, type CatalogMetric } from "@/lib/contracts/catalog";
import { normalizeHeader, normalizeValue } from "@/lib/core/normalize";
import { parseNumberSv } from "@/lib/core/num-sv";
import { columnContainsPersonnummer, detectPersonalColumn } from "@/lib/core/pnr";
import { looksDate } from "./cells";
import { columnValues, valueText, type WorkingTable } from "./working";

export interface InferredType {
  type: ColumnType;
  /** Share of non-empty samples that support the type, 0..1. */
  confidence: number;
}

const TYPE_THRESHOLD = 0.8;
const MAX_TYPE_SAMPLES = 1000;
const MAX_PERSONAL_SAMPLES = 500;
const LOW_CARDINALITY = 50;

const AMOUNT_HEADER =
  /belopp|summa|(?:^|[^\p{L}])(?:kr|sek)(?:$|[^\p{L}])|pris|lön|kostnad(?!sställe)|intäkt|fakturerat|arvode|ersättning|budget|omsättning|moms/u;
const HOURS_HEADER = /timmar|(?:^|[^\p{L}])(?:tim|h)(?:$|[^\p{L}])|hours/u;
const PERCENT_HEADER = /%|procent|andel/u;

function isOk(text: string, kind: "number" | "amount" | "hours" | "percent"): boolean {
  const r = parseNumberSv(text, kind);
  return r.ok ? r.value !== null : r.ambiguous === true;
}

/**
 * Infer a column type from sample values (and optionally its header, which
 * refines plain numbers into amount/hours/percent). A type needs 80 % support;
 * otherwise the column is text.
 */
export function inferColumnType(samples: readonly unknown[], header?: string): InferredType {
  let date = 0;
  let num = 0;
  let amount = 0;
  let hours = 0;
  let percent = 0;
  let n = 0;
  for (const v of samples) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") {
      if (Number.isFinite(v)) num++;
      n++;
      continue;
    }
    const s = String(v).trim();
    if (s === "") continue;
    n++;
    if (typeof v === "boolean") continue;
    if (!/^\d+$/.test(s) && looksDate(s)) date++;
    else if (/%|procent/i.test(s) && isOk(s, "percent")) percent++;
    else if (/kr|sek|:-|,-/i.test(s) && isOk(s, "amount")) amount++;
    else if (/\d:\d\d|h\b|tim/i.test(s) && isOk(s, "hours")) hours++;
    else if (isOk(s, "number")) num++;
  }
  if (n === 0) return { type: "text", confidence: 0 };

  const round = (x: number) => Math.round(x * 100) / 100;
  if (date / n >= TYPE_THRESHOLD) return { type: "date", confidence: round(date / n) };
  const numeric = num + amount + hours + percent;
  if (numeric / n >= TYPE_THRESHOLD) {
    const confidence = round(numeric / n);
    if (percent > 0 && percent >= amount && percent >= hours)
      return { type: "percent", confidence };
    if (amount > 0 && amount >= hours) return { type: "amount", confidence };
    if (hours > 0) return { type: "hours", confidence };
    const h = header ? normalizeHeader(header) : "";
    if (PERCENT_HEADER.test(h)) return { type: "percent", confidence };
    if (AMOUNT_HEADER.test(h)) return { type: "amount", confidence };
    if (HOURS_HEADER.test(h)) return { type: "hours", confidence };
    return { type: "number", confidence };
  }
  return { type: "text", confidence: round(1 - Math.max(date, numeric) / n) };
}

// ---- Mapping suggestions ----------------------------------------------------

const ID_HEADER =
  /(?:^|[^\p{L}])(?:id|nr|nummer|kod|code|number)(?:$|[^\p{L}])|nummer$|nr\.?$|-id$|anställnings ?-?id|(?:^|[^\p{L}])gen(?:$|[^\p{L}])/u;
/** Headers that name a quantity, so integers below them are measures even under a dimension word. */
const QUANTITY_HEADER = /antal|summa|totalt|(?:^|[^\p{L}])st(?:$|[^\p{L}])/u;

/** Header keywords per dimension, most specific first. */
const DIMENSION_RULES: { key: string; re: RegExp }[] = [
  { key: "ordertyp", re: /ordertyp|ersättningstyp|typ av order/u },
  { key: "kostnadsstalle", re: /kostnadsställe|(?:^|[^\p{L}])kst(?:$|[^\p{L}])|cost cent/u },
  { key: "kontogrupp", re: /kontogrupp|konto/u },
  { key: "franvarotyp", re: /frånvaro|orsak|absence/u },
  { key: "resultattyp", re: /resultat/u },
  { key: "konsult", re: /anställnings ?-?id|anst\.? ?nr|konsult|anställd|medarbetare|employee/u },
  { key: "uppdrag", re: /uppdrag|assignment|projekt/u },
  { key: "kund", re: /kund|customer|client/u },
  { key: "verksamhet", re: /verksamhet|tjänst|program/u },
  {
    key: "ort",
    re: /(?:^|[^\p{L}])(?:ort|stad|kommun|city)(?:$|[^\p{L}])|leveransområde|arbetsort/u,
  },
];

const CASE_RULES: { usage: ColumnUsage; re: RegExp; dateOnly?: boolean }[] = [
  { usage: "case_result_date", re: /resultatdatum|datum för resultat/u, dateOnly: true },
  { usage: "case_interrupt", re: /avbrott/u },
  { usage: "case_result", re: /resultat|utfall/u },
  { usage: "case_start", re: /start|från|påbörjad|inskriv|anställd from/u, dateOnly: true },
  { usage: "case_end", re: /slut|till|avslut|utskriv|tom$/u, dateOnly: true },
  {
    usage: "case_key",
    re: /(?:^|[^\p{L}])(?:gen|id|referens|ärende)|anställnings ?-?id|deltagar ?-?id|gen-?nummer/u,
  },
];

const UNIT_FOR_TYPE: Partial<Record<ColumnType, CatalogMetric["unit"][]>> = {
  amount: ["kr"],
  hours: ["h"],
  number: ["st", "h", "kr"],
  percent: ["pct"],
};

function suggestDimension(header: string, datasetKey?: string): string | undefined {
  const dims = datasetKey
    ? CATALOG_DATASETS.find((d) => d.key === datasetKey)?.dimensions
    : undefined;
  return DIMENSION_RULES.find((r) => r.re.test(header) && (!dims || dims.includes(r.key)))?.key;
}

function tokens(s: string): string[] {
  return normalizeValue(s.replace(/_/g, " "))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

function suggestMetric(header: string, type: ColumnType, datasetKey?: string): string | undefined {
  if (!datasetKey) return undefined;
  const units = UNIT_FOR_TYPE[type] ?? [];
  const candidates = CATALOG_METRICS.filter((m) => m.datasetKey === datasetKey && m.kind === "sum");
  const headerTokens = tokens(header);
  let best: { key: string; score: number } | undefined;
  for (const m of candidates) {
    const metricTokens = [...tokens(m.name), ...tokens(m.key)];
    const overlap = headerTokens.filter((h) =>
      metricTokens.some((t) => t.includes(h) || h.includes(t)),
    ).length;
    const score = overlap + (units.includes(m.unit) ? 0.5 : -1);
    if (score > 0 && (!best || score > best.score)) best = { key: m.key, score };
  }
  if (best && best.score >= 1) return best.key;
  const unitMatches = candidates.filter((m) => units.includes(m.unit));
  return unitMatches.length === 1 ? unitMatches[0]!.key : undefined;
}

function looksLikeCompanyColumn(header: string, values: string[]): boolean {
  if (!/bolag|företag|company/u.test(header)) return false;
  const known = values.filter((v) =>
    /^(?:mbab|mbr|mb ab|mb restart|miljonbemanning(?: restart)? ab)$/u.test(normalizeValue(v)),
  );
  return values.length > 0 && known.length / values.length >= 0.8;
}

export interface SuggestOptions {
  datasetKey?: string;
}

/**
 * First-guess column mappings. Personal columns are removed by default
 * (personal:true, keep:false); personnummer columns are always removed.
 * Numbers -> measure, the first date -> period, low-cardinality text ->
 * dimension, high-cardinality free text -> ignore. Cases datasets get
 * start/end/avbrott/resultat usages from header keywords.
 */
export function suggestMappings(table: WorkingTable, opts: SuggestOptions = {}): ColumnMapping[] {
  const datasetKind = opts.datasetKey
    ? CATALOG_DATASETS.find((d) => d.key === opts.datasetKey)?.kind
    : undefined;
  let periodTaken = false;
  const usedCaseUsages = new Set<ColumnUsage>();

  return table.columns.map((column): ColumnMapping => {
    const header = normalizeHeader(table.headers?.[column] ?? column);
    const values = columnValues(table, column);
    const texts = values.map(valueText);
    const base = { column, personal: false, keep: true };

    const personal = detectPersonalColumn(header, texts.slice(0, MAX_PERSONAL_SAMPLES));
    if (personal.kind === "pnr" || columnContainsPersonnummer(values)) {
      return { ...base, type: "text", usage: "ignore", personal: true, keep: false };
    }
    const inferred = inferColumnType(values.slice(0, MAX_TYPE_SAMPLES), header);
    if (personal.kind) {
      return { ...base, type: inferred.type, usage: "ignore", personal: true, keep: false };
    }

    if (datasetKind === "cases") {
      const rule = CASE_RULES.find(
        (r) =>
          r.re.test(header) &&
          !usedCaseUsages.has(r.usage) &&
          (!r.dateOnly || inferred.type === "date"),
      );
      if (rule) {
        usedCaseUsages.add(rule.usage);
        const type: ColumnType = rule.dateOnly
          ? "date"
          : rule.usage === "case_key"
            ? "text"
            : inferred.type;
        return { ...base, type, usage: rule.usage };
      }
    }

    const idLike = ID_HEADER.test(header);
    const dimensionKey = suggestDimension(header, opts.datasetKey);
    // Plain integers under a dimension word are codes (kostnadsställe 100, konto 3010), not amounts.
    const codes =
      dimensionKey !== undefined &&
      inferred.type !== "text" &&
      inferred.type !== "date" &&
      !QUANTITY_HEADER.test(header) &&
      values.every((v) =>
        typeof v === "number" ? Number.isInteger(v) : /^\d+$/.test(valueText(v)),
      );
    if (inferred.type === "date" && !idLike) {
      if (!periodTaken && datasetKind !== "cases") {
        periodTaken = true;
        return { ...base, type: "date", usage: "period" };
      }
      return { ...base, type: "date", usage: "ignore" };
    }
    if (inferred.type !== "text" && inferred.type !== "date" && !idLike && !codes) {
      const metricKey = suggestMetric(header, inferred.type, opts.datasetKey);
      return {
        ...base,
        type: inferred.type,
        usage: "measure",
        ...(metricKey ? { metricKey } : {}),
      };
    }
    if (looksLikeCompanyColumn(header, texts)) return { ...base, type: "text", usage: "company" };

    const distinct = new Set(texts.map((t) => normalizeValue(t))).size;
    const lowCardinality =
      distinct <= LOW_CARDINALITY || distinct / Math.max(1, texts.length) <= 0.5;
    if (idLike || dimensionKey || lowCardinality) {
      // With a known dataset a column that fits none of its dimensions (kön, ärendenummer)
      // has nothing to group on; asking for a grouping would only block saving.
      if (!dimensionKey && opts.datasetKey) return { ...base, type: "text", usage: "ignore" };
      return {
        ...base,
        type: "text",
        usage: "dimension",
        ...(dimensionKey ? { dimensionKey } : {}),
      };
    }
    return { ...base, type: "text", usage: "ignore" };
  });
}

/**
 * True when a column must stay removed: its header says personnummer or its
 * values hold them (columnContainsPersonnummer). The UI disables the "keep" toggle for these.
 */
export function isLockedRemoved(mapping: ColumnMapping, samples: readonly unknown[]): boolean {
  const texts = samples
    .map((v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""))
    .filter((s) => s !== "");
  if (detectPersonalColumn(mapping.column, texts).kind === "pnr") return true;
  return columnContainsPersonnummer(samples);
}
