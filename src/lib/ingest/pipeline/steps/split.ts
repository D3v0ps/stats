import type { ParseIssue } from "@/lib/contracts";
import { parseDateSv, resultMonth } from "@/lib/core/dates-sv";
import { valueText, type CellValue } from "../../working";
import type { StepFn } from "../types";
import {
  badNewColumns,
  done,
  missingColumns,
  nextHeaders,
  rowIssue,
  skip,
  stepIssue,
  withHeaders,
} from "../util";

const emptyToNull = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Split one column into several, replacing it in place.
 * - delimiter: on `delimiter`; extra parts stay together in the last column
 * - year_month: "2026-09" (or any date/month) -> ["2026", "09"]
 * - last_first: "Efternamn, Förnamn" -> [Förnamn, Efternamn]
 */
export const split: StepFn<"split"> = (table, step, _ctx, index) => {
  const missing = missingColumns(table, [step.column], index, step.op);
  if (missing.length) return skip(table, missing);
  const bad = badNewColumns(table, step.into, index, step.op, [step.column]);
  if (bad.length) return skip(table, bad);
  if (step.mode === "delimiter" && !step.delimiter) {
    return skip(table, [stepIssue(index, step.op, step.column, "avgränsare saknas.")]);
  }

  const columns = table.columns.flatMap((c) => (c === step.column ? step.into : [c]));
  const n = step.into.length;
  const issues: ParseIssue[] = [];

  const partsOf = (v: CellValue | undefined, sourceRow: number): (string | null)[] => {
    const out = new Array<string | null>(n).fill(null);
    const text = valueText(v);
    if (text === "") return out;
    switch (step.mode) {
      case "delimiter": {
        const d = step.delimiter!;
        const pieces = text.split(d);
        for (let i = 0; i < n; i++) {
          out[i] = emptyToNull(i < n - 1 ? pieces[i] : pieces.slice(n - 1).join(d));
        }
        return out;
      }
      case "year_month": {
        const month = resultMonth(parseDateSv(typeof v === "number" ? v : text));
        if (!month) {
          issues.push(
            rowIssue(index, step.op, sourceRow, step.column, v, `"${text}" är inte år och månad.`),
          );
          return out;
        }
        out[0] = month.slice(0, 4);
        out[1] = month.slice(5, 7);
        return out;
      }
      case "last_first": {
        const comma = text.indexOf(",");
        if (comma < 0) {
          issues.push(
            rowIssue(
              index,
              step.op,
              sourceRow,
              step.column,
              v,
              `"${text}" saknar kommatecken (Efternamn, Förnamn).`,
              "warning",
            ),
          );
          out[0] = text;
          return out;
        }
        out[0] = emptyToNull(text.slice(comma + 1));
        out[1] = emptyToNull(text.slice(0, comma));
        return out;
      }
    }
  };

  const rows = table.rows.map((row) => {
    const parts = partsOf(row.values[step.column], row.sourceRow);
    const values: Record<string, CellValue> = {};
    for (const c of table.columns) {
      if (c === step.column) step.into.forEach((name, i) => (values[name] = parts[i] ?? null));
      else values[c] = row.values[c] ?? null;
    }
    return { sourceRow: row.sourceRow, values };
  });
  return done(withHeaders(columns, rows, nextHeaders(table, [step.column], step.into)), issues);
};
