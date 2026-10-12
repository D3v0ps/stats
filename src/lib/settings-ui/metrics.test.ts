import { describe, expect, it } from "vitest";
import { CATALOG_DATASETS } from "@/lib/contracts/catalog";
import { catalogDefinitions } from "@/lib/metrics";
import {
  FORMULA_GROUP_TITLE,
  checkFormula,
  formatMultiplier,
  fromDirection,
  groupMetrics,
  insertIntoFormula,
  metricKeyError,
  parsePercentInput,
  percentInputText,
  suggestMetricKey,
  toDirection,
  usesWageCost,
  wageUpliftPct,
  withWageUplift,
} from "./metrics";

const defs = catalogDefinitions();

describe("groupMetrics", () => {
  it("groups by dataset in dataset order with formulas last", () => {
    const groups = groupMetrics(defs, CATALOG_DATASETS);
    expect(groups[0]?.title).toBe("Intelliplan – timmar och pass");
    expect(groups[0]?.metrics.map((m) => m.key)).toEqual(["timmar", "pass", "konsulter"]);
    expect(groups.at(-1)?.title).toBe(FORMULA_GROUP_TITLE);
    expect(groups.at(-1)?.metrics.every((m) => m.kind === "formula")).toBe(true);
    const total = groups.reduce((n, g) => n + g.metrics.length, 0);
    expect(total).toBe(defs.length);
  });

  it("puts metrics of unknown datasets under Övriga and drops empty groups", () => {
    const groups = groupMetrics(defs.slice(0, 2), [{ key: "x", name: "X" }]);
    expect(groups.map((g) => g.title)).toEqual(["Övriga"]);
  });
});

describe("direction", () => {
  it("round-trips higher_is_better", () => {
    for (const v of [true, false, null]) expect(fromDirection(toDirection(v))).toBe(v);
  });
});

describe("checkFormula", () => {
  it("accepts a valid formula and lists referenced metrics and common dimensions", () => {
    const check = checkFormula(defs, "faktor", "fakturerat_ip / (lonekostnad * 1.31)");
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.referenced.map((r) => r.key)).toEqual(["fakturerat_ip", "lonekostnad"]);
    expect(check.dimensions).toEqual(["kund", "uppdrag", "konsult"]);
  });

  it("works for a new metric key", () => {
    const check = checkFormula(defs, "intakt_per_konsult_ny", "fakturerat_ip / konsulter");
    expect(check.ok).toBe(true);
    expect(check.referenced.map((r) => r.name)).toEqual([
      "Fakturerat (Intelliplan)",
      "Konsulter i arbete",
    ]);
  });

  it("reports syntax errors, unknown metrics and cycles in Swedish", () => {
    expect(checkFormula(defs, "faktor", "fakturerat_ip / (lonekostnad").errors[0]).toMatch(
      /Saknar "\)"/,
    );
    expect(checkFormula(defs, "faktor", "fakturerat / lonekostnad").errors).toEqual([
      "Okänt mått i formeln: fakturerat.",
    ]);
    expect(checkFormula(defs, "faktor", "faktor * 2").errors[0]).toMatch(
      /refererar till sig själv/,
    );
    // A cycle through another formula metric.
    expect(checkFormula(defs, "faktor", "sjukfranvaro * 2").ok).toBe(true);
    const looped = defs.map((d) =>
      d.key === "sjukfranvaro" ? { ...d, formula: "faktor + 1" } : d,
    );
    expect(checkFormula(looped, "faktor", "sjukfranvaro * 2").errors[0]).toMatch(/faktor → /);
    expect(checkFormula(defs, "faktor", "  ").errors).toEqual(["Skriv en formel."]);
    // Never the placeholder key of a metric that is still being created.
    expect(checkFormula(defs, "nytt_formelmatt_utkast", "").errors.join(" ")).not.toMatch(
      /nytt_formelmatt_utkast/,
    );
    expect(checkFormula(defs, "faktor", "2 * 3").errors).toEqual([
      "Formeln måste använda minst ett mått.",
    ]);
  });

  it("has no common dimensions across unrelated datasets", () => {
    expect(checkFormula(defs, "x_y", "timmar / aktiva_deltagare").dimensions).toEqual([
      "verksamhet",
    ]);
    expect(checkFormula(defs, "x_y", "sjuktimmar / aktiva_deltagare").dimensions).toEqual([]);
  });
});

