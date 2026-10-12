import { describe, expect, it } from "vitest";
import * as ingest from "./index";
import { applyBudgetSign, resolveAccountGroupKey, type AggregateOptions } from "./aggregate";

describe("ingest public API", () => {
  it("exports the budget sign helpers", () => {
    expect(ingest.applyBudgetSign).toBe(applyBudgetSign);
    expect(ingest.resolveAccountGroupKey).toBe(resolveAccountGroupKey);
    const opts: ingest.AggregateOptions & AggregateOptions = {
      accountGroupSigns: { intakter: -1 },
      accountGroupNames: { intakter: "Intäkter" },
    };
    expect(
      ingest.resolveAccountGroupKey(" INTÄKTER ", opts.accountGroupSigns!, opts.accountGroupNames),
    ).toBe("intakter");
  });
});
