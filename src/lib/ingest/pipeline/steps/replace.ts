import { valueText, type CellValue } from "../../working";
import type { StepFn } from "../types";
import { done, escapeRegExp, fold, missingColumns, skip, stepIssue } from "../util";

/**
 * Replace text in a column. contains: every occurrence inside the cell;
 * whole_cell: the entire (trimmed) cell, where an empty `find` matches empty
 * cells. Case-insensitive unless caseSensitive. Untouched cells keep their type.
 */
export const replace: StepFn<"replace"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  const caseSensitive = step.caseSensitive ?? false;
  if (step.match === "contains" && step.find === "") {
    return skip(table, [stepIssue(index, step.op, step.column, "sökvärdet är tomt.", "warning")]);
  }

  const toValue = (s: string): CellValue => (s.trim() === "" ? null : s);
  const pattern =
    step.match === "contains"
      ? new RegExp(escapeRegExp(step.find), caseSensitive ? "gu" : "giu")
      : null;
  const wanted = fold(step.find.trim(), caseSensitive);

  const rows = table.rows.map((row) => {
    const v = row.values[step.column] ?? null;
    let next: CellValue = v;
    const text = valueText(v);
    if (pattern) {
      if (text !== "") {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          pattern.lastIndex = 0;
          next = toValue(text.replace(pattern, () => step.replace));
        }
      }
    } else if (fold(text, caseSensitive) === wanted) {
      next = toValue(step.replace);
    }
    if (next === v) return row;
    return { sourceRow: row.sourceRow, values: { ...row.values, [step.column]: next } };
  });
  return done({ ...table, rows });
};
