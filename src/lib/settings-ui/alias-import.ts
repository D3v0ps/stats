// "Fyll från Excel": a two-column file (Från -> Till) planned against one dimension's values
// and aliases. The same planner runs in the browser (preview) and in the server action
// (on fresh data) so what is applied always matches the rules shown.
//
// Modes:
// - alias:   Från is another spelling or code; Till names an existing value (kundkod -> kundnamn,
//            stavning -> kund). Unknown targets are created for auto_create dimensions.
// - relabel: Från is an existing value (by code, alias or name) whose display name becomes Till
//            (anställnings-id -> namn for konsult). Unknown values are created with Från as
//            code for auto_create dimensions.
import type { DetectedTable, RawCell } from "@/lib/contracts/workbook";
import { containsPersonnummer } from "@/lib/core/pnr";
import { normalizeValue } from "@/lib/core/normalize";
import type { AliasInput, UnknownPolicy, ValueInput } from "./dimensions";

export type AliasImportMode = "alias" | "relabel";

export const MODE_LABELS: Record<AliasImportMode, string> = {
  alias: "Från är en annan stavning eller kod – lägg till alias",
  relabel: "Från är ett befintligt värde – byt visningsnamn till Till",
};

/** Most pairs one import may apply (keeps the server action bounded). */
export const MAX_IMPORT_PAIRS = 5000;
export const MAX_LABEL_LENGTH = 200;

export interface ImportPair {
  /** 1-based row in the file. */
  row: number;
  from: string;
  to: string;
}

export type PlanStatus =
  | "add_alias"
  | "move_alias"
  | "create_and_alias"
  | "relabel"
  | "create_value"
  | "unchanged"
  | "duplicate"
  | "unknown_target"
  | "conflict"
  | "invalid";

/** Statuses that change something when the plan is applied. */
export const APPLIED_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "add_alias",
  "move_alias",
  "create_and_alias",
  "relabel",
  "create_value",
]);

/** Statuses the user should look at (nothing is done for these rows). */
export const FLAGGED_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "unknown_target",
  "conflict",
  "invalid",
]);

export const STATUS_LABELS: Record<PlanStatus, string> = {
  add_alias: "Nytt alias",
  move_alias: "Alias flyttas",
  create_and_alias: "Nytt värde + alias",
  relabel: "Nytt namn",
  create_value: "Nytt värde",
  unchanged: "Finns redan",
  duplicate: "Dubblett",
  unknown_target: "Okänt mål",
  conflict: "Krock",
  invalid: "Ogiltig rad",
};

export interface PlanRow extends ImportPair {
  status: PlanStatus;
  message: string;
  /** Target value (alias, move_alias, relabel); null when it is created or unknown. */
  valueId: number | null;
}

export interface ImportPlan {
  mode: AliasImportMode;
  rows: PlanRow[];
  counts: Record<PlanStatus, number>;
  /** Rows that change something. */
  applicable: number;
  /** Rows the user should look at. */
  flagged: number;
}

export interface PlanContext {
  dimensionKey: string;
  policy: UnknownPolicy;
  values: readonly ValueInput[];
  aliases: readonly AliasInput[];
}

const q = (text: string) => `”${text}”`;

/** Display form: whitespace collapsed and trimmed, case kept (like private.clean_label). */
export function cleanText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​-‍⁠]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** kostnadsställe codes are company-scoped ("MBAB:100") and only created by SIE imports. */
export function canCreateValues(ctx: Pick<PlanContext, "dimensionKey" | "policy">): boolean {
  return ctx.policy === "auto_create" && ctx.dimensionKey !== "kostnadsstalle";
}

interface Lookup {
  /**
   * alias, then code (any value), then label (active values) -> value id: the precedence of
   * ensure_dimension_values, so the plan resolves exactly like the next import will.
   */
  resolve(text: string): number | undefined;
  aliasTarget(norm: string): number | undefined;
  /** Value whose own code or label (not an alias) is this text. */
  ownValue(norm: string): number | undefined;
  label(id: number): string;
  active(id: number): boolean;
}

function buildLookup(ctx: PlanContext): Lookup {
  const aliasMap = new Map(ctx.aliases.map((a) => [normalizeValue(a.aliasNorm), a.valueId]));
  const codeMap = new Map<string, number>();
  const labelMap = new Map<string, number>();
  const labels = new Map<number, string>();
  const inactive = new Set<number>();
  for (const v of ctx.values) {
    labels.set(v.id, v.label);
    codeMap.set(normalizeValue(v.code), v.id);
    if (!v.active) {
      inactive.add(v.id);
      continue;
    }
    const norm = normalizeValue(v.label);
    if (!labelMap.has(norm)) labelMap.set(norm, v.id);
  }
  const ownValue = (norm: string) => codeMap.get(norm) ?? labelMap.get(norm);
  return {
    resolve: (text) => {
      const norm = normalizeValue(text);
      return aliasMap.get(norm) ?? ownValue(norm);
    },
    aliasTarget: (norm) => aliasMap.get(norm),
    ownValue,
    label: (id) => labels.get(id) ?? String(id),
    active: (id) => !inactive.has(id),
  };
}

