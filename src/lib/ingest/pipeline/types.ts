import type { ParseIssue, SkippedRow, Step, StepOp } from "@/lib/contracts";
import type { WorkingTable } from "../working";

/** dimension key -> normalized alias -> canonical label. */
export type AliasTables = Record<string, Record<string, string>>;

export interface StepContext {
  aliases: AliasTables;
}

export interface StepResult {
  table: WorkingTable;
  issues: ParseIssue[];
  /** Rows removed by the step (filter). */
  skipped: SkippedRow[];
  /** dimension key -> values the lookup could not translate (first-seen order). */
  unknown: Record<string, string[]>;
}

export type StepOf<O extends StepOp> = Extract<Step, { op: O }>;

/** A step implementation: pure, never mutates its input. `index` is 0-based. */
export type StepFn<O extends StepOp> = (
  table: WorkingTable,
  step: StepOf<O>,
  ctx: StepContext,
  index: number,
) => StepResult;

export interface ApplyResult {
  table: WorkingTable;
  unknownLookups: Record<string, string[]>;
  issues: ParseIssue[];
  /** Rows removed by filter steps. */
  skipped: SkippedRow[];
}
