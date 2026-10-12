import type { CellValue, WorkingRow } from "../../working";
import type { StepFn } from "../types";
import {
  badNewColumns,
  done,
  isBlank,
  missingColumns,
  nextHeaders,
  skip,
  withHeaders,
} from "../util";

/**
 * Wide -> long: each listed column becomes one row per source row, with the
 * column's header text in `nameColumn` and its value in `valueColumn`. Other
 * columns are repeated. Empty values produce no row (like Excel/Power Query).
 */
export const unpivot: StepFn<"unpivot"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, step.columns, index, step.op);
  if (missing.length) return skip(table, missing);
  const bad = badNewColumns(
    table,
    [step.nameColumn, step.valueColumn],
    index,
    step.op,
    step.columns,
  );
  if (bad.length) return skip(table, bad);

  const pivoted = new Set(step.columns);
  const firstPos = table.columns.findIndex((c) => pivoted.has(c));
  const kept = table.columns.filter((c) => !pivoted.has(c));
  const columns: string[] = [];
  table.columns.forEach((c, i) => {
    if (i === firstPos) columns.push(step.nameColumn, step.valueColumn);
    if (!pivoted.has(c)) columns.push(c);
  });

  const rows: WorkingRow[] = [];
  for (const row of table.rows) {
    for (const c of step.columns) {
      const v = row.values[c];
      if (isBlank(v)) continue;
      const values: Record<string, CellValue> = {};
      for (const k of kept) values[k] = row.values[k] ?? null;
      values[step.nameColumn] = table.headers?.[c] ?? c;
      values[step.valueColumn] = v ?? null;
      rows.push({ sourceRow: row.sourceRow, values });
    }
  }
  return done(
    withHeaders(
      columns,
      rows,
      nextHeaders(table, step.columns, [step.nameColumn, step.valueColumn]),
    ),
  );
};
