// The mapping view's tools. Each tool is a small form that becomes one pipeline
// Step (or, for "Räkna rader", a counter). Validation messages are plain Swedish.
import { CounterSchema, StepSchema, type Counter, type Step } from "@/lib/contracts";
import { MONTH_ABBR_SV, MONTH_NAMES_SV } from "@/lib/core/month";
import { parseDateSv } from "@/lib/core/dates-sv";
import { normalizeHeader } from "@/lib/core/normalize";
import { isSafeColumnName } from "@/lib/ingest/working";

export type ToolKind =
  | "merge"
  | "split"
  | "lookup"
  | "replace"
  | "clean"
  | "filter"
  | "fill_down"
  | "negate"
  | "constant"
  | "unpivot"
  | "counter";

export interface ToolDefinition {
  kind: ToolKind;
  label: string;
  /** One sentence in plain words: what happens to the file. */
  description: string;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    kind: "merge",
    label: "Slå ihop kolumner",
    description: "Lägger ihop texten i flera kolumner till en, till exempel förnamn och efternamn.",
  },
  {
    kind: "split",
    label: "Dela upp kolumn",
    description: "Delar en kolumn i flera, till exempel ”2026-09” i år och månad.",
  },
  {
    kind: "lookup",
    label: "Översätt med uppslagstabell",
    description:
      "Byter stavningar och koder mot de namn som redan finns, till exempel ”Postnord” till ”PostNord AB”.",
  },
  {
    kind: "replace",
    label: "Sök och ersätt",
    description: "Byter ut en text mot en annan i en kolumn.",
  },
  {
    kind: "clean",
    label: "Rensa format",
    description: "Tar bort enheter och mellanslag så att ”1 200 kr” eller ”8,5 h” blir rena tal.",
  },
  {
    kind: "filter",
    label: "Filtrera bort rader",
    description: "Tar bort rader som inte ska räknas, till exempel makulerade pass.",
  },
  {
    kind: "fill_down",
    label: "Fyll nedåt",
    description: "Fyller tomma celler med värdet ovanför, som i grupperade rapporter.",
  },
  {
    kind: "negate",
    label: "Vänd tecken",
    description: "Gör plus till minus och minus till plus i en kolumn.",
  },
  {
    kind: "constant",
    label: "Lägg till fast värde",
    description:
      "Lägger till en kolumn med samma värde på alla rader, till exempel Verksamhet = Bemanning.",
  },
  {
    kind: "unpivot",
    label: "Vrid månadskolumner till rader",
    description: "Gör om en kolumn per månad (jan, feb, mar …) till en rad per månad.",
  },
  {
    kind: "counter",
    label: "Räkna rader",
    description: "Räknar antalet rader som ett eget mått, till exempel antal pass.",
  },
];

export function toolDefinition(kind: ToolKind): ToolDefinition {
  return TOOLS.find((t) => t.kind === kind)!;
}

export interface ToolForm {
  column?: string;
  columns?: string[];
  separator?: string;
  into?: string;
  intoList?: string[];
  mode?: "delimiter" | "year_month" | "last_first";
  delimiter?: string;
  dimension?: string;
  find?: string;
  replace?: string;
  match?: "contains" | "whole_cell";
  caseSensitive?: boolean;
  as?: "number" | "amount" | "hours" | "percent" | "trim";
  operator?: "equals" | "not_equals" | "contains" | "empty" | "not_empty";
  value?: string;
  nameColumn?: string;
  valueColumn?: string;
  metricKey?: string;
}

export type ToolResult =
  { ok: true; step: Step } | { ok: true; counter: Counter } | { ok: false; problem: string };

const fail = (problem: string): ToolResult => ({ ok: false, problem });

/** Problem with a new column name, or null. `freed` names are removed by the same step. */
function newNameProblem(
  name: string | undefined,
  columns: readonly string[],
  freed: readonly string[] = [],
): string | null {
  const n = (name ?? "").trim();
  if (n === "") return "Ge den nya kolumnen ett namn.";
  if (!isSafeColumnName(n)) return `”${n}” kan inte användas som kolumnnamn.`;
  if (columns.includes(n) && !freed.includes(n))
    return `Det finns redan en kolumn som heter ”${n}”.`;
  return null;
}

function needColumn(column: string | undefined, columns: readonly string[]): string | null {
  if (!column) return "Välj en kolumn.";
  if (!columns.includes(column)) return `Kolumnen ”${column}” finns inte längre.`;
  return null;
}

function parsedStep(candidate: unknown): ToolResult {
  const r = StepSchema.safeParse(candidate);
  return r.success ? { ok: true, step: r.data } : fail("Uppgifterna är inte kompletta.");
}