describe("wage uplift", () => {
  it("reads the multiplier as a percentage", () => {
    expect(wageUpliftPct("fakturerat_ip / (lonekostnad * 1.0)")).toBe(0);
    expect(wageUpliftPct("fakturerat_ip / (lonekostnad * 1.31)")).toBe(31);
    expect(wageUpliftPct("fakturerat_ip / (1.315 * lonekostnad)")).toBe(31.5);
    expect(wageUpliftPct("fakturerat_ip / lonekostnad")).toBe(0);
    expect(wageUpliftPct("timmar / konsulter")).toBeNull();
    expect(usesWageCost("lonekostnad_extra / 2")).toBe(false);
  });

  it("only treats a multiplier bound to the wage cost as the uplift", () => {
    // (fakturerat_ip / lonekostnad) * 1.31 scales the ratio, not the wage cost.
    expect(wageUpliftPct("fakturerat_ip / lonekostnad * 1.31")).toBe(0);
    expect(wageUpliftPct("fakturerat_ip / 1.31 * lonekostnad")).toBe(0);
    expect(wageUpliftPct("(lonekostnad * 1.2) + fakturerat_ip")).toBe(20);
    expect(withWageUplift("fakturerat_ip / lonekostnad * 1.31", 31)).toBe(
      "fakturerat_ip / (lonekostnad * 1.31) * 1.31",
    );
  });

  it("formats the multiplier", () => {
    expect(formatMultiplier(0)).toBe("1.0");
    expect(formatMultiplier(31)).toBe("1.31");
    expect(formatMultiplier(31.5)).toBe("1.315");
    expect(formatMultiplier(100)).toBe("2.0");
  });

  it("rewrites the multiplier, or adds one", () => {
    expect(withWageUplift("fakturerat_ip / (lonekostnad * 1.0)", 31)).toBe(
      "fakturerat_ip / (lonekostnad * 1.31)",
    );
    expect(withWageUplift("fakturerat_ip / (1.2 * lonekostnad)", 0)).toBe(
      "fakturerat_ip / (1.0 * lonekostnad)",
    );
    expect(withWageUplift("fakturerat_ip / lonekostnad", 25)).toBe(
      "fakturerat_ip / (lonekostnad * 1.25)",
    );
    expect(() => withWageUplift("fakturerat_ip / lonekostnad", -1)).toThrow(/mellan 0 och 300/);
    expect(() => withWageUplift("fakturerat_ip / lonekostnad", Number.NaN)).toThrow();
  });

  it("keeps the formula valid after rewriting", () => {
    const formula = withWageUplift("fakturerat_ip / (lonekostnad * 1.0)", 42.5);
    expect(checkFormula(defs, "faktor", formula).ok).toBe(true);
    expect(wageUpliftPct(formula)).toBe(42.5);
  });
});

describe("insertIntoFormula", () => {
  it("inserts at the cursor with spacing", () => {
    expect(insertIntoFormula("", 0, 0, "timmar")).toEqual({ formula: "timmar", cursor: 6 });
    expect(insertIntoFormula("timmar /", 8, 8, "konsulter")).toEqual({
      formula: "timmar / konsulter",
      cursor: 18,
    });
    expect(insertIntoFormula("(/x)", 1, 1, "a")).toEqual({ formula: "(a /x)", cursor: 2 });
    expect(insertIntoFormula("timmar / pass", 9, 13, "konsulter").formula).toBe(
      "timmar / konsulter",
    );
  });
});

describe("percent inputs", () => {
  it("parses Swedish and English decimals and a percent sign", () => {
    expect(parsePercentInput("31,5")).toBe(31.5);
    expect(parsePercentInput("31.5")).toBe(31.5);
    expect(parsePercentInput(" 31 % ")).toBe(31);
    expect(parsePercentInput("")).toBeNull();
    expect(parsePercentInput("abc")).toBeNull();
  });

  it("formats values for inputs without grouping", () => {
    expect(percentInputText(31.5)).toBe("31,5");
    expect(percentInputText(25)).toBe("25");
    expect(percentInputText(1234.25)).toBe("1234,25");
    expect(percentInputText(42.123456)).toBe("42,1235");
  });
});

describe("metric keys", () => {
  it("suggests a unique key from a Swedish name", () => {
    expect(suggestMetricKey("Intäkt per konsult", [])).toBe("intakt_per_konsult");
    expect(suggestMetricKey("Intäkt per konsult", ["intakt_per_konsult"])).toBe(
      "intakt_per_konsult_2",
    );
    expect(suggestMetricKey("Öppna ärenden (%)", [])).toBe("oppna_arenden");
    expect(suggestMetricKey("123", [])).toBe("matt");
    expect(suggestMetricKey("x".repeat(80), []).length).toBe(50);
  });

  it("validates hand-typed keys", () => {
    expect(metricKeyError("ny_kvot", ["timmar"])).toBeNull();
    expect(metricKeyError("timmar", ["timmar"])).toMatch(/finns redan/);
    expect(metricKeyError("Ny kvot", [])).toMatch(/a–z/);
    expect(metricKeyError("x", [])).toMatch(/2–61/);
  });
});
