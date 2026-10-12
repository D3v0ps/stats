import { describe, expect, it } from "vitest";
import { catalogDefinitions } from "@/lib/metrics";
import { CATALOG_ACCOUNT_GROUPS } from "@/lib/contracts/catalog";
import type { AccountGroup } from "@/lib/contracts/metric-query";
import {
  budgetLeafWarnings,
  checkRanges,
  formatRange,
  ledgerMetricsByGroup,
  rangesChanged,
  summaryGroupNote,
} from "./account-groups";

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

describe("budget leaves when ranges are nested", () => {
  const groups: AccountGroup[] = CATALOG_ACCOUNT_GROUPS.map((g) => ({ ...g }));
  const name = (key: string) => groups.find((g) => g.key === key)!.name;

  it("explains how a summary group's budget is made up", () => {
    const note = summaryGroupNote(groups, "kostnader");
    expect(note).toMatch(/^Summagrupp: budgeten räknas fram ur /);
    expect(note).toContain(`”${name("personal")}”`);
    expect(note).not.toContain(`”${name("intakter")}”`);
    expect(note).toContain(`Budget som läggs direkt på ”${name("kostnader")}” räknas inte.`);
    expect(summaryGroupNote(groups, "personal")).toBeNull();
    expect(summaryGroupNote(groups, "finns_inte")).toBeNull();
  });

  it("is quiet for edits that keep every group's role", () => {
    expect(budgetLeafWarnings(groups, "personal", [{ from: 7000, to: 7599 }])).toEqual([]);
    const kostnader = groups.find((g) => g.key === "kostnader")!;
    expect(budgetLeafWarnings(groups, "kostnader", kostnader.ranges)).toEqual([]);
    expect(budgetLeafWarnings(groups, "personal", [])).toEqual([]);
  });

  it("warns when a leaf group comes to sit inside another leaf", () => {
    // Personal moved inside Övriga externa kostnader (5000-6999).
    const warnings = budgetLeafWarnings(groups, "personal", [{ from: 5000, to: 5099 }]);
    expect(warnings).toEqual([
      `Intervallen ligger nu inom ”${name("ovriga_externa")}”. Då blir ”${name("ovriga_externa")}” en summagrupp: budget som läggs direkt på ”${name("ovriga_externa")}” räknas inte längre – lägg den budgeten på grupperna inuti i stället.`,
    ]);
  });

  it("warns when the edited group comes to enclose another group", () => {
    const warnings = budgetLeafWarnings(groups, "avskrivningar", [{ from: 7700, to: 7999 }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`Intervallen omsluter nu ”${name("ovriga_rorelse")}”.`);
    expect(warnings[0]).toContain(`Då blir ”${name("avskrivningar")}” en summagrupp`);
  });

  it("says when a summary group becomes a budget line of its own", () => {
    const two: AccountGroup[] = [
      { key: "a", name: "A", sign: 1, ranges: [{ from: 4000, to: 4999 }] },
      { key: "b", name: "B", sign: 1, ranges: [{ from: 4000, to: 4099 }] },
    ];
    expect(summaryGroupNote(two, "a")).toBe(
      "Summagrupp: budgeten räknas fram ur ”B”. Budget som läggs direkt på ”A” räknas inte.",
    );
    expect(budgetLeafWarnings(two, "b", [{ from: 5000, to: 5099 }])).toEqual([
      "”A” omsluter inte längre någon annan kontogrupp och blir en egen budgetrad: budget som läggs på ”A” räknas då direkt, i stället för att räknas fram ur andra grupper.",
    ]);
  });
});