function emptyCounts(): Record<PlanStatus, number> {
  return Object.fromEntries(Object.keys(STATUS_LABELS).map((k) => [k, 0])) as Record<
    PlanStatus,
    number
  >;
}

function invalidReason(pair: ImportPair): string | null {
  if (pair.from === "" || pair.to === "") return "Från eller Till är tom.";
  if (pair.from.length > MAX_LABEL_LENGTH || pair.to.length > MAX_LABEL_LENGTH) {
    return `Högst ${MAX_LABEL_LENGTH} tecken.`;
  }
  if (containsPersonnummer(pair.from) || containsPersonnummer(pair.to)) {
    return "Personnummer får inte sparas.";
  }
  return null;
}

function planAlias(pair: ImportPair, ctx: PlanContext, lookup: Lookup) {
  const fromNorm = normalizeValue(pair.from);
  const target = lookup.resolve(pair.to);
  if (target === undefined) {
    return canCreateValues(ctx)
      ? {
          status: "create_and_alias" as const,
          valueId: null,
          message: `Värdet ${q(pair.to)} skapas.`,
        }
      : {
          status: "unknown_target" as const,
          valueId: null,
          message: `${q(pair.to)} finns inte. Lägg till värdet först eller rätta stavningen.`,
        };
  }
  if (!lookup.active(target)) {
    return {
      status: "unknown_target" as const,
      valueId: null,
      message: `${q(lookup.label(target))} är inaktiverat. Aktivera värdet först.`,
    };
  }
  if (lookup.resolve(pair.from) === target) {
    return {
      status: "unchanged" as const,
      valueId: target,
      message: `Pekar redan på ${q(lookup.label(target))}.`,
    };
  }
  const current = lookup.aliasTarget(fromNorm);
  if (current !== undefined) {
    return {
      status: "move_alias" as const,
      valueId: target,
      message: `Pekade på ${q(lookup.label(current))}, flyttas till ${q(lookup.label(target))}.`,
    };
  }
  // An active value's own name or code would be shadowed by the alias (that is a merge);
  // pointing an inactive value's code elsewhere is what a merge leaves behind anyway.
  const own = lookup.ownValue(fromNorm);
  if (own !== undefined && lookup.active(own)) {
    return {
      status: "conflict" as const,
      valueId: target,
      message: `${q(pair.from)} är ett eget värde. Slå ihop värdena i stället.`,
    };
  }
  return {
    status: "add_alias" as const,
    valueId: target,
    message: `Kopplas till ${q(lookup.label(target))}.`,
  };
}

function planRelabel(pair: ImportPair, ctx: PlanContext, lookup: Lookup) {
  const value = lookup.resolve(pair.from);
  if (value === undefined) {
    return canCreateValues(ctx)
      ? {
          status: "create_value" as const,
          valueId: null,
          message: `Nytt värde med koden ${q(pair.from)} och namnet ${q(pair.to)}.`,
        }
      : {
          status: "unknown_target" as const,
          valueId: null,
          message: `${q(pair.from)} finns inte.`,
        };
  }
  const old = lookup.label(value);
  if (old === pair.to) {
    return { status: "unchanged" as const, valueId: value, message: "Har redan det namnet." };
  }
  return {
    status: "relabel" as const,
    valueId: value,
    message: `${q(old)} byter namn till ${q(pair.to)}.`,
  };
}

/** Plan every pair; later rows repeating an earlier Från are duplicates or invalid. */
export function planAliasImport(
  pairs: readonly ImportPair[],
  mode: AliasImportMode,
  ctx: PlanContext,
): ImportPlan {
  const lookup = buildLookup(ctx);
  const seen = new Map<string, string>();
  const rows: PlanRow[] = [];
  const counts = emptyCounts();
  for (const raw of pairs) {
    const pair = { row: raw.row, from: cleanText(raw.from), to: cleanText(raw.to) };
    let planned: Pick<PlanRow, "status" | "valueId" | "message">;
    const reason = invalidReason(pair);
    const key = normalizeValue(pair.from);
    const earlier = seen.get(key);
    if (reason) {
      planned = { status: "invalid", valueId: null, message: reason };
    } else if (earlier !== undefined) {
      planned =
        normalizeValue(earlier) === normalizeValue(pair.to) &&
        (mode === "alias" || earlier === pair.to)
          ? { status: "duplicate", valueId: null, message: "Samma rad finns tidigare i filen." }
          : {
              status: "invalid",
              valueId: null,
              message: `${q(pair.from)} har redan ett annat Till tidigare i filen.`,
            };
    } else {
      seen.set(key, pair.to);
      planned = mode === "alias" ? planAlias(pair, ctx, lookup) : planRelabel(pair, ctx, lookup);
    }
    counts[planned.status]++;
    rows.push({ ...pair, ...planned });
  }
  let applicable = 0;
  let flagged = 0;
  for (const [status, n] of Object.entries(counts) as [PlanStatus, number][]) {
    if (APPLIED_STATUSES.has(status)) applicable += n;
    if (FLAGGED_STATUSES.has(status)) flagged += n;
  }
  return { mode, rows, counts, applicable, flagged };
}

