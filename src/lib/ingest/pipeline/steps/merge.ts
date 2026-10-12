import { valueText, type CellValue } from "../../working";
import type { StepFn } from "../types";
import { badNewColumns, done, missingColumns, nextHeaders, skip, withHeaders } from "../util";

/**
 * Join the non-empty values of several columns with a separator into one
 * column, placed where the first source column was. Source columns are removed.
 */
export const merge: StepFn<"merge"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, step.columns, index, step.op);
  if (missing.length) return skip(table, missing);
  const bad = badNewColumns(table, [step.into], index, step.op, step.columns);
  if (bad.length) return skip(table, bad);

  const sources = new Set(step.columns);
  const firstPos = table.columns.findIndex((c) => sources.has(c));
  const columns: string[] = [];
  table.columns.forEach((c, i) => {
    if (i === firstPos) columns.push(step.into);
    if (!sources.has(c)) columns.push(c);
  });

  const rows = table.rows.map((row) => {
    const parts = step.columns.map((c) => valueText(row.values[c])).filter((s) => s !== "");
    const values: Record<string, CellValue> = {};
    for (const c of columns) {
      values[c] =
        c === step.into
          ? parts.length
            ? parts.join(step.separator)
            : null
          : (row.values[c] ?? null);
    }
    return { sourceRow: row.sourceRow, values };
  });
  return done(withHeaders(columns, rows, nextHeaders(table, step.columns, [step.into])));
};
