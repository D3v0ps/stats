import { describe, expect, it } from "vitest";
import { MetricKeySchema } from "@/lib/contracts";
import {
  headlineSubjectFor,
  metricKeyFromName,
  NewMetricSchema,
  unitForColumnType,
} from "./metric-key";

describe("metricKeyFromName", () => {
  it("makes a valid key from Swedish names", () => {
    expect(metricKeyFromName("Sjuka pass (övertid)", [])).toBe("sjuka_pass_overtid");
    expect(metricKeyFromName("Ärenden – Öppna", [])).toBe("arenden_oppna");
    expect(metricKeyFromName("2026 mål", [])).toBe("matt_2026_mal");
    expect(metricKeyFromName("!!", [])).toBe("matt");
  });

  it("never collides with existing keys", () => {
    expect(metricKeyFromName("Timmar", ["timmar", "timmar_2"])).toBe("timmar_3");
  });

  it("always passes the contract's key rule", () => {
    for (const name of ["Å", "x".repeat(200), "Kostnad/timme %", "  mellanslag  ", "1"]) {
      expect(MetricKeySchema.safeParse(metricKeyFromName(name, [])).success, name).toBe(true);
    }
  });
});

describe("new metric input", () => {
  it("validates names and kinds", () => {
    const ok = {
      datasetKey: "ip_timmar",
      name: "Övertid",
      unit: "h",
      kind: "sum",
      higherIsBetter: null,
    };
    expect(NewMetricSchema.parse(ok)).toEqual(ok);
    expect(NewMetricSchema.safeParse({ ...ok, name: " " }).error?.issues[0]?.message).toBe(
      "Ge måttet ett namn.",
    );
    expect(NewMetricSchema.safeParse({ ...ok, kind: "formula" }).success).toBe(false);
    expect(NewMetricSchema.safeParse({ ...ok, unit: "faktor" }).success).toBe(false);
  });

  it("picks units and headline subjects", () => {
    expect(unitForColumnType("amount")).toBe("kr");
    expect(unitForColumnType("hours")).toBe("h");
    expect(unitForColumnType("percent")).toBe("pct");
    expect(unitForColumnType("text")).toBe("st");
    expect(headlineSubjectFor(" övertid ")).toBe("ÖVERTID");
  });
});
