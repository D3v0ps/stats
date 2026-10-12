import { describe, expect, it } from "vitest";
import type { DetectedTable } from "@/lib/contracts";
import {
  diffSignature,
  headerSignature,
  matchTemplates,
  suggestCompany,
  suggestPeriod,
} from "./recognize";

describe("headerSignature", () => {
  it("returns normalized headers in order", () => {
    const table = {
      columns: [
        { index: 0, header: "Kund", normalized: "kund" },
        { index: 2, header: "Timmar", normalized: "timmar" },
      ],
    } as DetectedTable;
    expect(headerSignature(table)).toEqual(["kund", "timmar"]);
  });
});

describe("diffSignature", () => {
  it("is compatible for identical and reordered signatures", () => {
    expect(diffSignature(["a", "b", "c"], ["a", "b", "c"])).toEqual({
      added: [],
      removed: [],
      renamed: [],
      reordered: false,
      compatible: true,
    });
    const d = diffSignature(["kund", "datum", "timmar"], ["timmar", "kund", "datum"]);
    expect(d.reordered).toBe(true);
    expect(d.compatible).toBe(true);
  });

  it("reports added and removed columns", () => {
    const d = diffSignature(["kund", "timmar"], ["kund", "timmar", "ort"]);
    expect(d).toMatchObject({ added: ["ort"], removed: [], renamed: [], compatible: false });
    const r = diffSignature(["kund", "ort", "timmar"], ["kund", "timmar"]);
    expect(r).toMatchObject({ added: [], removed: ["ort"], compatible: false });
  });

  it("pairs likely renames by similarity >= 0.6", () => {
    const d = diffSignature(
      ["kund", "anställnings-id", "timmar"],
      ["kund", "anställningsid", "timmar", "verksamhet"],
    );
    expect(d.renamed).toEqual([
      { from: "anställnings-id", to: "anställningsid", similarity: 0.93 },
    ]);
    expect(d.added).toEqual(["verksamhet"]);
    expect(d.removed).toEqual([]);
    expect(d.compatible).toBe(false);
  });

  it("does not pair dissimilar columns", () => {
    const d = diffSignature(["kund", "belopp"], ["kund", "ort"]);
    expect(d.renamed).toEqual([]);
    expect(d.added).toEqual(["ort"]);
    expect(d.removed).toEqual(["belopp"]);
  });

  it("pairs each column at most once, best match first", () => {
    const d = diffSignature(["timmar ord", "timmar öt"], ["timmar ord.", "timmar öt.", "x"]);
    expect(d.renamed.map((r) => [r.from, r.to])).toEqual([
      ["timmar ord", "timmar ord."],
      ["timmar öt", "timmar öt."],
    ]);
    expect(d.added).toEqual(["x"]);
  });

  it("treats duplicate headers as a multiset", () => {
    const d = diffSignature(["kund", "kund"], ["kund"]);
    expect(d.removed).toEqual(["kund"]);
  });
});

describe("matchTemplates", () => {
  const templates = [
    {
      id: "t1",
      datasetKey: "ip_timmar",
      headerSignature: ["kund", "datum", "anställnings id", "timmar"],
    },
    { id: "t2", datasetKey: "ip_franvaro", headerSignature: ["kund", "frånvarotyp", "timmar"] },
    { id: "t3", datasetKey: "budget", headerSignature: ["konto", "belopp"] },
  ];

  it("ranks by Jaccard and drops templates without overlap", () => {
    const m = matchTemplates(["kund", "datum", "anställnings id", "timmar"], templates);
    expect(m.map((x) => x.id)).toEqual(["t1", "t2"]);
    expect(m[0]!.score).toBe(1);
    expect(m[0]!.diff.compatible).toBe(true);
    expect(m[1]!.score).toBeCloseTo(2 / 5, 3);
    expect(m[0]!.datasetKey).toBe("ip_timmar");
  });

  it("returns [] when nothing matches", () => {
    expect(matchTemplates(["x", "y"], templates)).toEqual([]);
  });
});

describe("suggestPeriod", () => {
  it("combines filename, meta lines and data", () => {
    const s = suggestPeriod(
      "intelliplan_timmar_MBAB_2026-09.xlsx",
      ["Period: 2026-09-01 - 2026-09-30", "Utskrivet 2026-10-01"],
      ["2026-09-01", "2026-09-15", "2026-09-30", "2026-08-31"],
    );
    expect(s[0]).toMatchObject({ month: "2026-09", source: "filename" });
    expect(s[0]!.confidence).toBeGreaterThan(0.95);
    expect(s.map((x) => x.month)).toContain("2026-10");
    const oct = s.find((x) => x.month === "2026-10")!;
    expect(oct.confidence).toBeLessThan(0.5);
    expect(s.find((x) => x.month === "2026-08")?.source).toBe("data");
  });

  it("uses meta lines with Swedish month names", () => {
    expect(suggestPeriod("export.xlsx", ["Rapport september 2026"])[0]).toMatchObject({
      month: "2026-09",
      source: "meta",
    });
  });

  it("uses only data when nothing else is known", () => {
    const s = suggestPeriod("export.csv", [], ["2026-09-01", "2026-09-02", 20260903, null, "x"]);
    expect(s).toEqual([{ month: "2026-09", confidence: 0.9, source: "data" }]);
  });

  it("returns [] without any evidence", () => {
    expect(suggestPeriod("export.csv", ["Kundlista"])).toEqual([]);
  });

  it("keeps confidence within 0..1", () => {
    for (const s of suggestPeriod(
      "2026-09_2026-09.xlsx",
      ["september 2026", "Period 2026-09"],
      ["2026-09-01"],
    )) {
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("suggestCompany", () => {
  it.each([
    ["intelliplan_timmar_MBAB_2026-09.xlsx", [], "MBAB", "filename"],
    ["intelliplan_timmar_MBR_2026-09.xlsx", [], "MBR", "filename"],
    ["export.xlsx", ["Miljonbemanning AB"], "MBAB", "meta"],
    ["export.xlsx", ["Miljonbemanning Restart AB"], "MBR", "meta"],
    ["export.xlsx", ["MB Restart – deltagare"], "MBR", "meta"],
    ["deltagare restart.xlsx", [], "MBR", "filename"],
    ["export.xlsx", ["Kund: MB AB"], "MBAB", "meta"],
    ["export.xlsx", ["Org.nr 556959-9318"], "MBAB", "meta"],
    ["export.xlsx", ["Organisationsnummer: 5592089071"], "MBR", "meta"],
    ["sie_5569599318.se", [], "MBAB", "filename"],
  ] as const)("%j %j -> %s", (fileName, meta, company, source) => {
    expect(suggestCompany(fileName, [...meta])).toMatchObject({ company, source });
  });

  it("prefers org numbers over names", () => {
    const s = suggestCompany("timmar_MBAB.xlsx", ["Org.nr 559208-9071"]);
    expect(s).toMatchObject({ company: "MBR", confidence: 0.98 });
  });

  it("returns null without evidence or with equally strong conflicting evidence", () => {
    expect(suggestCompany("export.xlsx", ["Kundlista"])).toBeNull();
    expect(suggestCompany("MBAB_MBR.xlsx", [])).toBeNull();
  });

  it("does not take 'Miljonbemanning Restart AB' for MBAB", () => {
    expect(suggestCompany("x.xlsx", ["Miljonbemanning Restart AB"])?.company).toBe("MBR");
  });
});