/** Build the step (or counter) for a tool from its form values. */
export function buildTool(kind: ToolKind, form: ToolForm, columns: readonly string[]): ToolResult {
  const single = () => needColumn(form.column, columns);
  switch (kind) {
    case "merge": {
      const cols = (form.columns ?? []).filter((c) => columns.includes(c));
      if (cols.length < 2) return fail("Välj minst två kolumner att slå ihop.");
      const p = newNameProblem(form.into, columns, cols);
      if (p) return fail(p);
      return parsedStep({
        op: "merge",
        columns: cols,
        separator: form.separator ?? " ",
        into: form.into!.trim(),
      });
    }
    case "split": {
      const p = single();
      if (p) return fail(p);
      const mode = form.mode ?? "delimiter";
      if (mode === "delimiter" && !form.delimiter)
        return fail("Ange vilket tecken som delar upp texten.");
      const into = (form.intoList ?? []).map((s) => s.trim());
      if (into.length < 2) return fail("Ange namn på minst två nya kolumner.");
      const seen = new Set<string>();
      for (const name of into) {
        const problem = newNameProblem(name, columns, [form.column!]);
        if (problem) return fail(problem);
        if (seen.has(name)) return fail(`Namnet ”${name}” anges två gånger.`);
        seen.add(name);
      }
      return parsedStep({
        op: "split",
        column: form.column,
        mode,
        ...(mode === "delimiter" ? { delimiter: form.delimiter } : {}),
        into,
      });
    }
    case "lookup": {
      const p = single();
      if (p) return fail(p);
      if (!form.dimension) return fail("Välj vilken uppslagstabell som ska användas.");
      return parsedStep({ op: "lookup", column: form.column, dimension: form.dimension });
    }
    case "replace": {
      const p = single();
      if (p) return fail(p);
      if (!form.find) return fail("Skriv vilken text som ska ersättas.");
      return parsedStep({
        op: "replace",
        column: form.column,
        find: form.find,
        replace: form.replace ?? "",
        match: form.match ?? "contains",
        caseSensitive: form.caseSensitive ?? false,
      });
    }
    case "clean": {
      const p = single();
      if (p) return fail(p);
      return parsedStep({ op: "clean", column: form.column, as: form.as ?? "number" });
    }
    case "filter": {
      const p = single();
      if (p) return fail(p);
      const operator = form.operator ?? "equals";
      const needsValue =
        operator === "equals" || operator === "not_equals" || operator === "contains";
      if (needsValue && !(form.value ?? "").trim()) return fail("Skriv vilket värde raderna har.");
      return parsedStep({
        op: "filter",
        column: form.column,
        operator,
        ...(needsValue ? { value: form.value!.trim() } : {}),
        caseSensitive: form.caseSensitive ?? false,
      });
    }
    case "fill_down":
    case "negate": {
      const p = single();
      if (p) return fail(p);
      return parsedStep({ op: kind, column: form.column });
    }
    case "constant": {
      const p = newNameProblem(form.column, columns);
      if (p) return fail(p);
      if (!(form.value ?? "").trim()) return fail("Skriv värdet som ska stå på alla rader.");
      return parsedStep({ op: "constant", column: form.column!.trim(), value: form.value!.trim() });
    }
    case "unpivot": {
      const cols = (form.columns ?? []).filter((c) => columns.includes(c));
      if (cols.length === 0) return fail("Välj kolumnerna som ska vridas till rader.");
      const name = form.nameColumn?.trim();
      const value = form.valueColumn?.trim();
      const p = newNameProblem(name, columns, cols) ?? newNameProblem(value, columns, cols);
      if (p) return fail(p);
      if (name === value) return fail("De två nya kolumnerna måste ha olika namn.");
      return parsedStep({ op: "unpivot", columns: cols, nameColumn: name, valueColumn: value });
    }
    case "counter": {
      if (!form.metricKey) return fail("Välj vilket mått raderna ska räknas som.");
      const r = CounterSchema.safeParse({ metricKey: form.metricKey, kind: "count_rows" });
      return r.success ? { ok: true, counter: r.data } : fail("Måttet kan inte användas.");
    }
  }
}

/** Default names for the columns a split creates. */
export function defaultSplitNames(column: string, mode: ToolForm["mode"]): string[] {
  if (mode === "year_month") return ["år", "månad"];
  if (mode === "last_first") return ["förnamn", "efternamn"];
  return [`${column} 1`, `${column} 2`];
}

const MONTH_WORDS = new Set<string>([...MONTH_NAMES_SV, ...MONTH_ABBR_SV, "sept", "mars"]);

/** Columns whose header is a month ("jan", "Februari", "2026-03", "apr 2026"), for unpivot. */
export function guessMonthColumns(
  columns: readonly string[],
  headers: Readonly<Record<string, string>> = {},
): string[] {
  return columns.filter((c) => {
    const h = normalizeHeader(headers[c] ?? c).replace(/\.$/, "");
    if (MONTH_WORDS.has(h)) return true;
    const r = parseDateSv(h);
    return r.ok && "month" in r;
  });
}
