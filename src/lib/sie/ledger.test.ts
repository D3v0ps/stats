import { describe, expect, it } from "vitest";
import type { CompanyCode, LedgerRow } from "@/lib/contracts";
import { monthRange } from "@/lib/core/month";
import { decodeSie } from "./decode";
import { countsInBalance, detectPsaldoMode, toLedger, type LedgerResult } from "./ledger";
import { parseSie, type SieFile } from "./parse";
import { readSieFixture, readSieTruth, SIE_FIXTURES, type SieTruth } from "./test-fixtures";

function load(name: string): { sie: SieFile; truth: SieTruth } {
  return { sie: parseSie(decodeSie(readSieFixture(name)).text), truth: readSieTruth(name) };
}

const ore = (kr: number) => Math.round(kr * 100);

/** account -> month -> öre for the selected rows (each key occurs once per year). */
function nest(rows: LedgerRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byMonth = (out[r.account] ??= {});
    expect(byMonth[r.month]).toBeUndefined();
    byMonth[r.month] = ore(r.amount);
  }
  return out;
}

function toOreNested(
  t: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(t).map(([k, byMonth]) => [
      k,
      Object.fromEntries(Object.entries(byMonth).map(([m, v]) => [m, ore(v)])),
    ]),
  );
}

const totals = (rows: LedgerRow[], yearOffset: number) =>
  rows.filter((r) => r.yearOffset === yearOffset && r.dimNo === null);
const objectRows = (rows: LedgerRow[], yearOffset: number, dimNo: number, code: string) =>
  rows.filter((r) => r.yearOffset === yearOffset && r.dimNo === dimNo && r.objectCode === code);

function ledgerFor(
  name: string,
  objectDims?: number[],
): { result: LedgerResult; truth: SieTruth; sie: SieFile } {
  const { sie, truth } = load(name);
  const company: CompanyCode = truth.company ?? "MBAB";
  return { result: toLedger(sie, company, objectDims ? { objectDims } : {}), truth, sie };
}

describe.each(SIE_FIXTURES)("toLedger(%s) against the generator's truth", (name) => {
  const { result, truth } = ledgerFor(name);

  it("detects the source and PSALDO mode", () => {
    expect(result.psaldoMode).toBe(truth.psaldoMode);
    expect(result.usedTransFallback).toBe(truth.usedTransFallback);
    for (const year of Object.values(truth.years)) {
      expect(result.diagnostics.years.find((y) => y.yearOffset === year.yearOffset)?.source).toBe(
        year.source,
      );
    }
  });

  it("produces account totals per month exact to the öre", () => {
    for (const year of Object.values(truth.years)) {
      expect(nest(totals(result.rows, year.yearOffset))).toEqual(toOreNested(year.accountMonth));
    }
  });

  it("produces kostnadsställe rows per month exact to the öre", () => {
    for (const year of Object.values(truth.years)) {
      const expected = year.objectAccountMonth["1"] ?? {};
      for (const [code, byAccount] of Object.entries(expected)) {
        expect(nest(objectRows(result.rows, year.yearOffset, 1, code))).toEqual(
          toOreNested(byAccount),
        );
      }
      const codes = new Set(
        result.rows
          .filter((r) => r.yearOffset === year.yearOffset && r.dimNo === 1)
          .map((r) => r.objectCode),
      );
      expect([...codes].sort()).toEqual(Object.keys(expected).sort());
    }
  });

  it("keeps object rows apart from totals: Σ objects + ofördelat = total", () => {
    for (const year of Object.values(truth.years)) {
      for (const r of totals(result.rows, year.yearOffset)) {
        const objects = result.rows
          .filter(
            (o) =>
              o.yearOffset === year.yearOffset &&
              o.dimNo === 1 &&
              o.account === r.account &&
              o.month === r.month,
          )
          .reduce((a, o) => a + ore(o.amount), 0);
        const unallocated = ore(year.unallocatedAccountMonth[r.account]?.[r.month] ?? 0);
        expect(objects + unallocated).toBe(ore(r.amount));
      }
    }
  });

  it("gives the result per month from totals only", () => {
    for (const year of Object.values(truth.years)) {
      const perMonth: Record<string, number> = {};
      for (const r of totals(result.rows, year.yearOffset)) {
        perMonth[r.month] = (perMonth[r.month] ?? 0) - ore(r.amount);
      }
      expect(perMonth).toEqual(
        Object.fromEntries(Object.entries(year.resultPerMonth).map(([m, v]) => [m, ore(v)])),
      );
      expect(Object.values(perMonth).reduce((a, b) => a + b, 0)).toBe(ore(year.resultYtd));
    }
  });

  it("only emits result accounts inside the fiscal years, flagged by year", () => {
    for (const r of result.rows) {
      expect(r.company).toBe(truth.company ?? "MBAB");
      expect(r.account).toBeGreaterThanOrEqual(3000);
      expect(r.account).toBeLessThanOrEqual(8999);
      expect(r.amount).not.toBe(0);
      const year = truth.years[String(r.yearOffset)];
      expect(year).toBeDefined();
      expect(r.month >= (year?.start.slice(0, 7) ?? "")).toBe(true);
      expect(r.month <= (year?.end.slice(0, 7) ?? "")).toBe(true);
      expect(r.source).toBe(year?.source);
      expect(r.dimNo === null).toBe(r.objectCode === null);
    }
  });

  it("emits no rows for dimensions outside objectDims", () => {
    expect(result.rows.some((r) => r.dimNo !== null && r.dimNo !== 1)).toBe(false);
  });
});

