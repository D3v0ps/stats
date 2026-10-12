// Shared helpers for step implementations.
import type { ParseIssue, StepOp } from "@/lib/contracts";
import { isSafeColumnName, valueText, type CellValue, type WorkingTable } from "../working";
import type { StepResult } from "./types";

/** Swedish step names, as shown in the mapping view and in issues. */
export const STEP_LABELS: Record<StepOp, string> = {
  rename: "Byt namn",
  drop: "Ta bort kolumn",
  merge: "Slå ihop",
  split: "Dela upp",
  replace: "Ersätt",
  clean: "Rensa",
  lookup: "Översätt",
  filter: "Filtrera bort rader",
  reorder: "Ändra ordning",
  unpivot: "Vrid kolumner till rader",
  fill_down: "Fyll nedåt",
  negate: "Byt tecken",
  constant: "Fast värde",
};

export function stepLabel(index: number, op: StepOp): string {
  return `Steg ${index + 1} (${STEP_LABELS[op]})`;
}

export function done(table: WorkingTable, issues: ParseIssue[] = []): StepResult {
  return { table, issues, skipped: [], unknown: {} };
}

/** Step-level issue (not tied to a row): sourceRow 0. */
export function stepIssue(
  index: number,
  op: StepOp,
  column: string,
  message: string,
  severity: ParseIssue["severity"] = "error",
): ParseIssue {
  return {
    sourceRow: 0,
    column,
    value: "",
    message: `${stepLabel(index, op)}: ${message}`,
    severity,
  };
}

export function rowIssue(
  index: number,
  op: StepOp,
  sourceRow: number,
  column: string,
  value: CellValue | undefined,
  message: string,
  severity: ParseIssue["severity"] = "error",
): ParseIssue {
  return {
    sourceRow,
    column,
    value: valueText(value),
    message: `${stepLabel(index, op)}: ${message}`,
    severity,
  };
}

/** Skip the step: the input table passes through unchanged. */
export function skip(table: WorkingTable, issues: ParseIssue[]): StepResult {
  return done(table, issues);
}

/** Issues for columns the step references but the table lacks; [] when all exist. */
export function missingColumns(
  table: WorkingTable,
  columns: string[],
  index: number,
  op: StepOp,
): ParseIssue[] {
  return columns
    .filter((c) => !table.columns.includes(c))
    .map((c) => stepIssue(index, op, c, `kolumnen "${c}" finns inte.`));
}

/** Issues for new column names that are unsafe or already taken (except `allowed`). */
export function badNewColumns(
  table: WorkingTable,
  names: string[],
  index: number,
  op: StepOp,
  allowed: string[] = [],
): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!isSafeColumnName(name)) {
      issues.push(stepIssue(index, op, name, `ogiltigt kolumnnamn "${name}".`));
    } else if (seen.has(name)) {
      issues.push(stepIssue(index, op, name, `kolumnen "${name}" anges flera gånger.`));
    } else if (table.columns.includes(name) && !allowed.includes(name)) {
      issues.push(stepIssue(index, op, name, `kolumnen "${name}" finns redan.`));
    }
    seen.add(name);
  }
  return issues;
}

export function isBlank(v: CellValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** New headers map: drop `remove`, add `add` (display = name). Undefined stays undefined. */
export function nextHeaders(
  table: WorkingTable,
  remove: string[],
  add: string[],
): Record<string, string> | undefined {
  if (!table.headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(table.headers)) if (!remove.includes(k)) out[k] = v;
  for (const name of add) out[name] = name;
  return out;
}

export function withHeaders(
  columns: string[],
  rows: WorkingTable["rows"],
  headers: Record<string, string> | undefined,
): WorkingTable {
  return headers ? { columns, rows, headers } : { columns, rows };
}

/** Swedish-aware case folding for comparisons. */
export function fold(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLocaleLowerCase("sv");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
