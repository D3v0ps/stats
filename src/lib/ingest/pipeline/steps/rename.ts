import type { CellValue } from "../../working";
import type { StepFn } from "../types";
import { badNewColumns, done, missingColumns, nextHeaders, skip, withHeaders } from "../util";

/** Rename a column; the new name must be free. */
export const rename: StepFn<"rename"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  if (step.to === step.column) return done(table);
  const bad = badNewColumns(table, [step.to], index, step.op);
  if (bad.length) return skip(table, bad);

  const columns = table.columns.map((c) => (c === step.column ? step.to : c));
  const rows = table.rows.map((row) => {
    const values: Record<string, CellValue> = {};
    for (const c of table.columns) values[c === step.column ? step.to : c] = row.values[c] ?? null;
    return { sourceRow: row.sourceRow, values };
  });
  return done(withHeaders(columns, rows, nextHeaders(table, [step.column], [step.to])));
};
