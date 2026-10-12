import { describe, expect, it } from "vitest";
import {
  excelSerialToIso,
  extractMonthCandidates,
  isValidYmd,
  parseDateSv,
  resultMonth,
} from "./dates-sv";

describe("parseDateSv – dates", () => {
  it.each([
    ["2026-09-30", "2026-09-30"],
    ["2026-9-3", "2026-09-03"],
    ["2026-09-30 13:00", "2026-09-30"],
    ["2026-09-30 13:00:59", "2026-09-30"],
    ["2026-09-30T23:30:00Z", "2026-09-30"],
    ["2026-09-30T23:30:00.000+02:00", "2026-09-30"],
    ["2026/09/30", "2026-09-30"],
    ["2026.09.30", "2026-09-30"],
    ["20260930", "2026-09-30"],
    ["30/9 2026", "2026-09-30"],
    ["30/9/2026", "2026-09-30"],
    ["30/9-2026", "2026-09-30"],
    ["30.9.2026", "2026-09-30"],
    ["30-09-2026", "2026-09-30"],
    ["1/2/2026", "2026-02-01"],
    ["30/9/26", "2026-09-30"],
    ["1/1/95", "1995-01-01"],
    ["30.09.2026 08:15", "2026-09-30"],
    ["30 sep 2026", "2026-09-30"],
    ["30 sep. 2026", "2026-09-30"],
    ["30 september 2026", "2026-09-30"],
    ["1 maj 2026", "2026-05-01"],
    ["15 okt 2026", "2026-10-15"],
    ["15 Oktober 2026", "2026-10-15"],
    ["sep 30, 2026", "2026-09-30"],
    ["  30/9 2026  ", "2026-09-30"],
  ])("%j -> %s", (input, expected) => {
    expect(parseDateSv(input)).toEqual({ ok: true, date: expected });
  });
});

describe("parseDateSv – months", () => {
  it.each([
    ["2026-09", "2026-09"],
    ["2026-9", "2026-09"],
    ["202609", "2026-09"],
    ["2026 09", "2026-09"],
    ["2026/09", "2026-09"],
    ["2026_09", "2026-09"],
    ["09-2026", "2026-09"],
    ["9/2026", "2026-09"],
    ["sep 2026", "2026-09"],
    ["Sep 2026", "2026-09"],
    ["sept 2026", "2026-09"],
    ["Sept. 2026", "2026-09"],
    ["september 2026", "2026-09"],
    ["September 2026", "2026-09"],
    ["maj 2026", "2026-05"],
    ["mars 2026", "2026-03"],
    ["mar 2026", "2026-03"],
    ["okt 2026", "2026-10"],
    ["oct 2026", "2026-10"],
    ["december-2026", "2026-12"],
    ["2026 september", "2026-09"],
  ])("%j -> month %s", (input, expected) => {
    expect(parseDateSv(input)).toEqual({ ok: true, month: expected });
  });
});

describe("parseDateSv – rejections", () => {
  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "31/4 2026",
    "29/2 2026",
    "9/30/2026",
    "2026-13",
    "202613",
    "32 sep 2026",
    "september",
    "hej",
    "",
    "   ",
  ])("%j is rejected", (input) => {
    const r = parseDateSv(input);
    expect(r.ok).toBe(false);
  });

  it("accepts leap days only in leap years", () => {
    expect(parseDateSv("29/2 2024")).toEqual({ ok: true, date: "2024-02-29" });
    expect(parseDateSv("2000-02-29")).toEqual({ ok: true, date: "2000-02-29" });
    expect(parseDateSv("1900-02-29").ok).toBe(false);
  });

  it("rejects null", () => {
    expect(parseDateSv(null).ok).toBe(false);
  });
});

describe("parseDateSv – numbers", () => {
  it("reads Excel serials only with isExcelDate", () => {
    expect(parseDateSv(46295, { isExcelDate: true })).toEqual({ ok: true, date: "2026-09-30" });
    expect(parseDateSv(46295).ok).toBe(false);
  });

  it("ignores the time fraction of a serial", () => {
    expect(parseDateSv(46295.75, { isExcelDate: true })).toEqual({
      ok: true,
      date: "2026-09-30",
    });
    expect(parseDateSv(46295.999999999, { isExcelDate: true })).toEqual({
      ok: true,
      date: "2026-10-01",
    });
  });

  it("reads 8/6-digit numbers as YYYYMMDD/YYYYMM", () => {
    expect(parseDateSv(20260930)).toEqual({ ok: true, date: "2026-09-30" });
    expect(parseDateSv(202609)).toEqual({ ok: true, month: "2026-09" });
    expect(parseDateSv(12345).ok).toBe(false);
  });

  it("uses the 1904 system when asked", () => {
    expect(parseDateSv(0, { isExcelDate: true, date1904: true })).toEqual({
      ok: true,
      date: "1904-01-01",
    });
    expect(parseDateSv(1000, { isExcelDate: true, date1904: true })).toEqual({
      ok: true,
      date: "1906-09-27",
    });
    // Same day in both systems differs by 1462 serials.
    expect(parseDateSv(46295 - 1462, { isExcelDate: true, date1904: true })).toEqual({
      ok: true,
      date: "2026-09-30",
    });
  });
});

