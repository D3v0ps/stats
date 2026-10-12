import { describe, expect, it } from "vitest";
import { summarizeMonths, toSourceList } from "./sources";

describe("source list", () => {
  it("collapses consecutive months into ranges", () => {
    expect(summarizeMonths(["2026-03", "2026-01", "2026-02", "2026-05"])).toBe(
      "jan–mar 2026, maj 2026",
    );
    expect(summarizeMonths(["2025-11", "2025-12", "2026-01"])).toBe("nov 2025–jan 2026");
    expect(summarizeMonths(["2026-09", "2026-09"])).toBe("sep 2026");
    expect(summarizeMonths([])).toBe("");
  });

  it("formats uploads newest first", () => {
    const items = toSourceList([
      {
        uploadId: "a",
        fileName: "timmar-aug.xlsx",
        datasetKey: "ip_timmar",
        templateName: "Intelliplan timmar",
        templateVersion: 2,
        publishedAt: "2026-09-04T10:00:00Z",
        months: ["2026-08"],
      },
      {
        uploadId: "b",
        fileName: "MBAB.se",
        datasetKey: "fx_bokforing",
        templateName: null,
        templateVersion: null,
        publishedAt: "2026-10-08T10:00:00Z",
        months: ["2026-01", "2026-02", "2026-03"],
      },
    ]);
    expect(items).toEqual([
      {
        uploadId: "b",
        file: "MBAB.se",
        report: "Fortnox – bokföring (SIE4)",
        template: "Ingen mall",
        published: "8 okt 2026",
        months: "jan–mar 2026",
      },
      {
        uploadId: "a",
        file: "timmar-aug.xlsx",
        report: "Intelliplan – timmar och pass",
        template: "Intelliplan timmar v2",
        published: "4 sep 2026",
        months: "aug 2026",
      },
    ]);
  });
});
