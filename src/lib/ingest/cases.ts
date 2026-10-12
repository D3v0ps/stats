// Cases: one row per participant/employment with start and end dates, turned
// into monthly counts (active at month end, started, ended, interrupted,
// results, summed tenure). Only counts leave the browser: the key column is
// used for de-duplication and never appears in a fact.
import type {
  CasesTemplateConfig,
  CompanyCode,
  FactDraft,
  MetricTotal,
  ParseIssue,
  SkippedRow,
} from "@/lib/contracts";
import { parseDateSv } from "@/lib/core/dates-sv";
import { dateToMonth, isMonth, monthEndDate, monthRange } from "@/lib/core/month";
import { normalizeValue } from "@/lib/core/normalize";
import { MISSING_LABEL, assertNoPersonnummer, roundSum, sortFacts } from "./aggregate";
import { companyResolver, globalIssue } from "./row-context";
import { valueText, type CellValue, type WorkingTable } from "./working";

export interface CasesChoices {
  company?: CompanyCode;
  /** Export date (YYYY-MM-DD). No month after it is produced, no event after it counted. */
  asOfDate: string;
}

export interface CasesResult {
  facts: FactDraft[];
  issues: ParseIssue[];
  skipped: SkippedRow[];
  /** Cases counted (after de-duplication). */
  rowsUsed: number;
  /** Per metric x company x month (every case metric adds up over groups). */
  totals: MetricTotal[];
}

const RESULT_DIMENSION = "resultattyp";
const DAY_MS = 86_400_000;
const AVG_DAYS_PER_MONTH = 365.25 / 12;
const FALSY = new Set([
  "",
  "nej",
  "no",
  "n",
  "false",
  "falskt",
  "0",
  "-",
  "–",
  "ej",
  "inget",
  "ingen",
]);

interface CaseRow {
  start: string;
  end: string | null;
  /** Known interruption date (null when not interrupted or date unknown). */
  interruptDate: string | null;
  /** Effective end: min(end, interruption date). */
  effEnd: string | null;
  resultLabel: string | null;
  resultDate: string | null;
  company: CompanyCode;
  groupKey: string;
}