describe("toLedger with objectDims [1, 6]", () => {
  it.each(["mbab_2026_psaldo.se", "mbab_2026_cumulative.se", "unknown_org.se"])(
    "%s: adds project rows next to kostnadsställe rows",
    (name) => {
      const { result, truth } = ledgerFor(name, [1, 6]);
      let projectRows = 0;
      for (const year of Object.values(truth.years)) {
        for (const [code, byAccount] of Object.entries(year.objectAccountMonth["6"] ?? {})) {
          const rows = objectRows(result.rows, year.yearOffset, 6, code);
          projectRows += rows.length;
          expect(nest(rows)).toEqual(toOreNested(byAccount));
        }
      }
      expect(projectRows).toBeGreaterThan(0);
      // Adding a dimension never changes the totals.
      expect(result.rows.filter((r) => r.dimNo === null)).toEqual(
        ledgerFor(name).result.rows.filter((r) => r.dimNo === null),
      );
    },
  );
});

describe("PSALDO movement vs cumulative", () => {
  it("detects movements and cumulative balances by comparing with #RES", () => {
    const movement = load("mbab_2026_psaldo.se").sie;
    const cumulative = load("mbab_2026_cumulative.se").sie;
    const m = detectPsaldoMode(movement, [0, -1]);
    const c = detectPsaldoMode(cumulative, [0, -1]);
    expect(m).toMatchObject({ mode: "movement", assumed: false });
    expect(m.votes.cumulative).toBe(0);
    expect(c).toMatchObject({ mode: "cumulative", assumed: false });
    expect(c.votes.movement).toBe(0);
  });

  it("converts cumulative balances to the same movements (incl. months without a line)", () => {
    const movement = ledgerFor("mbab_2026_psaldo.se").result;
    const cumulative = ledgerFor("mbab_2026_cumulative.se").result;
    expect(cumulative.psaldoMode).toBe("cumulative");
    expect(cumulative.rows).toEqual(movement.rows);
    // 8310 is written only in quarter months in the cumulative file.
    expect(
      cumulative.rows
        .filter((r) => r.account === 8310 && r.yearOffset === 0 && r.dimNo === null)
        .map((r) => r.month),
    ).toEqual(["2026-03", "2026-06", "2026-09"]);
  });

  it("assumes movements when #RES cannot decide", () => {
    const sie = parseSie(
      [
        "#RAR 0 20260101 20261231",
        "#PSALDO 0 202601 3041 {} -100.00",
        "#PSALDO 0 202602 3041 {} -150.00",
      ].join("\n"),
    );
    const result = toLedger(sie, "MBAB");
    expect(result.psaldoMode).toBe("movement");
    expect(result.diagnostics.psaldoModeAssumed).toBe(true);
    expect(result.rows.map((r) => [r.month, r.amount])).toEqual([
      ["2026-01", -100],
      ["2026-02", -150],
    ]);
  });

  it("does not let single-period accounts vote", () => {
    const sie = parseSie(
      [
        "#RES 0 3041 -250.00",
        "#RES 0 5010 40.00",
        "#PSALDO 0 202601 3041 {} -100.00",
        "#PSALDO 0 202602 3041 {} -250.00",
        "#PSALDO 0 202601 5010 {} 40.00",
      ].join("\n"),
    );
    expect(detectPsaldoMode(sie, [0])).toEqual({
      mode: "cumulative",
      assumed: false,
      votes: { movement: 0, cumulative: 1 },
    });
    expect(toLedger(sie, "MBAB").rows.map((r) => [r.account, r.month, r.amount])).toEqual([
      [3041, "2026-01", -100],
      [5010, "2026-01", 40],
      [3041, "2026-02", -150],
    ]);
  });

  it("ignores multi-object rows and rows in other dimensions", () => {
    const { result } = ledgerFor("mbab_2026_psaldo.se");
    expect(result.diagnostics.multiObjectRowsIgnored).toBeGreaterThan(0);
    expect(result.diagnostics.otherDimRowsIgnored).toBeGreaterThan(0);
    const both = ledgerFor("mbab_2026_psaldo.se", [1, 6]).result;
    expect(both.diagnostics.multiObjectRowsIgnored).toBe(result.diagnostics.multiObjectRowsIgnored);
    expect(both.diagnostics.otherDimRowsIgnored).toBe(0);
  });
});

