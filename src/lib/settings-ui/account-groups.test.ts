import { describe, expect, it } from "vitest";
import { catalogDefinitions } from "@/lib/metrics";
import { checkRanges, formatRange, ledgerMetricsByGroup, rangesChanged } from "./account-groups";

describe("checkRanges", () => {
  it("parses valid four-digit ranges", () => {
    expect(checkRanges([{ from: " 3000", to: "3999 " }])).toEqual({
      ranges: [{ from: 3000, to: 3999 }],
      errors: [],
      warnings: [],
    });
  });

  it("rejects missing, short and reversed ranges", () => {
    expect(checkRanges([]).errors).toEqual(["Kontogruppen måste ha minst ett kontointervall."]);
    expect(checkRanges([{ from: "300", to: "3999" }]).errors[0]).toMatch(/fyra siffror/);
    expect(checkRanges([{ from: "0999", to: "3999" }]).errors[0]).toMatch(/fyra siffror/);
    expect(checkRanges([{ from: "abcd", to: "3999" }]).errors[0]).toMatch(/fyra siffror/);
    expect(checkRanges([{ from: "4000", to: "3000" }]).errors[0]).toMatch(/lägre än eller lika/);
    const many = Array.from({ length: 21 }, () => ({ from: "3000", to: "3001" }));
    expect(checkRanges(many).errors[0]).toMatch(/Högst 20/);
  });

  it("numbers errors when there are several ranges", () => {
    const check = checkRanges([
      { from: "3000", to: "3999" },
      { from: "5000", to: "4000" },
    ]);
    expect(check.errors).toEqual([
      "Intervall 2: från-kontot måste vara lägre än eller lika med till-kontot.",
    ]);
  });

  it("warns about overlaps without blocking", () => {
    const check = checkRanges([
      { from: "3500", to: "3600" },
      { from: "3000", to: "3999" },
    ]);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([
      "3000–3999 och 3500–3600 överlappar. Konton i båda räknas ändå bara en gång.",
    ]);
  });
});

describe("helpers", () => {
  it("formats ranges with an en dash", () => {
    expect(formatRange({ from: 3000, to: 3999 })).toBe("3000–3999");
  });

  it("maps ledger metrics to their account groups", () => {
    const byGroup = ledgerMetricsByGroup(catalogDefinitions());
    expect(byGroup.intakter).toEqual([{ key: "intakter", name: "Intäkter" }]);
    expect(byGroup.resultat).toEqual([{ key: "resultat", name: "Resultat" }]);
    expect(byGroup.bokslut_skatt).toBeUndefined();
  });

  it("detects changed ranges", () => {
    const stored = [{ from: 3000, to: 3999 }];
    expect(rangesChanged(stored, [{ from: "3000", to: "3999" }])).toBe(false);
    expect(rangesChanged(stored, [{ from: "3000", to: "3899" }])).toBe(true);
    expect(rangesChanged(stored, [])).toBe(true);
  });
});
