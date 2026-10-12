import { describe, expect, it } from "vitest";
import {
  addMonths,
  currentMonth,
  dateToMonth,
  daysInMonth,
  formatPeriodLabel,
  isMonth,
  lastClosedMonth,
  monthEndDate,
  monthRange,
  previousPeriod,
  previousYear,
  quarterStart,
  resolvePeriod,
} from "./month";

describe("month basics", () => {
  it("validates months", () => {
    expect(isMonth("2026-09")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-9")).toBe(false);
  });
  it("adds months across years", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("builds inclusive ranges", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthRange("2026-02", "2026-01")).toEqual([]);
  });
  it("handles month ends and leap years", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(monthEndDate("2026-09")).toBe("2026-09-30");
    expect(dateToMonth("2026-09-30")).toBe("2026-09");
  });
  it("uses Stockholm time for the current month", () => {
    // 2026-09-30 22:30 UTC is already October in Stockholm (UTC+2).
    expect(currentMonth(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    expect(lastClosedMonth(new Date("2026-09-30T22:30:00Z"))).toBe("2026-09");
  });
});

describe("period windows", () => {
  it("resolves each grain (calendar fiscal year)", () => {
    expect(resolvePeriod({ grain: "month", anchor: "2026-09" }).months).toEqual(["2026-09"]);
    expect(resolvePeriod({ grain: "quarter", anchor: "2026-08" })).toMatchObject({
      from: "2026-07",
      to: "2026-09",
    });
    expect(resolvePeriod({ grain: "year", anchor: "2026-09" })).toMatchObject({
      from: "2026-01",
      to: "2026-12",
    });
    expect(resolvePeriod({ grain: "ytd", anchor: "2026-09" })).toMatchObject({
      from: "2026-01",
      to: "2026-09",
    });
    expect(resolvePeriod({ grain: "r12", anchor: "2026-09" })).toMatchObject({
      from: "2025-10",
      to: "2026-09",
    });
  });
  it("supports broken fiscal years", () => {
    expect(resolvePeriod({ grain: "ytd", anchor: "2026-03" }, 5)).toMatchObject({
      from: "2025-05",
      to: "2026-03",
    });
    expect(quarterStart("2026-03", 5)).toBe("2026-02");
  });
  it("computes comparison windows", () => {
    const q = resolvePeriod({ grain: "quarter", anchor: "2026-09" });
    expect(previousPeriod(q)).toMatchObject({ from: "2026-04", to: "2026-06" });
    expect(previousYear(q)).toMatchObject({ from: "2025-07", to: "2025-09" });
    expect(previousPeriod(resolvePeriod({ grain: "ytd", anchor: "2026-09" }))).toBeNull();
    expect(previousPeriod(resolvePeriod({ grain: "month", anchor: "2026-01" }))?.anchor).toBe(
      "2025-12",
    );
  });
  it("labels periods in Swedish", () => {
    expect(formatPeriodLabel(resolvePeriod({ grain: "month", anchor: "2026-09" }))).toBe(
      "september 2026",
    );
    expect(formatPeriodLabel(resolvePeriod({ grain: "quarter", anchor: "2026-09" }))).toBe(
      "kv 3 2026",
    );
    expect(formatPeriodLabel(resolvePeriod({ grain: "ytd", anchor: "2026-09" }))).toBe(
      "jan–sep 2026",
    );
    expect(formatPeriodLabel(resolvePeriod({ grain: "r12", anchor: "2026-09" }))).toBe(
      "okt 2025–sep 2026",
    );
  });
});
