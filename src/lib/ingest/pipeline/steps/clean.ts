import type { ParseIssue } from "@/lib/contracts";
import { detectDecimalSeparator, parseNumberSv } from "@/lib/core/num-sv";
import type { CellValue } from "../../working";
import type { StepFn } from "../types";
import { done, missingColumns, rowIssue, skip } from "../util";

/**
 * Strip formatting. Numeric kinds parse with num-sv ("8,5 h" -> 8.5,
 * "1 200 kr" -> 1200, "12 %" -> 12); unparseable cells keep their original
 * value and produce an error issue, never a guess. "trim" collapses whitespace.
 */
export const clean: StepFn<"clean"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  const col = step.column;

  if (step.as === "trim") {
    const rows = table.rows.map((row) => {
      const v = row.values[col] ?? null;
      if (typeof v !== "string") return row;
      const t = v.replace(/\s+/g, " ").trim();
      const next = t === "" ? null : t;
      if (next === v) return row;
      return { sourceRow: row.sourceRow, values: { ...row.values, [col]: next } };
    });
    return done({ ...table, rows });
  }

  const kind = step.as;
  const hint =
    detectDecimalSeparator(
      table.rows.map((r) => r.values[col]),
      kind,
    ) ?? undefined;
  const issues: ParseIssue[] = [];
  const rows = table.rows.map((row) => {
    const v = row.values[col] ?? null;
    if (v === null || typeof v === "number") return row;
    const r = parseNumberSv(v, kind, { decimalSeparator: hint });
    if (!r.ok) {
      issues.push(rowIssue(index, step.op, row.sourceRow, col, v, r.reason));
      return row;
    }
    const next: CellValue = r.value;
    return { sourceRow: row.sourceRow, values: { ...row.values, [col]: next } };
  });
  return done({ ...table, rows }, issues);
};
