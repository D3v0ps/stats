import { normalizeValue } from "@/lib/core/normalize";
import { valueText } from "../../working";
import type { StepFn } from "../types";
import { missingColumns, skip } from "../util";

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Translate values through a dimension's alias table (normalized alias ->
 * canonical label). Values already equal to a canonical label (also
 * case-insensitively) are kept; unknown values stay as they are and are
 * reported so the user can map them.
 */
export const lookup: StepFn<"lookup"> = (table, step, ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);

  const aliases = hasOwn(ctx.aliases, step.dimension) ? (ctx.aliases[step.dimension] ?? {}) : {};
  const canonical = new Set(Object.values(aliases));
  const canonicalByNorm = new Map<string, string>();
  for (const label of canonical) {
    const key = normalizeValue(label);
    if (!canonicalByNorm.has(key)) canonicalByNorm.set(key, label);
  }

  const unknown: string[] = [];
  const seenUnknown = new Set<string>();
  const rows = table.rows.map((row) => {
    const v = row.values[step.column] ?? null;
    const text = valueText(v);
    if (text === "") return row;
    let label: string | undefined;
    if (canonical.has(text)) label = text;
    else {
      const key = normalizeValue(text);
      label = hasOwn(aliases, key) ? aliases[key] : canonicalByNorm.get(key);
    }
    if (label === undefined) {
      if (!seenUnknown.has(text)) {
        seenUnknown.add(text);
        unknown.push(text);
      }
      return row;
    }
    if (label === v) return row;
    return { sourceRow: row.sourceRow, values: { ...row.values, [step.column]: label } };
  });
  return {
    table: { ...table, rows },
    issues: [],
    skipped: [],
    unknown: unknown.length ? { [step.dimension]: unknown } : {},
  };
};
