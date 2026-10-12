import { describe, expect, it } from "vitest";
import { COMPANY_FILTER_LABELS } from "@/lib/contracts/domain";
import { MemoryMetricDataSource, catalogDefinitions } from "@/lib/metrics";
import { buildReportContext, personalDimensionKeys, seededReportDimensions } from "./context";

describe("buildReportContext", () => {
  const source = new MemoryMetricDataSource({ definitions: catalogDefinitions(), current: [] });

  it("indexes definitions and takes labels from the catalog", () => {
    const dims = [
      { key: "verksamhet", label: "Program", personal: false },
      { key: "konsult", label: "Konsult", personal: true },
    ];
    const ctx = buildReportContext({
      anchor: "2026-09",
      title: "Styrelserapport",
      source,
      definitions: catalogDefinitions(),
      dimensions: dims,
    });
    expect(ctx.anchor).toBe("2026-09");
    expect(ctx.title).toBe("Styrelserapport");
    expect((ctx.definitionsByKey as Map<string, unknown>).has("timmar")).toBe(true);
    expect(ctx.dimensionLabels).toEqual({ verksamhet: "Program", konsult: "Konsult" });
    expect(ctx.companyLabels).toEqual(COMPANY_FILTER_LABELS);
    expect([...ctx.personalDimensions]).toEqual(["konsult"]);
  });

  it("treats seeded personal dimensions as personal even when unflagged", () => {
    expect(personalDimensionKeys([{ key: "konsult", label: "K", personal: false }])).toEqual(
      new Set(["konsult"]),
    );
    expect(personalDimensionKeys([])).toEqual(new Set(["konsult"]));
  });

  it("lists the seeded dimensions", () => {
    const seeded = seededReportDimensions();
    expect(seeded.find((d) => d.key === "konsult")).toEqual({
      key: "konsult",
      label: "Konsult",
      personal: true,
    });
    expect(seeded.filter((d) => d.personal)).toHaveLength(1);
  });
});
