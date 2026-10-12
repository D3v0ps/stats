// Table aggregation: typed rows (after steps) -> monthly facts. Only these
// aggregates (plus source row numbers) ever leave the browser.
import type {
  ColumnMapping,
  ColumnType,
  CompanyCode,
  FactDraft,
  ParseIssue,
  SkippedRow,
  TableTemplateConfig,
  UploadChoices,
} from "@/lib/contracts";
import { detectDecimalSeparator, parseNumberSv, type NumberKind } from "@/lib/core/num-sv";
import { valueContainsPersonnummer } from "@/lib/core/pnr";
import { companyResolver, globalIssue, periodResolver } from "./row-context";
import { valueText, type WorkingTable } from "./working";

/** Label used for an empty dimension cell (an empty label is not allowed). */
export const MISSING_LABEL = "(saknas)";

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
  /** Rows that contributed to at least one fact. */
  rowsUsed: number;
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

/** Throw PersonalDataError if any value in the given columns contains a personnummer. */
export function assertNoPersonnummer(table: WorkingTable, columns: string[]): void {
  for (const column of columns) {
    for (const row of table.rows) {
      if (valueContainsPersonnummer(row.values[column])) throw new PersonalDataError(column);
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
): AggregateResult {
  const issues: ParseIssue[] = [];
  const skipped: SkippedRow[] = [];
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
    for (const row of table.rows) {
      skipped.push({
        sourceRow: row.sourceRow,
        reason: "unparseable",
        detail: "Bolag eller månad saknas",
      });
    }
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
  let rowsUsed = 0;
  for (const row of table.rows) {
    const month = monthOf(row);
    if (!month.ok) {
      skipped.push({ sourceRow: row.sourceRow, reason: "unparseable", detail: month.detail });
      continue;
    }
    const company = companyOf(row);
    if (!company.ok) {
      skipped.push({ sourceRow: row.sourceRow, reason: "unparseable", detail: company.detail });
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
    if (contributed) rowsUsed++;
  }

  const facts: FactDraft[] = [...groups.values()].map((g) => ({
    metricKey: g.metricKey,
    company: g.company,
    month: g.month,
    dims: { ...g.dims },
    value: roundSum(g.value),
    sourceRows: [...g.rows].sort((a, b) => a - b),
  }));
  return { facts: sortFacts(facts), issues, skipped, rowsUsed };
}
