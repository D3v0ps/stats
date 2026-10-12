import { describe, expect, it } from "vitest";
import type { IngestResult } from "@/lib/contracts";
import { factsContentHash } from "@/lib/ingest/run";
import {
  excludeMonths,
  formatMonthSpan,
  monthOptions,
  monthsAfterExport,
  openMonths,
  suggestAsOfDate,
  todayInStockholm,
  withoutMonths,
} from "./months";

const NOW = new Date("2026-10-12T10:00:00Z");

function result(months: string[], extra: Partial<IngestResult> = {}): IngestResult {
  return {
    engineVersion: 1,
    datasetKey: "ip_timmar",
    scenario: "utfall",
    file: { name: "f.xlsx", sha256: "a".repeat(64), size: 1 },
    contentHash: "b".repeat(64),
    companies: ["MBAB", "MBR"],
    slices: months.flatMap((month) => [
      { company: "MBAB" as const, month },
      ...(month === "2026-10" ? [{ company: "MBR" as const, month }] : []),
    ]),
    facts: months.map((month) => ({
      metricKey: "timmar",
      company: "MBAB",
      month,
      dims: {},
      value: 1,
      sourceRows: [2],
    })),
    report: { rowsRead: 1, rowsUsed: 1, skipped: [], issues: [], warnings: [] },
    totals: months.map((month) => ({ metricKey: "timmar", company: "MBAB", month, value: 1 })),
    ...extra,
  };
}

describe("open months and months after export", () => {
  it("lists the current month and later (Europe/Stockholm)", () => {
    expect(openMonths(result(["2026-08", "2026-09", "2026-10", "2026-11"]), NOW)).toEqual([
      "2026-10",
      "2026-11",
    ]);
    // 23:30 UTC on Sep 30 is already October in Stockholm.
    expect(openMonths(result(["2026-09", "2026-10"]), new Date("2026-09-30T23:30:00Z"))).toEqual([
      "2026-10",
    ]);
  });

  it("finds months after the export date", () => {
    const r = result(["2026-08", "2026-09", "2026-10"], { asOfDate: "2026-09-05" });
    expect(monthsAfterExport(r)).toEqual(["2026-10"]);
    expect(monthsAfterExport(result(["2026-10"]))).toEqual([]);
  });
});

describe("withoutMonths / excludeMonths", () => {
  it("drops facts, slices, totals and ledger rows of the months and recomputes companies", () => {
    const r = result(["2026-09", "2026-10"], {
      ledger: {
        rows: [
          {
            company: "MBAB",
            month: "2026-09",
            account: 3010,
            dimNo: null,
            objectCode: null,
            amount: -1,
            yearOffset: 0,
            source: "psaldo",
          },
          {
            company: "MBAB",
            month: "2026-10",
            account: 3010,
            dimNo: null,
            objectCode: null,
            amount: -2,
            yearOffset: 0,
            source: "psaldo",
          },
        ],
        accounts: [],
        objects: [],
        checks: {} as never,
      },
    });
    const out = withoutMonths(r, ["2026-10"]);
    expect(out.slices).toEqual([{ company: "MBAB", month: "2026-09" }]);
    expect(out.facts.map((f) => f.month)).toEqual(["2026-09"]);
    expect(out.totals.map((f) => f.month)).toEqual(["2026-09"]);
    expect(out.ledger?.rows.map((x) => x.month)).toEqual(["2026-09"]);
    expect(out.companies).toEqual(["MBAB"]);
    expect(withoutMonths(r, [])).toBe(r);
  });

  it("recomputes the content hash of the remaining facts", async () => {
    const r = result(["2026-09", "2026-10"]);
    const out = await excludeMonths(r, ["2026-10"]);
    expect(out.contentHash).toBe(await factsContentHash(out.facts));
    expect(out.contentHash).not.toBe(r.contentHash);
  });
});

describe("suggestAsOfDate", () => {
  it("prefers dates on export lines, never after today", () => {
    expect(
      suggestAsOfDate(
        ["Period 2026-01-01 – 2026-09-30", "Exporterad 2026-10-01 08:12", "Giltig 2027-01-01"],
        "2026-10-12",
      ),
    ).toBe("2026-10-01");
  });

  it("falls back to any date, then today", () => {
    expect(suggestAsOfDate(["deltagare_2026-09-30.xlsx"], "2026-10-12")).toBe("2026-09-30");
    expect(suggestAsOfDate(["Deltagarlista"], "2026-10-12")).toBe("2026-10-12");
    expect(suggestAsOfDate(["Exporterad 2026-02-30"], "2026-10-12")).toBe("2026-10-12");
  });
});

describe("month options and spans", () => {
  it("lists months newest first including suggestions outside the range", () => {
    const opts = monthOptions(NOW, ["2019-05"], { back: 2, ahead: 1 });
    expect(opts.map((o) => o.value)).toEqual([
      "2026-11",
      "2026-10",
      "2026-09",
      "2026-08",
      "2019-05",
    ]);
    expect(opts[2]).toEqual({ value: "2026-09", label: "sep 2026" });
  });

  it("formats spans", () => {
    expect(formatMonthSpan(["2026-09"])).toBe("sep 2026");
    expect(formatMonthSpan(["2026-09", "2026-01", "2026-05"])).toBe("jan–sep 2026");
    expect(formatMonthSpan(["2025-11", "2026-02"])).toBe("nov 2025 – feb 2026");
    expect(formatMonthSpan([])).toBe("");
  });

  it("gives today's date in Stockholm", () => {
    expect(todayInStockholm(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });
});
