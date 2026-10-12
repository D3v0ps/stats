// Table aggregation: typed rows (after steps) -> monthly facts. Only these
// aggregates (plus source row numbers) ever leave the browser.
import {
  BUDGET_METRIC_KEY,
  type BudgetSign,
  type ColumnMapping,
  type ColumnType,
  type CompanyCode,
  type FactDraft,
  type ParseIssue,
  type SkippedRow,
  type TableTemplateConfig,
  type UploadChoices,
} from "@/lib/contracts";
import { normalizeValue } from "@/lib/core/normalize";
import { detectDecimalSeparator, parseNumberSv, type NumberKind } from "@/lib/core/num-sv";
import { columnContainsPersonnummer } from "@/lib/core/pnr";
import { companyResolver, globalIssue, periodResolver } from "./row-context";
import { valueText, type WorkingTable } from "./working";

/** Label used for an empty dimension cell (an empty label is not allowed). */
export const MISSING_LABEL = "(saknas)";

/** Dimension whose labels name the account group of a budget amount. */
const KONTOGRUPP = "kontogrupp";

/** Thrown when a column that would be stored contains personnummer. */
export class PersonalDataError extends Error {
  override name = "PersonalDataError";
  constructor(readonly column: string) {
    super(`Kolumnen "${column}" innehåller personnummer och kan inte användas.`);
  }
}

export interface AggregateResult {
  facts: FactDraft[];
  issues: ParseIssue[];
  skipped: SkippedRow[];
  /** Source rows that contributed to at least one fact (counted once after unpivot). */
  rowsUsed: number;
}

export interface AggregateOptions {
  /** Account group key -> sign (revenue -1). Needed when a template sets budgetSign "positive". */
  accountGroupSigns?: Record<string, 1 | -1>;
  /** Account group key -> name, so kontogrupp labels written as names ("Intäkter") resolve too. */
  accountGroupNames?: Record<string, string>;
}

/**
 * The account group a kontogrupp label stands for: its key or its name, compared after
 * normalizeValue (case, whitespace). null when nothing matches.
 */
export function resolveAccountGroupKey(
  label: string,
  signs: Record<string, 1 | -1>,
  names: Record<string, string> = {},
): string | null {
  const norm = normalizeValue(label);
  for (const key of Object.keys(signs)) {
    if (normalizeValue(key) === norm) return key;
  }
  for (const key of Object.keys(signs)) {
    const name = names[key];
    if (name !== undefined && normalizeValue(name) === norm) return key;
  }
  return null;
}

/**
 * Bring budget_belopp facts to bookkeeping (SIE) sign, the sign they are stored in:
 * "result" files (revenue +, costs −) are negated, "positive" files are multiplied by
 * the kontogrupp's account-group sign, "ledger" (or no setting) is left as is. Facts
 * whose account group can't be told are dropped with an error, never stored with a
 * guessed sign. Other metrics pass through.
 */
export function applyBudgetSign(
  facts: FactDraft[],
  budgetSign: BudgetSign | undefined,
  opts: AggregateOptions & { kontogruppColumn?: string } = {},
): { facts: FactDraft[]; issues: ParseIssue[] } {
  if (budgetSign === undefined || budgetSign === "ledger") return { facts, issues: [] };
  if (!facts.some((f) => f.metricKey === BUDGET_METRIC_KEY)) return { facts, issues: [] };
  if (budgetSign === "result") {
    return {
      facts: facts.map((f) =>
        f.metricKey === BUDGET_METRIC_KEY ? { ...f, value: roundSum(-f.value) } : f,
      ),
      issues: [],
    };
  }

  const issues: ParseIssue[] = [];
  const signs = opts.accountGroupSigns;
  const column = opts.kontogruppColumn ?? KONTOGRUPP;
  if (!signs || Object.keys(signs).length === 0) {
    issues.push(
      globalIssue(column, "Kontogruppernas tecken saknas, så budgetbeloppen kan inte vändas rätt."),
    );
  } else if (!facts.some((f) => f.metricKey === BUDGET_METRIC_KEY && KONTOGRUPP in f.dims)) {
    issues.push(
      globalIssue(column, "Budget med bara positiva belopp behöver en kolumn för kontogrupp."),
    );
  }
  const unknown = new Map<string, number>();
  const out: FactDraft[] = [];
  for (const f of facts) {
    if (f.metricKey !== BUDGET_METRIC_KEY) {
      out.push(f);
      continue;
    }
    const label = f.dims[KONTOGRUPP];
    if (!signs || label === undefined) continue;
    const key = resolveAccountGroupKey(label, signs, opts.accountGroupNames);
    if (key === null) {
      if (!unknown.has(label)) unknown.set(label, f.sourceRows[0] ?? 0);
      continue;
    }
    out.push({ ...f, value: roundSum(f.value * signs[key]!) });
  }
  for (const [label, sourceRow] of unknown) {
    issues.push({
      sourceRow,
      column,
      value: label,
      message: `Okänd kontogrupp "${label}": beloppen räknas inte. Använd kontogruppens namn eller nyckel.`,
      severity: "error",
    });
  }
  return { facts: out, issues };
}

