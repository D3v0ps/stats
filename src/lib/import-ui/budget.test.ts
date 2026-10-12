import { describe, expect, it } from "vitest";
import type { FactDraft } from "@/lib/contracts";
import { CATALOG_ACCOUNT_GROUPS } from "@/lib/contracts/catalog";
import {
  BUDGET_SUMMARY_LINE_WARNING,
  accountGroupContext,
  budgetSummaryLines,
  type UploadAccountGroup,
} from "./budget";
import type { DictionaryEntry } from "./review";

const GROUPS: UploadAccountGroup[] = CATALOG_ACCOUNT_GROUPS.map((g) => ({
  key: g.key,
  name: g.name,
  sign: g.sign,
  ranges: g.ranges,
}));

const fact = (kontogrupp: string, metricKey = "budget_belopp"): FactDraft => ({
  metricKey,
  company: "MBAB",
  month: "2026-01",
  dims: { kontogrupp },
  value: 100,
  sourceRows: [2],
});

describe("accountGroupContext", () => {
  it("gives runTemplate the signs and names of the account groups", () => {
    const ctx = accountGroupContext(GROUPS);
    expect(ctx.accountGroupSigns.intakter).toBe(-1);
    expect(ctx.accountGroupSigns.personal).toBe(1);
    expect(ctx.accountGroupNames.intakter).toBe(
      CATALOG_ACCOUNT_GROUPS.find((g) => g.key === "intakter")!.name,
    );
    expect(Object.keys(ctx.accountGroupSigns)).toEqual(GROUPS.map((g) => g.key));
    expect(accountGroupContext([])).toEqual({ accountGroupSigns: {}, accountGroupNames: {} });
  });
});

describe("budgetSummaryLines", () => {
  const name = (key: string) => GROUPS.find((g) => g.key === key)!.name;

  it("is quiet for budgets on leaf groups only", () => {
    expect(budgetSummaryLines([fact("intakter"), fact(name("personal"))], GROUPS)).toBeNull();
    expect(budgetSummaryLines([], GROUPS)).toBeNull();
  });

  it("warns for budget lines on kostnader and resultat, by key or name", () => {
    const out = budgetSummaryLines(
      [fact("intakter"), fact(name("kostnader").toUpperCase()), fact(" resultat ")],
      GROUPS,
    );
    expect(out).toEqual({
      message: BUDGET_SUMMARY_LINE_WARNING,
      groups: [name("kostnader"), name("resultat")],
    });
    expect(out?.message).toBe("Budget på summarader räknas inte – lägg budgeten på delraderna");
  });

  it("follows aliases in the kontogrupp dictionary", () => {
    const dictionary: DictionaryEntry = {
      byNorm: { "summa kostnader": 7, kostnader: 7 },
      labels: { 7: name("kostnader") },
      policy: "ask",
      personal: false,
    };
    expect(budgetSummaryLines([fact("Summa kostnader")], GROUPS)).toBeNull();
    expect(budgetSummaryLines([fact("Summa kostnader")], GROUPS, dictionary)?.groups).toEqual([
      name("kostnader"),
    ]);
  });

  it("ignores other metrics, unknown labels and groups without ranges", () => {
    expect(budgetSummaryLines([fact("kostnader", "timmar"), fact("okänd")], GROUPS)).toBeNull();
    const flat = GROUPS.map((g) => (g.key === "intakter" ? g : { ...g, ranges: [] }));
    expect(budgetSummaryLines([fact("kostnader")], flat)).toBeNull();
  });
});
