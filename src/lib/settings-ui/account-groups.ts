// Account group editing: range validation (BAS accounts are four digits), sign wording,
// which ledger metrics read each group and what an edit does to the budget (budget leaves).
import type { AccountGroup, MetricDefinition } from "@/lib/contracts/metric-query";
import { leafAccountGroups, rangesCover } from "@/lib/metrics/memory-source";

export interface AccountRange {
  from: number;
  to: number;
}

export interface RangeDraft {
  from: string;
  to: string;
}

export interface RangeCheck {
  /** Parsed ranges; only meaningful when errors is empty. */
  ranges: AccountRange[];
  errors: string[];
  warnings: string[];
}

export const MIN_ACCOUNT = 1000;
export const MAX_ACCOUNT = 9999;
export const MAX_RANGES = 20;

const ACCOUNT = /^\d{4}$/;

export function formatRange(range: AccountRange): string {
  return `${range.from}–${range.to}`;
}

/** Validate the ranges typed for one group: four-digit accounts, from <= to, at least one. */
export function checkRanges(drafts: readonly RangeDraft[]): RangeCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ranges: AccountRange[] = [];
  if (drafts.length === 0) errors.push("Kontogruppen måste ha minst ett kontointervall.");
  if (drafts.length > MAX_RANGES) errors.push(`Högst ${MAX_RANGES} intervall per kontogrupp.`);

  drafts.forEach((draft, i) => {
    const prefix = drafts.length > 1 ? `Intervall ${i + 1}: ` : "";
    const from = draft.from.trim();
    const to = draft.to.trim();
    if (!ACCOUNT.test(from) || !ACCOUNT.test(to)) {
      errors.push(`${prefix}konton skrivs med fyra siffror (${MIN_ACCOUNT}–${MAX_ACCOUNT}).`);
      return;
    }
    const range = { from: Number(from), to: Number(to) };
    if (range.from < MIN_ACCOUNT || range.to < MIN_ACCOUNT) {
      errors.push(`${prefix}konton skrivs med fyra siffror (${MIN_ACCOUNT}–${MAX_ACCOUNT}).`);
      return;
    }
    if (range.from > range.to) {
      errors.push(`${prefix}från-kontot måste vara lägre än eller lika med till-kontot.`);
      return;
    }
    ranges.push(range);
  });

  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.from <= prev.to) {
      warnings.push(
        `${formatRange(prev)} och ${formatRange(cur)} överlappar. Konton i båda räknas ändå bara en gång.`,
      );
    }
  }
  return { ranges, errors, warnings };
}

export const SIGN_LABELS: Record<1 | -1, string> = {
  1: "+ Som bokfört",
  [-1]: "− Vänt tecken",
};

export const SIGN_HELP =
  "Intäkter bokförs med minus i bokföringen. Med vänt tecken (−) visas de som positiva tal.";

/** Ledger metrics per account group key, in catalog order. */
export function ledgerMetricsByGroup(
  definitions: readonly MetricDefinition[],
): Record<string, { key: string; name: string }[]> {
  const out: Record<string, { key: string; name: string }[]> = {};
  for (const def of definitions) {
    if (def.kind !== "ledger" || !def.accountGroupKey) continue;
    (out[def.accountGroupKey] ??= []).push({ key: def.key, name: def.name });
  }
  return out;
}

/** True when the drafts differ from the stored ranges (order matters for display only). */
export function rangesChanged(stored: readonly AccountRange[], drafts: readonly RangeDraft[]) {
  if (stored.length !== drafts.length) return true;
  return stored.some(
    (r, i) => String(r.from) !== drafts[i]?.from.trim() || String(r.to) !== drafts[i]?.to.trim(),
  );
}

const quoted = (names: readonly string[]) => names.map((n) => `”${n}”`).join(", ");

/** The budget leaves whose ranges lie inside the group's ranges (a leaf lies inside itself). */
function leavesWithin(group: AccountGroup, groups: readonly AccountGroup[]): AccountGroup[] {
  return leafAccountGroups(groups).filter(
    (l) => l.key !== group.key && rangesCover(group.ranges, l.ranges),
  );
}

/**
 * For a summary group (its ranges contain other groups, so it is not a budget leaf): how its
 * budget is made up. null for budget leaves and groups without ranges.
 */
export function summaryGroupNote(groups: readonly AccountGroup[], key: string): string | null {
  const group = groups.find((g) => g.key === key);
  if (!group || group.ranges.length === 0) return null;
  if (leafAccountGroups(groups).some((l) => l.key === key)) return null;
  const inner = leavesWithin(group, groups).map((g) => g.name);
  return `Summagrupp: budgeten räknas fram ur ${quoted(inner)}. Budget som läggs direkt på ”${group.name}” räknas inte.`;
}

/**
 * What saving new ranges for group `key` does to the budget. A group whose ranges strictly
 * contain another group's is a summary group, not a budget leaf: budget lines on it are not
 * counted (its budget is the sum of the leaves inside it). Warns for every group that stops
 * being a budget leaf, and for every group that becomes one, because of the edit.
 */
export function budgetLeafWarnings(
  groups: readonly AccountGroup[],
  key: string,
  ranges: readonly AccountRange[],
): string[] {
  const edited = groups.find((g) => g.key === key);
  if (!edited || ranges.length === 0) return [];
  const next = groups.map((g) => (g.key === key ? { ...g, ranges: [...ranges] } : g));
  const before = new Set(leafAccountGroups(groups).map((g) => g.key));
  const after = new Set(leafAccountGroups(next).map((g) => g.key));
  const warnings: string[] = [];
  for (const g of next) {
    if (before.has(g.key) && !after.has(g.key)) {
      if (g.key === key) {
        const inner = leavesWithin(g, next).map((x) => x.name);
        warnings.push(
          `Intervallen omsluter nu ${quoted(inner)}. Då blir ”${g.name}” en summagrupp: budget som läggs direkt på ”${g.name}” räknas inte längre, utan budgeten räknas fram ur grupperna inuti.`,
        );
      } else {
        warnings.push(
          `Intervallen ligger nu inom ”${g.name}”. Då blir ”${g.name}” en summagrupp: budget som läggs direkt på ”${g.name}” räknas inte längre – lägg den budgeten på grupperna inuti i stället.`,
        );
      }
    } else if (!before.has(g.key) && after.has(g.key)) {
      warnings.push(
        `”${g.name}” omsluter inte längre någon annan kontogrupp och blir en egen budgetrad: budget som läggs på ”${g.name}” räknas då direkt, i stället för att räknas fram ur andra grupper.`,
      );
    }
  }
  return warnings;
}
