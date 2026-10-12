import { describe, expect, it } from "vitest";
import { levenshtein, similarity } from "./levenshtein";

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["kitten", "sitting", 3],
    ["anställnings-id", "anställningsid", 1],
    ["timmar", "timmar", 0],
    ["åäö", "aäö", 1],
  ])("%j vs %j = %d", (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
    expect(levenshtein(b, a)).toBe(d);
  });
});

describe("similarity", () => {
  it("is 1 for identical strings and 0 for disjoint ones of equal length", () => {
    expect(similarity("kund", "kund")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("is high for small edits", () => {
    expect(similarity("anställnings-id", "anställningsid")).toBeGreaterThan(0.9);
    expect(similarity("timmar", "antal timmar")).toBeGreaterThanOrEqual(0.5);
  });

  it("stays within 0..1", () => {
    for (const [a, b] of [
      ["a", "bbbbbbbb"],
      ["kund", ""],
      ["verksamhet", "verksamhetsområde"],
    ] as const) {
      const s = similarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
