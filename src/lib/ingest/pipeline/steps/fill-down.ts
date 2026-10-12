import type { CellValue } from "../../working";
import type { StepFn } from "../types";
import { done, isBlank, missingColumns, skip } from "../util";

/** Fill empty cells with the nearest value above (grouped reports, merged cells). */
export const fillDown: StepFn<"fill_down"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);

  let last: CellValue = null;
  const rows = table.rows.map((row) => {
    const v = row.values[step.column] ?? null;
    if (!isBlank(v)) {
      last = v;
      return row;
    }
    if (last === null) return row;
    return { sourceRow: row.sourceRow, values: { ...row.values, [step.column]: last } };
  });
  return done({ ...table, rows });
};
