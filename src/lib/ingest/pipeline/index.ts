// The mapping pipeline: a template's steps applied in order to a working
// table. Steps are pure and deterministic, so undo is simply replaying a
// prefix of the step list on the original table.
import type { ParseIssue, SkippedRow, Step, StepOp } from "@/lib/contracts";
import { valueText, type WorkingTable } from "../working";
import { STEP_IMPLEMENTATIONS } from "./steps";
import type { ApplyResult, StepContext, StepFn, StepResult } from "./types";
import { skip, stepIssue } from "./util";

export type { AliasTables, ApplyResult, StepContext, StepResult } from "./types";
export { STEP_LABELS, stepLabel } from "./util";

/** Apply a single step (index is 0-based, used in messages). */
export function applyStep(
  table: WorkingTable,
  step: Step,
  ctx: StepContext,
  index = 0,
): StepResult {
  const impl = STEP_IMPLEMENTATIONS[step.op] as StepFn<StepOp> | undefined;
  if (!impl) {
    const op = (step as { op?: unknown }).op;
    return skip(table, [
      {
        sourceRow: 0,
        column: "",
        value: String(op),
        message: `Steg ${index + 1}: okänd operation "${String(op)}".`,
        severity: "error",
      },
    ]);
  }
  try {
    return impl(table, step as never, ctx, index);
  } catch (error) {
    // A step must never take the whole import down; report and continue.
    const message = error instanceof Error ? error.message : String(error);
    return skip(table, [stepIssue(index, step.op, "", `oväntat fel (${message}).`)]);
  }
}

/**
 * Apply steps in order. Steps referencing missing columns are skipped with an
 * error issue. unknownLookups lists values the lookups could not translate and
 * that are still present in the final table.
 */
export function applySteps(table: WorkingTable, steps: Step[], ctx: StepContext): ApplyResult {
  let current = table;
  const issues: ParseIssue[] = [];
  const skipped: SkippedRow[] = [];
  const unknown = new Map<string, string[]>();

  steps.forEach((step, i) => {
    const r = applyStep(current, step, ctx, i);
    current = r.table;
    issues.push(...r.issues);
    skipped.push(...r.skipped);
    for (const [dim, values] of Object.entries(r.unknown)) {
      const list = unknown.get(dim) ?? [];
      for (const v of values) if (!list.includes(v)) list.push(v);
      unknown.set(dim, list);
    }
  });

  const present = new Set<string>();
  if (unknown.size > 0) {
    for (const row of current.rows) {
      for (const c of current.columns) present.add(valueText(row.values[c]));
    }
  }
  const unknownLookups: Record<string, string[]> = {};
  for (const [dim, values] of unknown) {
    const still = values.filter((v) => present.has(v));
    if (still.length) unknownLookups[dim] = still;
  }
  return { table: current, unknownLookups, issues, skipped };
}

/**
 * Undo support: the table after the first `count` steps. Because steps are
 * pure, this equals applying all steps and undoing the remaining ones.
 */
export function replaySteps(
  table: WorkingTable,
  steps: Step[],
  count: number,
  ctx: StepContext,
): ApplyResult {
  return applySteps(table, steps.slice(0, Math.max(0, count)), ctx);
}
