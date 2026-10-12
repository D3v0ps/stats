import { describe, expect, it } from "vitest";
import { catalogDefinitions } from "@/lib/metrics";
import {
  SEEDED_DIMENSION_META,
  definitionMap,
  dimensionLabelOf,
  entityPageName,
  groupMetricsByArea,
  leafMetricKeys,
  metricArea,
  notApplicableReason,
  perGroupTitle,
  personalDimensionSet,
  supportedDimensions,
  supportsBreakdown,
} from "./metrics-meta";

const DEFS = catalogDefinitions();
const MAP = definitionMap(DEFS);
const def = (key: string) => {
  const d = MAP.get(key);
  if (!d) throw new Error(key);
  return d;
};

describe("metric metadata", () => {
  it("finds the data behind formulas", () => {
    expect(leafMetricKeys("timmar", MAP)).toEqual(["timmar"]);
    expect(leafMetricKeys("faktor", MAP)).toEqual(["fakturerat_ip", "lonekostnad"]);
    expect(leafMetricKeys("sjukfranvaro", MAP).sort()).toEqual(["sjuktimmar", "timmar"]);
    expect(leafMetricKeys("nope", MAP)).toEqual([]);
  });

  it("groups metrics by area, formulas with their operands", () => {
    expect(metricArea(def("intakter"), MAP)).toBe("Ekonomi");
    expect(metricArea(def("fakturerat_kund"), MAP)).toBe("Ekonomi");
    expect(metricArea(def("aktiva_deltagare"), MAP)).toBe("AF-program");
    expect(metricArea(def("timmar"), MAP)).toBe("Bemanning");
    expect(metricArea(def("faktor"), MAP)).toBe("Bemanning");
    expect(metricArea(def("resultatmarginal"), MAP)).toBe("Ekonomi");
    expect(metricArea(def("resultatandel"), MAP)).toBe("AF-program");

    const groups = groupMetricsByArea(DEFS);
    expect(groups.map((g) => g.area)).toEqual(["Ekonomi", "AF-program", "Bemanning"]);
    const keys = groups.flatMap((g) => g.metrics.map((m) => m.key));
    expect(keys).not.toContain("budget_belopp");
    expect(keys).toHaveLength(DEFS.length - 1);
    expect(groups[2]?.metrics.find((m) => m.key === "faktor")?.formula).toBe(true);
  });

  it("knows which breakdowns apply", () => {
    expect(supportsBreakdown(def("resultat"), "bolag")).toBe(true);
    expect(supportsBreakdown(def("resultat"), "manad")).toBe(true);
    expect(supportsBreakdown(def("resultat"), "kund")).toBe(false);
    expect(supportsBreakdown(def("timmar"), "kund")).toBe(true);
    expect(supportedDimensions([def("resultat"), def("faktor")])).toEqual([
      "kostnadsstalle",
      "kund",
      "uppdrag",
      "konsult",
    ]);
  });

  it("explains why a breakdown does not apply", () => {
    const dims = SEEDED_DIMENSION_META;
    expect(notApplicableReason(def("resultat"), ["kund"], dims)).toBe(
      "Kund finns inte i bokföringen.",
    );
    expect(notApplicableReason(def("aktiva_deltagare"), ["kund", "uppdrag"], dims)).toBe(
      "Kund och uppdrag finns inte i Workbuster – deltagare.",
    );
    expect(notApplicableReason(def("faktor"), ["ort"], dims)).toBe(
      "Ort finns inte i alla delar av faktor.",
    );
  });

  it("names the operand sources of a formula that lack the dimension", () => {
    const dims = SEEDED_DIMENSION_META;
    expect(notApplicableReason(def("resultatandel"), ["kund"], dims, MAP)).toBe(
      "Kund finns inte i Workbuster – deltagare.",
    );
    expect(notApplicableReason(def("faktor"), ["ort"], dims, MAP)).toBe(
      "Ort finns inte i Intelliplan – fakturerat och lön.",
    );
    // Only the operand without verksamhet is named.
    expect(notApplicableReason(def("sjukfranvaro"), ["verksamhet"], dims, MAP)).toBe(
      "Verksamhet finns inte i Intelliplan – frånvaro.",
    );
    expect(notApplicableReason(def("resultatmarginal"), ["kund"], dims, MAP)).toBe(
      "Kund finns inte i bokföringen.",
    );
    expect(notApplicableReason(def("sjukpass_per_konsult"), ["ort"], dims, MAP)).toBe(
      "Ort finns inte i Intelliplan – frånvaro och Intelliplan – timmar och pass.",
    );
  });

  it("labels dimensions and personal data", () => {
    expect(dimensionLabelOf("kostnadsstalle", [])).toBe("Kostnadsställe");
    expect(dimensionLabelOf("bolag", [])).toBe("Bolag");
    expect(dimensionLabelOf("manad", [])).toBe("Månad");
    expect(dimensionLabelOf("kund", [{ key: "kund", label: "Kunder", personal: false }])).toBe(
      "Kunder",
    );
    expect(dimensionLabelOf("okand", [])).toBe("okand");
    expect(personalDimensionSet([{ key: "x_person", label: "X", personal: true }])).toEqual(
      new Set(["x_person", "konsult"]),
    );
    expect(entityPageName("kund")).toBe("kundkort");
    expect(entityPageName("ort")).toBe("detaljsida");
    expect(perGroupTitle("Fakturerade timmar", "Kund")).toBe("Fakturerade timmar per kund");
    expect(perGroupTitle("Fakturerat per kund", "Kund")).toBe("Fakturerat per kund");
  });
});
