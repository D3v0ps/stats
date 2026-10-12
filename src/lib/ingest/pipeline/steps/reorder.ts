import type { StepFn } from "../types";
import { done, missingColumns, skip, stepIssue } from "../util";

/** Put the listed columns first, in the given order; the rest keep their order after them. */
export const reorder: StepFn<"reorder"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, step.order, index, step.op);
  if (missing.length) return skip(table, missing);
  const dupes = step.order.filter((c, i) => step.order.indexOf(c) !== i);
  if (dupes.length) {
    return skip(
      table,
      [...new Set(dupes)].map((c) =>
        stepIssue(index, step.op, c, `kolumnen "${c}" förekommer flera gånger.`),
      ),
    );
  }
  const listed = new Set(step.order);
  const columns = [...step.order, ...table.columns.filter((c) => !listed.has(c))];
  return done({ ...table, columns });
};