interface Group {
  company: CompanyCode;
  dims: Record<string, string>;
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const minDate = (a: string, b: string) => (a < b ? a : b);
const inMonth = (d: string | null, month: string) => d !== null && d.slice(0, 7) === month;

type DateParse = { ok: true; date: string | null } | { ok: false; text: string };

/** Parse a case date; a month alone means its first (start) or last (end) day. */
function parseCaseDate(v: CellValue | undefined, edge: "start" | "end"): DateParse {
  const text = valueText(v);
  if (text === "") return { ok: true, date: null };
  const r = parseDateSv(typeof v === "number" ? v : text);
  if (!r.ok) return { ok: false, text };
  if ("date" in r) return { ok: true, date: r.date };
  return { ok: true, date: edge === "start" ? `${r.month}-01` : monthEndDate(r.month) };
}

/** Marker texts that start by saying no: "Inget avbrott", "Nej, fullföljt", "Ej aktuellt". */
const NEGATIVE_START = /^(?:nej|ej|inget|ingen|no|none)(?=$|[^\p{L}])/u;

function isTruthy(v: CellValue | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const text = normalizeValue(valueText(v));
  return !FALSY.has(text) && !NEGATIVE_START.test(text);
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const r = parseDateSv(s);
  return r.ok && "date" in r && r.date === s;
}

/**
 * Build monthly case facts from fromMonth (default: month of the earliest
 * start) through the month of asOfDate. For the as-of month the snapshot is
 * taken at asOfDate (not a future month end).
 * - active: start <= ref, end null or >= ref, not interrupted on/before ref
 * - started / ended (effective end) / interrupted / results within the month and <= asOfDate
 * - tenureMonthsSum: sum over active cases of the months from start to ref (average
 *   tenure is the formula tenureMonthsSum / active, evaluated after rolling both up)
 */
export function buildCases(
  table: WorkingTable,
  config: CasesTemplateConfig,
  choices: CasesChoices,
): CasesResult {
  const issues: ParseIssue[] = [];
  const skipped: SkippedRow[] = [];
  const c = config.cases;
  const empty = (): CasesResult => ({ facts: [], issues, skipped, rowsUsed: 0, totals: [] });

  if (!isValidIsoDate(choices.asOfDate)) {
    issues.push(globalIssue("", `Exportdatum "${choices.asOfDate}" är inte ett giltigt datum.`));
    return empty();
  }
  const asOf = choices.asOfDate;

  if (!table.columns.includes(c.startColumn)) {
    issues.push(globalIssue(c.startColumn, `Startkolumnen "${c.startColumn}" finns inte.`));
    return empty();
  }
  const optional = (col: string | undefined, label: string): string | undefined => {
    if (!col) return undefined;
    if (table.columns.includes(col)) return col;
    issues.push(globalIssue(col, `${label} "${col}" finns inte.`));
    return undefined;
  };
  const keyCol = optional(c.keyColumn, "Id-kolumnen");
  const endCol = optional(c.endColumn, "Slutkolumnen");
  const interruptCol = optional(c.interruptColumn, "Avbrottskolumnen");
  const interruptDateCol = optional(c.interruptDateColumn, "Avbrottsdatum-kolumnen");
  const resultCol = optional(c.resultColumn, "Resultatkolumnen");
  const resultDateCol = optional(c.resultDateColumn, "Resultatdatum-kolumnen");

  // Group-by columns -> dimension keys. The key column and removed columns are never dimensions.
  const groupCols: { column: string; dim: string }[] = [];
  const usedDims = new Set<string>();
  for (const col of c.groupBy ?? []) {
    if (col === c.keyColumn) {
      issues.push(globalIssue(col, "Id-kolumnen kan inte användas för gruppering."));
      continue;
    }
    if (!table.columns.includes(col)) {
      issues.push(globalIssue(col, `Grupperingskolumnen "${col}" finns inte.`));
      continue;
    }
    const mapping = config.columns.find((m) => m.column === col);
    if (mapping?.keep === false) {
      issues.push(globalIssue(col, `Grupperingskolumnen "${col}" är borttagen och används inte.`));
      continue;
    }
    const dim = mapping?.dimensionKey;
    if (!dim) {
      issues.push(globalIssue(col, `Grupperingskolumnen "${col}" saknar dimension.`));
      continue;
    }
    if (usedDims.has(dim) || (dim === RESULT_DIMENSION && c.metrics.results)) {
      issues.push(globalIssue(col, `Dimensionen "${dim}" används redan.`));
      continue;
    }
    usedDims.add(dim);
    groupCols.push({ column: col, dim });
  }
  groupCols.sort((a, b) => (a.dim < b.dim ? -1 : a.dim > b.dim ? 1 : 0));
  assertNoPersonnummer(
    table,
    groupCols.map((g) => g.column),
  );

  const companyOf = companyResolver(config.company, table, choices.company, issues);
  if (!companyOf) return empty();
  if (c.metrics.tenureMonths) {
    issues.push({
      sourceRow: 0,
      column: "",
      value: "",
      message:
        "Genomsnittlig anställningstid räknas inte längre vid importen. Koppla Anställningsmånader i mallen; snittet räknas fram i rapporterna.",
      severity: "warning",
    });
  }

  const resultMap = new Map<string, string>();
  for (const [raw, label] of Object.entries(c.resultMap ?? {}))
    resultMap.set(normalizeValue(raw), label);
  const resultLabels = [...new Set(resultMap.values())].sort();

  const groups = new Map<string, Group>();
  const cases: CaseRow[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const bad = (detail: string) =>
      skipped.push({ sourceRow: row.sourceRow, reason: "unparseable", detail });
    const start = parseCaseDate(row.values[c.startColumn], "start");
    if (!start.ok) {
      bad(`Ogiltigt startdatum "${start.text}"`);
      continue;
    }
    if (start.date === null) {
      bad("Startdatum saknas");
      continue;
    }
    const end = endCol
      ? parseCaseDate(row.values[endCol], "end")
      : ({ ok: true, date: null } as const);
    if (!end.ok) {
      bad(`Ogiltigt slutdatum "${end.text}"`);
      continue;
    }
    if (end.date !== null && end.date < start.date) {
      bad("Slutdatum före startdatum");
      continue;
    }
    const company = companyOf(row);
    if (!company.ok) {
      bad(company.detail);
      continue;
    }

    // Interruption: a truthy marker, optionally dated by its own column or by a
    // date in the marker. Without a marker column a filled date is the marker.
    let interrupted = false;
    let interruptDate: string | null = null;
    if (interruptCol) {
      const marker = row.values[interruptCol];
      interrupted = isTruthy(marker);
      if (interrupted && !interruptDateCol) {
        const asDate = parseCaseDate(marker, "end");
        if (asDate.ok && asDate.date) interruptDate = asDate.date;
      }
    } else if (interruptDateCol) {
      interrupted = valueText(row.values[interruptDateCol]) !== "";
    }
    if (interrupted && interruptDateCol) {
      const d = parseCaseDate(row.values[interruptDateCol], "end");
      if (d.ok) interruptDate = d.date;
      else {
        issues.push({
          sourceRow: row.sourceRow,
          column: interruptDateCol,
          value: d.text,
          message: "Ogiltigt avbrottsdatum, slutdatum används",
          severity: "warning",
        });
      }
    }
    if (interrupted && interruptDate === null) {
      interruptDate = end.date;
      if (interruptDate === null) {
        issues.push({
          sourceRow: row.sourceRow,
          column: interruptCol ?? "",
          value: valueText(row.values[interruptCol ?? ""]),
          message: "Avbrott utan datum och utan slutdatum: räknas som pågående",
          severity: "warning",
        });
      }
    }
    if (interruptDate !== null && interruptDate < start.date) {
      bad("Avbrott före startdatum");
      continue;
    }
    const effEnd =
      interruptDate !== null ? minDate(end.date ?? interruptDate, interruptDate) : end.date;

    let resultLabel: string | null = null;
    let resultDate: string | null = null;
    if (resultCol) {
      const raw = valueText(row.values[resultCol]);
      resultLabel = raw === "" ? null : (resultMap.get(normalizeValue(raw)) ?? null);
      if (resultLabel) {
        const d = resultDateCol ? parseCaseDate(row.values[resultDateCol], "end") : null;
        if (d && !d.ok) {
          issues.push({
            sourceRow: row.sourceRow,
            column: resultDateCol!,
            value: d.text,
            message: "Ogiltigt resultatdatum, slutdatum används",
            severity: "warning",
          });
        }
        resultDate = d?.ok && d.date ? d.date : effEnd;
        if (!resultDate) {
          issues.push({
            sourceRow: row.sourceRow,
            column: resultCol,
            value: raw,
            message: "Resultat utan datum räknas inte",
            severity: "warning",
          });
        }
      }
    }

    const keyText = keyCol ? valueText(row.values[keyCol]) : "";
    if (keyText !== "") {
      const dedupKey = `${company.value}\u0000${normalizeValue(keyText)}\u0000${start.date}`;
      if (seen.has(dedupKey)) {
        issues.push({
          sourceRow: row.sourceRow,
          column: keyCol!,
          value: "",
          message: "Dubblett (samma id och startdatum) räknas en gång",
          severity: "warning",
        });
        continue;
      }
      seen.add(dedupKey);
    }

    const dims: Record<string, string> = {};
    for (const g of groupCols) dims[g.dim] = valueText(row.values[g.column]) || MISSING_LABEL;
    const groupKey = JSON.stringify([company.value, dims]);
    if (!groups.has(groupKey)) groups.set(groupKey, { company: company.value, dims });

    cases.push({
      start: start.date,
      end: end.date,
      interruptDate,
      effEnd,
      resultLabel,
      resultDate,
      company: company.value,
      groupKey,
    });
  }

  if (cases.length === 0) return empty();

  const lastMonth = dateToMonth(asOf);
  const earliest = cases.reduce((m, x) => minDate(m, x.start), cases[0]!.start);
  const firstMonth = c.fromMonth && isMonth(c.fromMonth) ? c.fromMonth : dateToMonth(earliest);
  if (firstMonth > lastMonth) {
    issues.push({
      sourceRow: 0,
      column: "",
      value: firstMonth,
      message: "Första månaden ligger efter exportdatumet; inga månader att räkna",
      severity: "warning",
    });
    return { ...empty(), rowsUsed: cases.length };
  }

  const m = c.metrics;
  const facts: FactDraft[] = [];
  const totals = new Map<string, MetricTotal>();
  const pushFact = (
    metricKey: string,
    g: Group,
    month: string,
    dims: Record<string, string>,
    value: number,
  ) => {
    facts.push({
      metricKey,
      company: g.company,
      month,
      dims,
      value: roundSum(value),
      sourceRows: [],
    });
  };
  const addTotal = (metricKey: string, company: CompanyCode, month: string, value: number) => {
    const key = `${metricKey}\u0000${company}\u0000${month}`;
    const t = totals.get(key) ?? { metricKey, company, month, value: 0 };
    t.value += value;
    totals.set(key, t);
  };

  const byGroup = new Map<string, CaseRow[]>();
  for (const x of cases) {
    const list = byGroup.get(x.groupKey) ?? [];
    list.push(x);
    byGroup.set(x.groupKey, list);
  }

  for (const month of monthRange(firstMonth, lastMonth)) {
    const monthEnd = monthEndDate(month);
    const ref = minDate(monthEnd, asOf);
    for (const [groupKey, group] of groups) {
      const list = byGroup.get(groupKey) ?? [];
      let active = 0;
      let started = 0;
      let ended = 0;
      let interrupted = 0;
      let tenureSum = 0;
      const results = new Map<string, number>(resultLabels.map((l) => [l, 0]));
      for (const x of list) {
        const isActive =
          x.start <= ref &&
          (x.end === null || x.end >= ref) &&
          !(x.interruptDate !== null && x.interruptDate <= ref);
        if (isActive) {
          active++;
          tenureSum += (toUtc(ref) - toUtc(x.start)) / DAY_MS / AVG_DAYS_PER_MONTH;
        }
        if (inMonth(x.start, month) && x.start <= asOf) started++;
        if (inMonth(x.effEnd, month) && x.effEnd! <= asOf) {
          ended++;
          if (x.interruptDate !== null) interrupted++;
        }
        if (x.resultLabel && inMonth(x.resultDate, month) && x.resultDate! <= asOf) {
          results.set(x.resultLabel, (results.get(x.resultLabel) ?? 0) + 1);
        }
      }
      const counts: [string | undefined, number][] = [
        [m.active, active],
        [m.started, started],
        [m.ended, ended],
        [m.interrupted, interrupted],
      ];
      for (const [metricKey, value] of counts) {
        if (!metricKey) continue;
        pushFact(metricKey, group, month, { ...group.dims }, value);
        addTotal(metricKey, group.company, month, value);
      }
      if (m.results) {
        for (const [label, value] of results) {
          pushFact(m.results, group, month, { ...group.dims, [RESULT_DIMENSION]: label }, value);
          addTotal(m.results, group.company, month, value);
        }
      }
      if (m.tenureMonthsSum) {
        pushFact(m.tenureMonthsSum, group, month, { ...group.dims }, tenureSum);
        addTotal(m.tenureMonthsSum, group.company, month, tenureSum);
      }
    }
  }

  const totalList: MetricTotal[] = [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, t]) => ({
      metricKey: t.metricKey,
      company: t.company,
      month: t.month,
      value: roundSum(t.value),
    }));
  return { facts: sortFacts(facts), issues, skipped, rowsUsed: cases.length, totals: totalList };
}
