import type { StepFn } from "../types";
import { badNewColumns, done, nextHeaders, skip, withHeaders } from "../util";

/** Add a column with the same value on every row, e.g. Verksamhet = "Bemanning". */
export const constant: StepFn<"constant"> = (table, step, _ctx, index) => {
  const bad = badNewColumns(table, [step.column], index, step.op);
  if (bad.length) return skip(table, bad);
  const value = step.value.trim() === "" ? null : step.value;
  const columns = [...table.columns, step.column];
  const rows = table.rows.map((row) => ({
    sourceRow: row.sourceRow,
    values: { ...row.values, [step.column]: value },
  }));
  return done(withHeaders(columns, rows, nextHeaders(table, [], [step.column])));
};
