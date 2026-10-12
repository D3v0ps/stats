import type { ParseIssue } from "@/lib/contracts";
import { detectDecimalSeparator, parseNumberSv } from "@/lib/core/num-sv";
import type { CellValue } from "../../working";
import type { StepFn } from "../types";
import { done, missingColumns, rowIssue, skip } from "../util";

const neg = (n: number) => (n === 0 ? 0 : -n);

/** Multiply numeric values by -1. Numeric text is parsed first; other text is an error. */
export const negate: StepFn<"negate"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  const col = step.column;
  const hint =
    detectDecimalSeparator(
      table.rows.map((r) => r.values[col]),
      "number",
    ) ?? undefined;
  const issues: ParseIssue[] = [];

  const rows = table.rows.map((row) => {
    const v = row.values[col] ?? null;
    let next: CellValue = v;
    if (typeof v === "number") next = neg(v);
    else if (typeof v === "string") {
      const r = parseNumberSv(v, "number", { decimalSeparator: hint });
      if (!r.ok) {
        issues.push(rowIssue(index, step.op, row.sourceRow, col, v, r.reason));
        return row;
      }
      next = r.value === null ? null : neg(r.value);
    } else if (typeof v === "boolean") {
      issues.push(
        rowIssue(index, step.op, row.sourceRow, col, v, "sant/falskt kan inte byta tecken."),
      );
      return row;
    }
    if (next === v) return row;
    return { sourceRow: row.sourceRow, values: { ...row.values, [col]: next } };
  });
  return done({ ...table, rows }, issues);
};
