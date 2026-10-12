import { describe, expect, it } from "vitest";
import {
  AccountGroupUpdateSchema,
  AliasImportSchema,
  MergeSchema,
  MetricUpdateSchema,
  NewFormulaMetricSchema,
  ThresholdSchema,
  firstIssue,
} from "./schemas";

describe("settings action schemas", () => {
  it("normalizes metric updates (blank optional text becomes null)", () => {
    expect(
      MetricUpdateSchema.parse({
        key: "timmar",
        name: " Timmar ",
        description: "  ",
        higherIsBetter: true,
        decimals: 0,
        headlineSubject: "",
      }),
    ).toEqual({
      key: "timmar",
      name: "Timmar",
      description: null,
      higherIsBetter: true,
      decimals: 0,
      headlineSubject: null,
    });
  });

  it("rejects bad metric input with Swedish messages", () => {
    const empty = MetricUpdateSchema.safeParse({
      key: "timmar",
      name: " ",
      description: null,
      higherIsBetter: null,
      decimals: null,
      headlineSubject: null,
    });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(firstIssue(empty.error)).toBe("Måttet måste ha ett namn.");

    const decimals = MetricUpdateSchema.safeParse({
      key: "timmar",
      name: "Timmar",
      description: null,
      higherIsBetter: null,
      decimals: 9,
      headlineSubject: null,
    });
    expect(decimals.success).toBe(false);
    if (!decimals.success) expect(firstIssue(decimals.error)).toBe("Ogiltiga uppgifter.");

    expect(
      NewFormulaMetricSchema.safeParse({
        key: "ny",
        name: "Ny",
        unit: "eur",
        formula: "timmar",
        description: null,
        higherIsBetter: null,
        decimals: null,
        headlineSubject: null,
      }).success,
    ).toBe(false);
  });

  it("validates account group ranges", () => {
    const base = { key: "intakter", name: "Intäkter", sign: -1 };
    expect(
      AccountGroupUpdateSchema.safeParse({ ...base, ranges: [{ from: 3000, to: 3999 }] }).success,
    ).toBe(true);
    expect(AccountGroupUpdateSchema.safeParse({ ...base, ranges: [] }).success).toBe(false);
    expect(
      AccountGroupUpdateSchema.safeParse({ ...base, ranges: [{ from: 3999, to: 3000 }] }).success,
    ).toBe(false);
    expect(
      AccountGroupUpdateSchema.safeParse({ ...base, sign: 0, ranges: [{ from: 3000, to: 3999 }] })
        .success,
    ).toBe(false);
  });

  it("validates merges, thresholds and import sizes", () => {
    const same = MergeSchema.safeParse({ fromId: 1, intoId: 1 });
    expect(same.success).toBe(false);
    if (!same.success) expect(firstIssue(same.error)).toBe("Välj två olika värden.");
    expect(ThresholdSchema.safeParse({ pct: 0 }).success).toBe(false);
    expect(ThresholdSchema.safeParse({ pct: 25 }).success).toBe(true);
    const tooMany = AliasImportSchema.safeParse({
      dimensionKey: "kund",
      mode: "alias",
      pairs: Array.from({ length: 5001 }, (_, i) => ({ row: i, from: "a", to: "b" })),
    });
    expect(tooMany.success).toBe(false);
    if (!tooMany.success) expect(firstIssue(tooMany.error)).toBe("Högst 5 000 rader per import.");
  });
});