describe("excelSerialToIso", () => {
  it("handles the 1900 leap-year bug", () => {
    expect(excelSerialToIso(1)).toBe("1900-01-01");
    expect(excelSerialToIso(59)).toBe("1900-02-28");
    expect(excelSerialToIso(60)).toBeNull();
    expect(excelSerialToIso(61)).toBe("1900-03-01");
  });

  it("maps known serials", () => {
    expect(excelSerialToIso(25569)).toBe("1970-01-01");
    expect(excelSerialToIso(45351)).toBe("2024-02-29");
    expect(excelSerialToIso(46022)).toBe("2025-12-31");
    expect(excelSerialToIso(46023)).toBe("2026-01-01");
  });

  it("rejects out-of-range serials", () => {
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(-5)).toBeNull();
    expect(excelSerialToIso(3_000_000)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
    expect(excelSerialToIso(-1, true)).toBeNull();
  });
});

describe("helpers", () => {
  it("isValidYmd", () => {
    expect(isValidYmd(2026, 9, 30)).toBe(true);
    expect(isValidYmd(2026, 9, 31)).toBe(false);
    expect(isValidYmd(1899, 12, 31)).toBe(false);
  });

  it("resultMonth", () => {
    expect(resultMonth(parseDateSv("2026-09-30"))).toBe("2026-09");
    expect(resultMonth(parseDateSv("sep 2026"))).toBe("2026-09");
    expect(resultMonth(parseDateSv("nope"))).toBeNull();
  });
});

describe("extractMonthCandidates", () => {
  const top = (text: string) => extractMonthCandidates(text)[0];

  it.each([
    ["intelliplan_timmar_MBAB_2026-09.xlsx", "2026-09"],
    ["Rapport september 2026", "2026-09"],
    ["202609", "2026-09"],
    ["export_202609.csv", "2026-09"],
    ["2026_09", "2026-09"],
    ["09-2026", "2026-09"],
    ["deltagare_09_2026.xlsx", "2026-09"],
    ["Period: 2026-09-01 - 2026-09-30", "2026-09"],
    ["Månadsrapport Sept. 2026", "2026-09"],
    ["timmar_sep_2026.xlsx", "2026-09"],
    ["Löner 2026 september", "2026-09"],
    ["30 september 2026", "2026-09"],
    ["Utskrivet 30/9 2026", "2026-09"],
  ])("%j -> %s", (text, month) => {
    expect(top(text)?.month).toBe(month);
  });

  it("ranks explicit months above print dates", () => {
    const c = extractMonthCandidates("timmar_2026-09_utskrivet_2026-10-01.xlsx");
    expect(c.map((x) => x.month)).toEqual(["2026-09", "2026-10"]);
    expect(c[0]!.confidence).toBeGreaterThan(c[1]!.confidence);
  });

  it("boosts repeated mentions", () => {
    const one = extractMonthCandidates("2026-09-01");
    const two = extractMonthCandidates("2026-09-01 - 2026-09-30");
    expect(two[0]!.confidence).toBeGreaterThan(one[0]!.confidence);
  });

  it("ignores impossible months, years out of range and long digit runs", () => {
    expect(extractMonthCandidates("2026-13")).toEqual([]);
    expect(extractMonthCandidates("order 1234567")).toEqual([]);
    expect(extractMonthCandidates("konto 3010")).toEqual([]);
    expect(extractMonthCandidates("1850-01")).toEqual([]);
    expect(extractMonthCandidates("Sida 1 av 3")).toEqual([]);
  });

  it("does not read org numbers as months", () => {
    expect(extractMonthCandidates("Org.nr 556959-9318")).toEqual([]);
  });

  it("confidence is within 0..1", () => {
    for (const c of extractMonthCandidates("2026-09 2026-09 2026-09 2026-09 september 2026")) {
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});
