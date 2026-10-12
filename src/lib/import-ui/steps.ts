// Column bookkeeping over pipeline steps: which columns a step reads, creates
// and removes, renaming references, and a plain-Swedish sentence per step for
// the step list in the mapping view.
import { SEEDED_DIMENSIONS, type Step } from "@/lib/contracts";

/** Columns the step reads (they must exist before it runs). */
export function stepInputs(step: Step): string[] {
  switch (step.op) {
    case "merge":
      return [...step.columns];
    case "unpivot":
      return [...step.columns];
    case "reorder":
      return [...step.order];
    case "constant":
      return [];
    default:
      return [step.column];
  }
}

/** Columns the step creates. */
export function stepOutputs(step: Step): string[] {
  switch (step.op) {
    case "rename":
      return [step.to];
    case "merge":
      return [step.into];
    case "split":
      return [...step.into];
    case "unpivot":
      return [step.nameColumn, step.valueColumn];
    case "constant":
      return [step.column];
    default:
      return [];
  }
}

/** Columns that no longer exist after the step. */
export function stepRemoves(step: Step): string[] {
  switch (step.op) {
    case "rename":
      return step.to === step.column ? [] : [step.column];
    case "drop":
      return [step.column];
    case "merge":
      return step.columns.filter((c) => c !== step.into);
    case "split":
      return step.into.includes(step.column) ? [] : [step.column];
    case "unpivot":
      return step.columns.filter((c) => c !== step.nameColumn && c !== step.valueColumn);
    default:
      return [];
  }
}

/** Dimensions whose lookup tables the steps need ("Översätt med uppslagstabell"). */
export function lookupDimensions(steps: readonly Step[]): string[] {
  return [...new Set(steps.flatMap((s) => (s.op === "lookup" ? [s.dimension] : [])))];
}

/** True when any of the steps reads the column. */
export function stepsReference(steps: readonly Step[], column: string): boolean {
  return steps.some((s) => stepInputs(s).includes(column));
}

/** The step with every read of `from` pointed at `to` (created names are left alone). */
export function renameInStep(step: Step, from: string, to: string): Step {
  const r = (c: string) => (c === from ? to : c);
  switch (step.op) {
    case "merge":
      return { ...step, columns: step.columns.map(r) };
    case "unpivot":
      return { ...step, columns: step.columns.map(r) };
    case "reorder":
      return { ...step, order: step.order.map(r) };
    case "constant":
      return step;
    default:
      return step.column === from ? { ...step, column: to } : step;
  }
}

export function renameInSteps(steps: readonly Step[], from: string, to: string): Step[] {
  return steps.map((s) => renameInStep(s, from, to));
}

const q = (s: string) => `”${s}”`;

function list(items: string[]): string {
  const quoted = items.map(q);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} och ${quoted[quoted.length - 1]}`;
}

const CLEAN_LABELS = {
  number: "tal",
  amount: "belopp",
  hours: "timmar",
  percent: "procent",
  trim: "text",
} as const;

const FILTER_LABELS = {
  equals: "är",
  not_equals: "inte är",
  contains: "innehåller",
  empty: "är tom",
  not_empty: "inte är tom",
} as const;

export interface DescribeOptions {
  /** Display name of a column (defaults to the working name). */
  columnLabel?: (column: string) => string;
  /** Display name of a dimension (defaults to the seeded label or the key). */
  dimensionLabel?: (key: string) => string;
}

/** One plain-Swedish sentence describing what the step does. */
export function describeStep(step: Step, opts: DescribeOptions = {}): string {
  const c = opts.columnLabel ?? ((x: string) => x);
  const dim =
    opts.dimensionLabel ??
    ((key: string) =>
      (SEEDED_DIMENSIONS as Record<string, { label: string } | undefined>)[key]?.label ?? key);
  switch (step.op) {
    case "rename":
      return `Byt namn på ${q(c(step.column))} till ${q(step.to)}`;
    case "drop":
      return `Ta bort kolumnen ${q(c(step.column))}`;
    case "merge":
      return `Slå ihop ${list(step.columns.map(c))} till ${q(step.into)}`;
    case "split": {
      const how =
        step.mode === "year_month"
          ? " (år och månad)"
          : step.mode === "last_first"
            ? " (efternamn, förnamn)"
            : ` vid ${q(step.delimiter ?? "")}`;
      return `Dela upp ${q(c(step.column))} i ${list(step.into)}${how}`;
    }
    case "replace":
      return `Ersätt ${q(step.find)} med ${q(step.replace)} i ${q(c(step.column))}${
        step.match === "whole_cell" ? " (hela cellen)" : ""
      }`;
    case "clean":
      return `Rensa formatet i ${q(c(step.column))} (${CLEAN_LABELS[step.as]})`;
    case "lookup":
      return `Översätt ${q(c(step.column))} med uppslagstabellen för ${dim(step.dimension)}`;
    case "filter": {
      const needsValue =
        step.operator === "equals" ||
        step.operator === "not_equals" ||
        step.operator === "contains";
      return `Ta bort rader där ${q(c(step.column))} ${FILTER_LABELS[step.operator]}${
        needsValue ? ` ${q(step.value ?? "")}` : ""
      }`;
    }
    case "reorder":
      return "Ändra kolumnernas ordning";
    case "unpivot":
      return `Vrid ${step.columns.length === 1 ? "1 kolumn" : `${step.columns.length} kolumner`} till rader: rubriken i ${q(step.nameColumn)}, värdet i ${q(step.valueColumn)}`;
    case "fill_down":
      return `Fyll tomma celler i ${q(c(step.column))} med värdet ovanför`;
    case "negate":
      return `Vänd tecken på ${q(c(step.column))}`;
    case "constant":
      return `Lägg till ${q(step.column)} med värdet ${q(step.value)}`;
  }
}