/** The database writes a plan stands for, in the order they must run. */
export interface ImportOperations {
  /** alias mode: values to create first (their labels), for create_and_alias rows. */
  createTargets: string[];
  /** Aliases to existing values. */
  aliases: { alias: string; valueId: number }[];
  /** Aliases to values created by createTargets (looked up by label after creating). */
  aliasesToCreated: { alias: string; label: string }[];
  /** relabel mode: new display names. */
  relabels: { id: number; label: string }[];
  /** relabel mode: new values with Från as code. */
  creates: { code: string; label: string }[];
}

export function importOperations(plan: ImportPlan): ImportOperations {
  const ops: ImportOperations = {
    createTargets: [],
    aliases: [],
    aliasesToCreated: [],
    relabels: [],
    creates: [],
  };
  for (const r of plan.rows) {
    switch (r.status) {
      case "add_alias":
      case "move_alias":
        if (r.valueId !== null) ops.aliases.push({ alias: r.from, valueId: r.valueId });
        break;
      case "create_and_alias":
        if (!ops.createTargets.includes(r.to)) ops.createTargets.push(r.to);
        ops.aliasesToCreated.push({ alias: r.from, label: r.to });
        break;
      case "relabel":
        if (r.valueId !== null) ops.relabels.push({ id: r.valueId, label: r.to });
        break;
      case "create_value":
        ops.creates.push({ code: r.from, label: r.to });
        break;
      default:
        break;
    }
  }
  return ops;
}

export type SingleAliasStatus = "add" | "move" | "unchanged" | "conflict" | "invalid";

/** The rules of planAliasImport for one alias typed by hand for a known value. */
export function checkSingleAlias(
  alias: string,
  valueId: number,
  ctx: PlanContext,
): { status: SingleAliasStatus; message: string } {
  const text = cleanText(alias);
  const reason = invalidReason({ row: 0, from: text, to: "x" });
  if (reason) return { status: "invalid", message: reason };
  const lookup = buildLookup(ctx);
  const norm = normalizeValue(text);
  const current = lookup.aliasTarget(norm);
  if (current === valueId) return { status: "unchanged", message: "Aliaset finns redan." };
  const own = lookup.ownValue(norm);
  if (current === undefined && own !== undefined && (own === valueId || lookup.active(own))) {
    return own === valueId
      ? { status: "unchanged", message: "Det är redan värdets eget namn eller kod." }
      : {
          status: "conflict",
          message: `${q(text)} är ett eget värde. Slå ihop värdena i stället.`,
        };
  }
  if (current !== undefined) {
    return { status: "move", message: `Aliaset flyttades från ${q(lookup.label(current))}.` };
  }
  return { status: "add", message: "Aliaset är tillagt." };
}

// ---- Reading the file ------------------------------------------------------------

export interface PairExtraction {
  pairs: ImportPair[];
  /** Rows where both cells were empty. */
  emptyRows: number;
}

/**
 * Pairs from two columns of a detected table (column positions in table.columns). With
 * headerIsData the detected header row is read as the first pair (files without headers).
 */
export function extractPairs(
  table: DetectedTable,
  fromColumn: number,
  toColumn: number,
  opts: {
    headerIsData?: boolean;
    /** cellText from src/lib/ingest (injected so this module stays free of the readers). */
    cellText: (cell: RawCell | undefined) => string;
  },
): PairExtraction {
  const pairs: ImportPair[] = [];
  let emptyRows = 0;
  const from = table.columns[fromColumn];
  const to = table.columns[toColumn];
  if (!from || !to) return { pairs, emptyRows };
  if (opts.headerIsData && table.headerRows.length === 1) {
    pairs.push({ row: table.headerRows[0]! + 1, from: from.header, to: to.header });
  }
  for (const r of table.rows) {
    const a = opts.cellText(r.cells[fromColumn]);
    const b = opts.cellText(r.cells[toColumn]);
    if (a === "" && b === "") {
      emptyRows++;
      continue;
    }
    pairs.push({ row: r.sourceRow, from: a, to: b });
  }
  return { pairs, emptyRows };
}

/** Default mode: konsult maps ids to names; everything else adds aliases. */
export function defaultMode(dimensionKey: string): AliasImportMode {
  return dimensionKey === "konsult" ? "relabel" : "alias";
}
