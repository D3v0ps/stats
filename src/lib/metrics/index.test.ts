import { describe, expect, it } from "vitest";
import * as metrics from "./index";
import { KEY_METRICS, defaultAnchorMonth, pickAnchorMonth } from "./anchor";
import { budgetLedgerRows, leafAccountGroups } from "./memory-source";

describe("metrics public API", () => {
  it("exports the anchor and ledger budget helpers", () => {
    expect(metrics.KEY_METRICS).toBe(KEY_METRICS);
    expect(metrics.defaultAnchorMonth).toBe(defaultAnchorMonth);
    expect(metrics.pickAnchorMonth).toBe(pickAnchorMonth);
    expect(metrics.budgetLedgerRows).toBe(budgetLedgerRows);
    expect(metrics.leafAccountGroups).toBe(leafAccountGroups);
  });
});
