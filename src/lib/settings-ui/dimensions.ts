// Dimension values as the settings page shows them: value + its aliases, search and wording.
import { formatNumber } from "@/lib/core/format-sv";
import { normalizeValue } from "@/lib/core/normalize";

export type UnknownPolicy = "ask" | "auto_create";

export const PERSONAL_NOTICE = "Personuppgift – syns aldrig i styrelserapporter";

export const POLICY_LABELS: Record<UnknownPolicy, string> = {
  auto_create: "Nya värden läggs till automatiskt vid import",
  ask: "Nya värden måste godkännas vid import",
};

export interface ValueInput {
  id: number;
  code: string;
  label: string;
  sort: number;
  active: boolean;
}

export interface AliasInput {
  aliasNorm: string;
  valueId: number;
}

export interface ValueRow {
  id: number;
  code: string;
  label: string;
  active: boolean;
  /** Normalized aliases pointing at this value, sorted. */
  aliases: string[];
}

const collator = new Intl.Collator("sv", { sensitivity: "base", numeric: true });

/**
 * Values with their aliases: active first, then by sort and label. Run on the server and pass
 * the result down, so server and browser never disagree on collation order.
 */
export function buildValueRows(
  values: readonly ValueInput[],
  aliases: readonly AliasInput[],
): ValueRow[] {
  const byValue = new Map<number, string[]>();
  for (const a of aliases) {
    const list = byValue.get(a.valueId);
    if (list) list.push(a.aliasNorm);
    else byValue.set(a.valueId, [a.aliasNorm]);
  }
  return [...values]
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.sort - b.sort ||
        collator.compare(a.label, b.label) ||
        a.id - b.id,
    )
    .map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label,
      active: v.active,
      aliases: [...(byValue.get(v.id) ?? [])].sort((x, y) => collator.compare(x, y)),
    }));
}

/** Rows whose label, code or an alias contains the query (normalized), order kept. */
export function filterValueRows(
  rows: readonly ValueRow[],
  query: string,
  opts: { showInactive: boolean },
): ValueRow[] {
  const q = normalizeValue(query);
  return rows.filter((r) => {
    if (!opts.showInactive && !r.active) return false;
    if (q === "") return true;
    return (
      normalizeValue(r.label).includes(q) ||
      r.code.toLocaleLowerCase("sv").includes(q) ||
      r.aliases.some((a) => a.includes(q))
    );
  });
}

export type ValuePatch =
  | { kind: "label"; id: number; label: string }
  | { kind: "active"; id: number; active: boolean }
  | { kind: "alias_add"; id: number; alias: string }
  | { kind: "alias_remove"; alias: string }
  | { kind: "merge"; fromId: number; intoId: number };

/**
 * Optimistic view of a change before the server confirms it. A merge deactivates the source
 * and moves its aliases (plus its own code) to the target, like merge_dimension_values.
 */
export function applyValuePatch(rows: readonly ValueRow[], patch: ValuePatch): ValueRow[] {
  const sortAliases = (aliases: string[]) =>
    [...new Set(aliases)].sort((x, y) => collator.compare(x, y));
  switch (patch.kind) {
    case "label":
      return rows.map((r) => (r.id === patch.id ? { ...r, label: patch.label } : r));
    case "active":
      return rows.map((r) => (r.id === patch.id ? { ...r, active: patch.active } : r));
    case "alias_add": {
      const alias = normalizeValue(patch.alias);
      return rows.map((r) =>
        r.id === patch.id
          ? { ...r, aliases: sortAliases([...r.aliases, alias]) }
          : { ...r, aliases: r.aliases.filter((a) => a !== alias) },
      );
    }
    case "alias_remove": {
      const alias = normalizeValue(patch.alias);
      return rows.map((r) => ({ ...r, aliases: r.aliases.filter((a) => a !== alias) }));
    }
    case "merge": {
      const from = rows.find((r) => r.id === patch.fromId);
      if (!from || patch.fromId === patch.intoId) return [...rows];
      return rows.map((r) => {
        if (r.id === patch.fromId) return { ...r, active: false, aliases: [] };
        if (r.id === patch.intoId) {
          return { ...r, aliases: sortAliases([...r.aliases, ...from.aliases, from.code]) };
        }
        return r;
      });
    }
  }
}

/** "1 aktivt värde", "12 aktiva värden". */
export function valueCountLabel(count: number): string {
  return count === 1 ? "1 aktivt värde" : `${formatNumber(count)} aktiva värden`;
}

export function aliasCountLabel(count: number): string {
  return count === 1 ? "1 alias" : `${formatNumber(count)} alias`;
}
