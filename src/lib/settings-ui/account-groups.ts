// Account group editing: range validation (BAS accounts are four digits), sign wording and
// which ledger metrics read each group.
import type { MetricDefinition } from "@/lib/contracts/metric-query";

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
