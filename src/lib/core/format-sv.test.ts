import { describe, expect, it } from "vitest";
import {
  MINUS,
  NBSP,
  formatAmount,
  formatDateSv,
  formatDeltaPercent,
  formatDeltaPp,
  formatNumber,
  formatValue,
} from "./format-sv";

const s = (str: string) => str.replaceAll(" ", NBSP);

describe("format-sv", () => {
  it("groups thousands with NBSP and uses decimal comma", () => {
    expect(formatNumber(1234567)).toBe(s("1 234 567"));
    expect(formatNumber(1234567.5, 2)).toBe(s("1 234 567,50"));
    expect(formatNumber(-42)).toBe(`${MINUS}42`);
    expect(formatNumber(-0.001, 1)).toBe("0,0");
  });
  it("formats amounts, compact and full", () => {
    expect(formatAmount(1234567)).toBe(s("1 234 567 kr"));
    expect(formatAmount(2_400_000, { compact: true })).toBe(s("2,4 mkr"));
    expect(formatAmount(845_000, { compact: true })).toBe(s("845 tkr"));
    expect(formatAmount(-2_400_000, { compact: true })).toBe(s(`${MINUS}2,4 mkr`));
    expect(formatAmount(9_500, { compact: true })).toBe(s("9 500 kr"));
  });
  it("formats by unit and handles missing values", () => {
    expect(formatValue(null, "kr")).toBe("–");
    expect(formatValue(8.5, "h")).toBe(s("8,5 h"));
    expect(formatValue(12.5, "pct")).toBe(s("12,5 %"));
    expect(formatValue(42, "st")).toBe("42");
    expect(formatValue(1.873, "faktor")).toBe("1,87");
  });
  it("formats deltas with sign, never color only", () => {
    expect(formatDeltaPercent(12)).toBe(s("+12 %"));
    expect(formatDeltaPercent(-4.2)).toBe(s(`${MINUS}4 %`));
    expect(formatDeltaPercent(0.2)).toBe(s("±0 %"));
    expect(formatDeltaPp(1.25)).toBe(s("+1,3 p.e."));
  });
  it("formats dates in Stockholm time", () => {
    expect(formatDateSv("2026-10-11T23:30:00Z")).toBe("12 okt 2026");
  });
});
