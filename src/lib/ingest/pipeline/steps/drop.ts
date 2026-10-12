import type { CellValue } from "../../working";
import type { StepFn } from "../types";
import { done, missingColumns, nextHeaders, skip, withHeaders } from "../util";

/** Remove a column (its values never leave the browser). */
export const drop: StepFn<"drop"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);

  const columns = table.columns.filter((c) => c !== step.column);
  const rows = table.rows.map((row) => {
    const values: Record<string, CellValue> = {};
    for (const c of columns) values[c] = row.values[c] ?? null;
    return { sourceRow: row.sourceRow, values };
  });
  return done(withHeaders(columns, rows, nextHeaders(table, [step.column], [])));
};
