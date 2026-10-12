import { describe, expect, it } from "vitest";
import {
  MONTH_OPTIONS,
  buildPeriodRows,
  fiscalExplanation,
  fiscalQuarters,
  fiscalYearSpan,
} from "./periods";

describe("buildPeriodRows", () => {
  it("merges data and closed months per company, newest first", () => {
    const rows = buildPeriodRows(
      [
        { company: "MBAB", month: "2026-08", datasets: ["ip_fakturering", "ip_timmar"] },
        { company: "MBR", month: "2026-09", datasets: ["wb_deltagare"] },
      ],
      [{ company: "MBAB", month: "2026-07", closedAt: "2026-08-03T10:00:00Z" }],
      {
        ip_timmar: "Intelliplan – timmar och pass",
        ip_fakturering: "Intelliplan – fakturerat och lön",
        wb_deltagare: "Workbuster – deltagare",
      },
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(rows[1]?.cells.MBAB.datasets).toEqual([
      "Intelliplan – timmar och pass",
      "Intelliplan – fakturerat och lön",
    ]);
    expect(rows[1]?.cells.MBR).toEqual({ datasets: [], closedAt: null });
    expect(rows[2]?.cells.MBAB).toEqual({ datasets: [], closedAt: "2026-08-03T10:00:00Z" });
  });

  it("keeps unknown dataset keys as-is", () => {
    const rows = buildPeriodRows([{ company: "MBR", month: "2026-01", datasets: ["ny"] }], [], {});
    expect(rows[0]?.cells.MBR.datasets).toEqual(["ny"]);
  });
});

describe("fiscal year", () => {
  it("describes calendar and broken fiscal years", () => {
    expect(fiscalYearSpan(1)).toBe("januari–december");
    expect(fiscalYearSpan(7)).toBe("juli–juni");
    expect(fiscalQuarters(1)).toEqual([
      "januari–mars",
      "april–juni",
      "juli–september",
      "oktober–december",
    ]);
    expect(fiscalQuarters(11)[0]).toBe("november–januari");
    expect(fiscalExplanation(5)).toBe(
      "Räkenskapsåret är maj–april. ”Hittills i år” räknas från maj, och kvartal 1 är maj–juli.",
    );
  });

  it("offers twelve capitalized months", () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
    expect(MONTH_OPTIONS[0]).toEqual({ value: 1, label: "Januari" });
    expect(MONTH_OPTIONS[11]).toEqual({ value: 12, label: "December" });
  });
});