describe("previous year", () => {
  it("flags previous-year PSALDO rows with yearOffset -1", () => {
    const { result } = ledgerFor("mbab_2026_psaldo.se");
    const months = (offset: number) =>
      [...new Set(result.rows.filter((r) => r.yearOffset === offset).map((r) => r.month))].sort();
    expect(months(0)).toEqual(monthRange("2026-01", "2026-09"));
    expect(months(-1)).toEqual(monthRange("2025-01", "2025-12"));
  });

  it("assigns broken fiscal year months by calendar month", () => {
    const { result } = ledgerFor("mbr_broken_fy.se");
    const months = (offset: number) =>
      [...new Set(result.rows.filter((r) => r.yearOffset === offset).map((r) => r.month))].sort();
    expect(months(0)).toEqual(monthRange("2025-05", "2026-04"));
    expect(months(-1)).toEqual(monthRange("2024-05", "2025-04"));
  });
});

describe("#VER/#TRANS fallback", () => {
  const { result, sie, truth } = ledgerFor("mbr_2026_trans_only.se");

  it("uses vouchers when a year has no PSALDO for result accounts", () => {
    expect(result.usedTransFallback).toBe(true);
    expect(result.psaldoMode).toBe("none");
    expect(result.rows.every((r) => r.source === "trans" && r.yearOffset === 0)).toBe(true);
    expect(result.diagnostics.years).toEqual([
      { yearNo: 0, yearOffset: 0, source: "trans" },
      { yearNo: -1, yearOffset: -1, source: "none" },
    ]);
  });

  it("skips #BTRANS rows", () => {
    expect(
      sie.ver.some((v) => v.trans.some((t) => t.kind === "btrans" && t.account === 5410)),
    ).toBe(true);
    expect(result.rows.some((r) => r.account === 5410)).toBe(false);
  });

  it("counts #RTRANS once and never its duplicate #TRANS", () => {
    const sum = (account: number, month: string) =>
      ore(
        totals(result.rows, 0).find((r) => r.account === account && r.month === month)?.amount ?? 0,
      );
    // March: 6110 got 1 000 kr + an added row of 500 kr (plus the accrual of April's invoice).
    expect(sum(6110, "2026-03")).toBe(
      ore(truth.years["0"]?.accountMonth["6110"]?.["2026-03"] ?? NaN),
    );
    const naive = sie.ver
      .flatMap((v) => v.trans.filter((t) => t.kind !== "btrans").map((t) => ({ v, t })))
      .filter(({ t }) => t.account === 6110);
    const doubleCounted = naive.reduce((a, { t }) => a + ore(t.amount), 0);
    const counted = sie.ver
      .flatMap((v) => v.trans.filter(countsInBalance))
      .filter((t) => t.account === 6110)
      .reduce((a, t) => a + ore(t.amount), 0);
    expect(doubleCounted - counted).toBe(2 * 50_000); // two #RTRANS of 500 kr in the year
    expect(
      totals(result.rows, 0)
        .filter((r) => r.account === 6110)
        .reduce((a, r) => a + ore(r.amount), 0),
    ).toBe(counted);
  });

  it("uses the transdate for the month, and the voucher date outside the fiscal year", () => {
    // Booked 2026-04-30 with transdate 2026-05-01: belongs to May.
    const it6540 = totals(result.rows, 0)
      .filter((r) => r.account === 6540)
      .map((r) => r.month);
    expect(it6540).toEqual(["2026-05", "2026-08"]);
    // January's supplier invoice is accrued to 2025-12-31, outside the year: stays in January.
    expect(result.diagnostics.transDateOutsideYear).toBe(2);
    expect(totals(result.rows, 0).some((r) => r.month < "2026-01")).toBe(false);
  });

  it("assigns object rows from the transaction objects", () => {
    const krom = objectRows(result.rows, 0, 1, "410").filter((r) => r.account === 7210);
    expect(krom.map((r) => r.month)).toEqual(monthRange("2026-01", "2026-09"));
  });

  it("takes every voucher as the current year when #RAR is missing", () => {
    const noRar = parseSie(
      [
        '#VER A 1 20260105 "x"',
        "{",
        '#TRANS 3041 {1 "100"} -10.00',
        "#TRANS 1930 {} 10.00",
        "}",
      ].join("\n"),
    );
    const r = toLedger(noRar, "MBR");
    expect(r.usedTransFallback).toBe(true);
    expect(r.rows).toEqual([
      {
        company: "MBR",
        month: "2026-01",
        account: 3041,
        dimNo: null,
        objectCode: null,
        amount: -10,
        yearOffset: 0,
        source: "trans",
      },
      {
        company: "MBR",
        month: "2026-01",
        account: 3041,
        dimNo: 1,
        objectCode: "100",
        amount: -10,
        yearOffset: 0,
        source: "trans",
      },
    ]);
  });

  it("falls back to vouchers when PSALDO only covers balance accounts, and counts stray vouchers", () => {
    const text = [
      "#RAR 0 20260101 20261231",
      "#RAR -1 20250101 20251231",
      "#PSALDO 0 202601 1930 {} 10.00",
      '#VER A 1 20260105 "x"',
      "{",
      "#TRANS 3041 {} -10.00",
      "#TRANS 1930 {} 10.00",
      "}",
      '#VER A 2 20250303 "förra året"',
      "{",
      "#TRANS 5010 {} 7.00",
      "#TRANS 1930 {} -7.00",
      "}",
      '#VER A 3 20240101 "utanför"',
      "{",
      "#TRANS 5010 {} 1.00",
      "#TRANS 1930 {} -1.00",
      "}",
      '#VER A 4 20261340 "fel datum"',
      "{",
      "#TRANS 5010 {} 2.00",
      "#TRANS 1930 {} -2.00",
      "}",
    ].join("\n");
    const r = toLedger(parseSie(text), "MBAB");
    expect(r.psaldoMode).toBe("none");
    expect(r.rows.map((x) => [x.yearOffset, x.month, x.account, x.amount])).toEqual([
      [0, "2026-01", 3041, -10],
      [-1, "2025-03", 5010, 7],
    ]);
    expect(r.diagnostics.vouchersOutsideYears).toBe(1);
    expect(r.diagnostics.vouchersWithoutDate).toBe(1);
  });
});
