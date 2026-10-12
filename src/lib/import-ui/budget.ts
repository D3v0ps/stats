// Budget files in the upload flow: the account-group context runTemplate needs
// to read "Alla belopp positiva" budgets, and the review warning for budget
// lines on a summary account group (kostnader, resultat), which the budget of a
// ledger metric never counts (see "Budget sign" in docs/architecture.md).
import type { AccountGroup, FactDraft } from "@/lib/contracts";
import { normalizeValue } from "@/lib/core/normalize";
import { resolveAccountGroupKey } from "@/lib/ingest/aggregate";
import type { RunContext } from "@/lib/ingest/run";
import { leafAccountGroups } from "@/lib/metrics/memory-source";
import type { DictionaryEntry } from "./review";

const BUDGET_METRIC = "budget_belopp";
const KONTOGRUPP = "kontogrupp";

/** Account groups as the upload page sends them to the browser. */
export type UploadAccountGroup = Pick<AccountGroup, "key" | "name" | "sign" | "ranges">;

/** RunContext.accountGroupSigns/accountGroupNames from the account groups in settings. */
export function accountGroupContext(
  groups: readonly UploadAccountGroup[],
): Required<Pick<RunContext, "accountGroupSigns" | "accountGroupNames">> {
  return {
    accountGroupSigns: Object.fromEntries(groups.map((g) => [g.key, g.sign])),
    accountGroupNames: Object.fromEntries(groups.map((g) => [g.key, g.name])),
  };
}

export const BUDGET_SUMMARY_LINE_WARNING =
  "Budget på summarader räknas inte – lägg budgeten på delraderna";

export interface BudgetSummaryLines {
  message: string;
  /** Names of the summary groups the file has budget lines for, in settings order. */
  groups: string[];
}

/**
 * Budget lines whose kontogrupp is a group that contains other groups' ranges
 * (not a budget leaf). The kontogrupp label is matched by group key or name, or
 * through the kontogrupp dictionary (aliases added with "Samma som…").
 */
export function budgetSummaryLines(
  facts: readonly FactDraft[],
  groups: readonly UploadAccountGroup[],
  dictionary?: DictionaryEntry,
): BudgetSummaryLines | null {
  const leaves = new Set(leafAccountGroups(groups).map((g) => g.key));
  const summary = groups.filter((g) => g.ranges.length > 0 && !leaves.has(g.key));
  if (summary.length === 0) return null;
  const { accountGroupSigns: signs, accountGroupNames: names } = accountGroupContext(groups);
  const keyOf = (label: string): string | null => {
    const direct = resolveAccountGroupKey(label, signs, names);
    if (direct !== null || !dictionary) return direct;
    const id = dictionary.byNorm[normalizeValue(label)];
    const canonical = id === undefined ? undefined : dictionary.labels[id];
    return canonical === undefined ? null : resolveAccountGroupKey(canonical, signs, names);
  };
  const found = new Set<string>();
  const seen = new Set<string>();
  for (const f of facts) {
    const label = f.dims[KONTOGRUPP];
    if (f.metricKey !== BUDGET_METRIC || label === undefined || seen.has(label)) continue;
    seen.add(label);
    const key = keyOf(label);
    if (key !== null) found.add(key);
  }
  const hit = summary.filter((g) => found.has(g.key));
  if (hit.length === 0) return null;
  return { message: BUDGET_SUMMARY_LINE_WARNING, groups: hit.map((g) => g.name) };
}
