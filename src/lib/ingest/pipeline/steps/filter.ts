import type { SkippedRow } from "@/lib/contracts";
import { parseNumberSv } from "@/lib/core/num-sv";
import { valueText, type CellValue } from "../../working";
import type { StepFn } from "../types";
import { fold, missingColumns, skip, stepIssue } from "../util";

const OPERATOR_LABELS = {
  equals: "är",
  not_equals: "är inte",
  contains: "innehåller",
  empty: "är tom",
  not_empty: "är inte tom",
} as const;

/** Remove rows that MATCH the condition ("Filtrera bort rader"); removed rows are reported. */
export const filter: StepFn<"filter"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  const needsValue =
    step.operator === "equals" || step.operator === "not_equals" || step.operator === "contains";
  if (
    needsValue &&
    (step.value === undefined || (step.operator === "contains" && step.value === ""))
  ) {
    return skip(table, [stepIssue(index, step.op, step.column, "värde att jämföra med saknas.")]);
  }

  const caseSensitive = step.caseSensitive ?? false;
  const wanted = fold((step.value ?? "").trim(), caseSensitive);
  const wantedNumber = parseNumberSv(step.value ?? "", "number");

  const equals = (v: CellValue | undefined, text: string): boolean => {
    if (fold(text, caseSensitive) === wanted) return true;
    return typeof v === "number" && wantedNumber.ok && wantedNumber.value === v;
  };

  const matches = (v: CellValue | undefined): boolean => {
    const text = valueText(v);
    switch (step.operator) {
      case "empty":
        return text === "";
      case "not_empty":
        return text !== "";
      case "equals":
        return equals(v, text);
      case "not_equals":
        return !equals(v, text);
      case "contains":
        return fold(text, caseSensitive).includes(wanted);
    }
  };

  const detail = `Steg ${index + 1}: ${step.column} ${OPERATOR_LABELS[step.operator]}${
    needsValue ? ` "${step.value}"` : ""
  }`;
  const skipped: SkippedRow[] = [];
  const reported = new Set<number>();
  const rows = table.rows.filter((row) => {
    if (!matches(row.values[step.column])) return true;
    if (!reported.has(row.sourceRow)) {
      reported.add(row.sourceRow);
      skipped.push({ sourceRow: row.sourceRow, reason: "filtered", detail });
    }
    return false;
  });
  return { table: { ...table, rows }, issues: [], skipped, unknown: {} };
};