const KIND_BY_TYPE: Record<ColumnType, NumberKind> = {
  number: "number",
  amount: "amount",
  hours: "hours",
  percent: "percent",
  text: "number",
  date: "number",
};

/** Round away float noise from summing (0.1 + 0.2) without losing real precision. */
export function roundSum(x: number): number {
  const r = Number(x.toPrecision(15));
  return Object.is(r, -0) ? 0 : r;
}

/** Throw PersonalDataError if any of the given columns holds personnummer (see columnContainsPersonnummer). */
export function assertNoPersonnummer(table: WorkingTable, columns: string[]): void {
  for (const column of columns) {
    if (columnContainsPersonnummer(table.rows.map((row) => row.values[column]))) {
      throw new PersonalDataError(column);
    }
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Facts in a canonical order: metric, company, month, then dims. */
export function sortFacts<
  T extends { metricKey: string; company: string; month: string; dims: object },
>(facts: T[]): T[] {
  const dimKey = (f: T) =>
    JSON.stringify(Object.entries(f.dims).sort(([a], [b]) => compareStrings(a, b)));
  return [...facts].sort(
    (a, b) =>
      compareStrings(a.metricKey, b.metricKey) ||
      compareStrings(a.company, b.company) ||
      compareStrings(a.month, b.month) ||
      compareStrings(dimKey(a), dimKey(b)),
  );
}

interface Accumulator {
  metricKey: string;
  company: CompanyCode;
  month: string;
  dims: Record<string, string>;
  value: number;
  rows: Set<number>;
}

/**
 * Aggregate a table into facts grouped by (metric, company, month, all kept
 * dimensions). Measures are parsed by their column type; unparseable cells are
 * reported and excluded, never guessed. Rows without period or company are
 * skipped. Counters add 1 per row.
 */
export function aggregateTable(
  table: WorkingTable,
  config: TableTemplateConfig,
  choices: UploadChoices,
  opts: AggregateOptions = {},
): AggregateResult {
  const issues: ParseIssue[] = [];
  const skipped: SkippedRow[] = [];
  // After unpivot several working rows share a source row; report it once.
  const skippedRows = new Set<number>();
  const skip = (sourceRow: number, detail: string) => {
    if (skippedRows.has(sourceRow)) return;
    skippedRows.add(sourceRow);
    skipped.push({ sourceRow, reason: "unparseable", detail });
  };
  const kept = config.columns.filter((m) => m.keep !== false);

  const present = (m: ColumnMapping): boolean => {
    if (table.columns.includes(m.column)) return true;
    issues.push(globalIssue(m.column, `Kolumnen "${m.column}" finns inte i filen.`));
    return false;
  };

  const measures = kept
    .filter((m) => m.usage === "measure" && present(m))
    .filter((m) => {
      if (m.metricKey) return true;
      issues.push(globalIssue(m.column, `Kolumnen "${m.column}" saknar mått.`));
      return false;
    });
  const usedDims = new Set<string>();
  const dimensions = kept
    .filter((m) => m.usage === "dimension" && present(m))
    .filter((m) => {
      if (!m.dimensionKey) {
        issues.push(globalIssue(m.column, `Kolumnen "${m.column}" saknar dimension.`));
        return false;
      }
      if (usedDims.has(m.dimensionKey)) {
        issues.push(
          globalIssue(
            m.column,
            `Dimensionen "${m.dimensionKey}" är redan kopplad till en annan kolumn.`,
          ),
        );
        return false;
      }
      usedDims.add(m.dimensionKey);
      return true;
    });

  assertNoPersonnummer(
    table,
    [...measures, ...dimensions].map((m) => m.column),
  );

  const companyOf = companyResolver(config.company, table, choices.company, issues);
  const monthOf = periodResolver(config.period, table, choices.month, issues);
  if (!companyOf || !monthOf) {
    for (const row of table.rows) skip(row.sourceRow, "Bolag eller månad saknas");
    return { facts: [], issues, skipped, rowsUsed: 0 };
  }

  const hints = new Map(
    measures.map((m) => [
      m.column,
      detectDecimalSeparator(
        table.rows.map((r) => r.values[m.column]),
        KIND_BY_TYPE[m.type],
      ) ?? undefined,
    ]),
  );

  const groups = new Map<string, Accumulator>();
  const add = (
    metricKey: string,
    company: CompanyCode,
    month: string,
    dims: Record<string, string>,
    dimsKey: string,
    value: number,
    sourceRow: number,
  ) => {
    const key = `${metricKey}\u0000${company}\u0000${month}\u0000${dimsKey}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = { metricKey, company, month, dims, value: 0, rows: new Set() };
      groups.set(key, acc);
    }
    acc.value += value;
    acc.rows.add(sourceRow);
  };

  // Sorted once so every fact's dims object has the same key order.
  const dimsInOrder = [...dimensions].sort((a, b) =>
    compareStrings(a.dimensionKey!, b.dimensionKey!),
  );
  const usedRows = new Set<number>();
  for (const row of table.rows) {
    const month = monthOf(row);
    if (!month.ok) {
      skip(row.sourceRow, month.detail);
      continue;
    }
    const company = companyOf(row);
    if (!company.ok) {
      skip(row.sourceRow, company.detail);
      continue;
    }

    const dims: Record<string, string> = {};
    for (const m of dimsInOrder)
      dims[m.dimensionKey!] = valueText(row.values[m.column]) || MISSING_LABEL;
    const dimsKey = JSON.stringify(dims);

    let contributed = false;
    for (const m of measures) {
      const v = row.values[m.column];
      let value: number | null;
      if (typeof v === "number") value = Number.isFinite(v) ? v : null;
      else if (typeof v === "boolean") {
        issues.push({
          sourceRow: row.sourceRow,
          column: m.column,
          value: String(v),
          message: "Sant/falskt är inte ett tal",
          severity: "error",
        });
        continue;
      } else {
        const r = parseNumberSv(v ?? null, KIND_BY_TYPE[m.type], {
          decimalSeparator: hints.get(m.column),
        });
        if (!r.ok) {
          issues.push({
            sourceRow: row.sourceRow,
            column: m.column,
            value: valueText(v),
            message: r.reason,
            severity: "error",
          });
          continue;
        }
        value = r.value;
      }
      if (value === null) continue;
      add(m.metricKey!, company.value, month.value, dims, dimsKey, value, row.sourceRow);
      contributed = true;
    }
    for (const counter of config.counters ?? []) {
      add(counter.metricKey, company.value, month.value, dims, dimsKey, 1, row.sourceRow);
      contributed = true;
    }
    if (contributed) usedRows.add(row.sourceRow);
  }

  const aggregated: FactDraft[] = [...groups.values()].map((g) => ({
    metricKey: g.metricKey,
    company: g.company,
    month: g.month,
    dims: { ...g.dims },
    value: roundSum(g.value),
    sourceRows: [...g.rows].sort((a, b) => a - b),
  }));
  const signed = applyBudgetSign(aggregated, config.budgetSign, {
    ...opts,
    kontogruppColumn: dimensions.find((m) => m.dimensionKey === KONTOGRUPP)?.column,
  });
  issues.push(...signed.issues);
  const rowsUsed =
    signed.facts.length === aggregated.length
      ? usedRows.size
      : new Set(signed.facts.flatMap((f) => f.sourceRows)).size;
  return { facts: sortFacts(signed.facts), issues, skipped, rowsUsed };
}
