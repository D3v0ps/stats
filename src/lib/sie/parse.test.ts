import { describe, expect, it } from "vitest";
import { decodeSie } from "./decode";
import { parseSie, parseSieAmount, parseSieDate, parseSiePeriod } from "./parse";
import { readSieFixture, readSieTruth, SIE_FIXTURES } from "./test-fixtures";

function load(name: string) {
  return { sie: parseSie(decodeSie(readSieFixture(name)).text), truth: readSieTruth(name) };
}

describe("value parsers", () => {
  it("parses dates", () => {
    expect(parseSieDate("20260131")).toBe("2026-01-31");
    expect(parseSieDate("2026-01-31")).toBe("2026-01-31");
    expect(parseSieDate("20240229")).toBe("2024-02-29");
    expect(parseSieDate("20250229")).toBeNull();
    expect(parseSieDate("20261301")).toBeNull();
    expect(parseSieDate("20260100")).toBeNull();
    expect(parseSieDate("2026013")).toBeNull();
    expect(parseSieDate("")).toBeNull();
  });

  it("parses periods", () => {
    expect(parseSiePeriod("202601")).toBe("2026-01");
    expect(parseSiePeriod("2026-12")).toBe("2026-12");
    expect(parseSiePeriod("202613")).toBeNull();
    expect(parseSiePeriod("202600")).toBeNull();
    expect(parseSiePeriod("20261")).toBeNull();
  });

  it("parses amounts", () => {
    expect(parseSieAmount("-1234.50")).toBe(-1234.5);
    expect(parseSieAmount("100")).toBe(100);
    expect(parseSieAmount("+3.1")).toBe(3.1);
    expect(parseSieAmount("12,75")).toBe(12.75);
    expect(parseSieAmount(".5")).toBe(0.5);
    expect(parseSieAmount("1 000.00")).toBeNull();
    expect(parseSieAmount("abc")).toBeNull();
    expect(parseSieAmount("")).toBeNull();
  });
});

describe.each(SIE_FIXTURES)("parseSie(%s)", (name) => {
  const { sie, truth } = load(name);

  it("reads the header", () => {
    expect(sie.flagga).toBe(0);
    expect(sie.format).toBe("PC8");
    expect(sie.sietyp).toBe("4");
    expect(sie.program).toEqual({ name: "MB Stats testgenerator", version: "1.0" });
    expect(sie.gen).toEqual({ date: "2026-10-05", sign: "Syntetisk" });
    expect(sie.fnamn).toBe(truth.companyName);
    expect(sie.orgnr).toBe(truth.orgNr);
  });

  it("reads fiscal years, newest first", () => {
    const expected = Object.entries(truth.fiscalYears)
      .map(([yearNo, y]) => ({ yearNo: Number(yearNo), ...y }))
      .sort((a, b) => b.yearNo - a.yearNo);
    expect(sie.rar).toEqual(expected);
  });

  it("reads accounts, dimensions and objects with Swedish characters", () => {
    expect(Object.fromEntries(Object.entries(sie.konto))).toEqual(truth.accounts);
    expect(sie.dim[1]).toBe("Kostnadsställe");
    expect(sie.objekt).toEqual(
      Object.fromEntries(Object.entries(truth.objects).map(([d, o]) => [Number(d), o])),
    );
  });

  it("reads #RES per year", () => {
    for (const [yearNo, year] of Object.entries(truth.years)) {
      const res = Object.fromEntries(
        sie.res
          .filter((r) => r.yearNo === Number(yearNo))
          .map((r) => [String(r.account), r.amount]),
      );
      expect(res).toEqual(year.res);
    }
  });

  it("reads #PSALDO and vouchers as generated", () => {
    if (truth.psaldoMode === "none") expect(sie.psaldo).toEqual([]);
    else expect(sie.psaldo.length).toBeGreaterThan(0);
    expect(sie.ver).toHaveLength(truth.voucherCount);
    expect(sie.ver.reduce((a, v) => a + v.rtransCount, 0)).toBe(truth.rtransCount);
    expect(sie.ver.reduce((a, v) => a + v.btransCount, 0)).toBe(truth.btransCount);
  });

  it("has no issues or unknown labels", () => {
    expect(sie.issues).toEqual([]);
    expect(sie.issueCount).toBe(0);
    expect(sie.unknownLabels).toEqual({});
    expect(sie.otherLines).toBe(0);
  });

  it("reads #IB and #UB", () => {
    expect(sie.ib.length).toBeGreaterThan(0);
    expect(sie.ub.length).toBe(sie.ib.length);
  });
});

describe("parseSie details", () => {
  it("reads the trans-only fixture's vouchers, transdates and corrections", () => {
    const { sie } = load("mbr_2026_trans_only.se");
    const salary = sie.ver.find((v) => v.series === "L" && v.verno === "1");
    expect(salary).toMatchObject({
      date: "2026-01-25",
      regdate: "2026-01-25",
      text: "Lön januari",
    });
    expect(salary?.trans[0]).toMatchObject({
      kind: "trans",
      account: 7210,
      objects: [[1, "410"]],
      amount: 173685.9,
      transdate: "2026-01-31",
    });
    const correction = sie.ver.find((v) => v.text === "Omföring förbrukning");
    expect(correction?.trans.map((t) => [t.kind, t.account, t.rtransDuplicate ?? false])).toEqual([
      ["trans", 1930, false],
      ["btrans", 5410, false],
      ["rtrans", 5460, false],
      ["trans", 5460, true],
    ]);
    expect(correction?.trans[1]?.text).toBe("Borttagen rad");
    expect(correction?.trans[1]?.transdate).toBeUndefined();
  });

  it("reads PBUDGET and multi-object PSALDO rows", () => {
    const { sie } = load("mbab_2026_psaldo.se");
    expect(sie.pbudget).toHaveLength(24);
    expect(sie.pbudget[0]).toEqual({
      yearNo: 0,
      period: "2026-01",
      account: 3041,
      objects: [],
      amount: -960000,
    });
    expect(
      sie.psaldo.some(
        (p) =>
          p.objects.length === 2 &&
          p.objects[0]?.[0] === 1 &&
          p.objects[1]?.[0] === 6 &&
          p.period === "2026-02",
      ),
    ).toBe(true);
  });

  it("counts unknown labels and reports malformed lines without failing", () => {
    const sie = parseSie(
      [
        "#FLAGGA 0",
        "#FOO 1 2",
        "#FOO 3",
        "#BAR",
        "#KSUMMA 12345",
        "#RAR 0 20261301 20261231",
        "#RAR x 20260101 20261231",
        '#KONTO 12 "För kort"',
        "#RES 0 3041 abc",
        "#PSALDO 0 202613 3041 {} 5.00",
        '#OBJEKT x "1" "Fel"',
        "fri text",
        "",
      ].join("\n"),
    );
    expect(sie.unknownLabels).toEqual({ "#FOO": 2, "#BAR": 1 });
    expect(sie.rar).toEqual([]);
    expect(sie.konto).toEqual({});
    expect(sie.res).toEqual([]);
    expect(sie.psaldo).toEqual([]);
    expect(sie.otherLines).toBe(1);
    expect(sie.recordCount).toBe(11);
    expect(sie.issues.map((i) => [i.lineNo, i.label])).toEqual([
      [6, "#RAR"],
      [7, "#RAR"],
      [8, "#KONTO"],
      [9, "#RES"],
      [10, "#PSALDO"],
      [11, "#OBJEKT"],
      [12, ""],
    ]);
  });

  it("caps the stored issues but keeps counting", () => {
    const lines = Array.from({ length: 600 }, () => "#RES 0 3041 x");
    const sie = parseSie(lines.join("\n"));
    expect(sie.issues).toHaveLength(500);
    expect(sie.issueCount).toBe(600);
  });

  it("replaces duplicate #RAR lines and sorts newest first", () => {
    const sie = parseSie(
      ["#RAR -1 20250101 20251231", "#RAR 0 20250101 20251231", "#RAR 0 20260101 20261231"].join(
        "\n",
      ),
    );
    expect(sie.rar).toEqual([
      { yearNo: 0, start: "2026-01-01", end: "2026-12-31" },
      { yearNo: -1, start: "2025-01-01", end: "2025-12-31" },
    ]);
  });

  it("parses vouchers: blocks, optional fields, quantities and object lists", () => {
    const sie = parseSie(
      [
        '#VER A 1 20260105 "Hyra" 20260107 "KK"',
        "{",
        '  #TRANS 5010 {1 "8"} 45000.00 20260101 "Januari" 2.5 "KK"',
        "  #TRANS 1930 {} -45000.00",
        "}",
        '#VER "" "" 20260106 "Utan nummer"',
        "{",
        "#TRANS 6110 100",
        "#TRANS 1930 -100",
        "}",
      ].join("\r\n"),
    );
    expect(sie.issues).toEqual([]);
    expect(sie.ver).toHaveLength(2);
    expect(sie.ver[0]).toMatchObject({
      series: "A",
      verno: "1",
      date: "2026-01-05",
      regdate: "2026-01-07",
      text: "Hyra",
      rtransCount: 0,
      btransCount: 0,
    });
    expect(sie.ver[0]?.trans[0]).toEqual({
      kind: "trans",
      account: 5010,
      objects: [[1, "8"]],
      amount: 45000,
      transdate: "2026-01-01",
      text: "Januari",
      quantity: 2.5,
      lineNo: 3,
    });
    // A writer that omits the (mandatory) object list.
    expect(sie.ver[1]).toMatchObject({ series: "", verno: "", text: "Utan nummer" });
    expect(sie.ver[1]?.trans.map((t) => [t.account, t.objects, t.amount])).toEqual([
      [6110, [], 100],
      [1930, [], -100],
    ]);
  });

  it("flags only the #TRANS that mirrors the preceding #RTRANS", () => {
    const sie = parseSie(
      [
        '#VER A 1 20260105 "Rättelse"',
        "{",
        "#RTRANS 6110 {} 500.00",
        "#TRANS 6110 {} 500.00",
        "#TRANS 6110 {} 500.00",
        '#RTRANS 7210 {1 "410" 6 "P1"} 200.00',
        '#TRANS 7210 {6 "P1" 1 "410"} 200.00',
        "#RTRANS 6540 {} 300.00",
        "#TRANS 6540 {} 301.00",
        "#TRANS 1930 {} -1801.00",
        "}",
      ].join("\n"),
    );
    const v = sie.ver[0];
    expect(v?.rtransCount).toBe(3);
    expect(v?.trans.map((t) => [t.kind, t.account, t.rtransDuplicate ?? false])).toEqual([
      ["rtrans", 6110, false],
      ["trans", 6110, true],
      ["trans", 6110, false],
      ["rtrans", 7210, false],
      ["trans", 7210, true],
      ["rtrans", 6540, false],
      ["trans", 6540, false],
      ["trans", 1930, false],
    ]);
  });

  it("reports transactions outside a voucher block and unbalanced braces", () => {
    const sie = parseSie(
      [
        "#TRANS 1930 {} 1.00",
        '#VER A 1 20260105 "x"',
        "#TRANS 1930 {} 1.00",
        "{",
        "#TRANS 1930 {} 2.00",
        '#VER A 2 20260106 "y"',
        "{",
        "#TRANS 1930 {} 3.00",
        "}",
        "}",
        '#VER A 3 20261340 "z"',
        "{",
        "#TRANS 1930 {} 4.00",
      ].join("\n"),
    );
    expect(sie.ver.map((v) => [v.verno, v.date, v.trans.map((t) => t.amount)])).toEqual([
      ["1", "2026-01-05", [2]],
      ["2", "2026-01-06", [3]],
      ["3", null, [4]],
    ]);
    expect(sie.issues.map((i) => i.message)).toEqual([
      "Transaktionsrad utanför verifikation ignorerades",
      "Transaktionsrad utanför verifikation ignorerades",
      "Verifikationen saknar avslutande }",
      "Oväntad }",
      "Ogiltigt verifikationsdatum",
      "Verifikationen saknar avslutande }",
    ]);
  });

  it("reads #VER blocks opened on the same line", () => {
    const sie = parseSie(['#VER A 1 20260105 "x" {', "#TRANS 1930 {} 1.00", "}"].join("\n"));
    expect(sie.issues).toEqual([]);
    expect(sie.ver[0]?.trans).toHaveLength(1);
  });

  it("reads #PSALDO without an object list and with a quantity", () => {
    const sie = parseSie(
      ["#PSALDO 0 202601 3041 -5.00", "#PSALDO -1 202501 3041 {} -7.00 3"].join("\n"),
    );
    expect(sie.psaldo).toEqual([
      { yearNo: 0, period: "2026-01", account: 3041, objects: [], amount: -5 },
      { yearNo: -1, period: "2025-01", account: 3041, objects: [], amount: -7, quantity: 3 },
    ]);
  });

  it("reads #OIB, #OUB and #UNDERDIM", () => {
    const sie = parseSie(
      [
        '#OIB 0 1930 {1 "100"} 50.00',
        '#OUB 0 1930 {1 "100"} 75.00',
        '#UNDERDIM 21 "Avdelning" 1',
      ].join("\n"),
    );
    expect(sie.oib).toEqual([{ yearNo: 0, account: 1930, objects: [[1, "100"]], amount: 50 }]);
    expect(sie.oub[0]?.amount).toBe(75);
    expect(sie.dim[21]).toBe("Avdelning");
  });

  it("reports an odd object list and an invalid dimension", () => {
    const sie = parseSie(
      [
        '#VER A 1 20260105 "x"',
        "{",
        '#TRANS 1930 {1 "100" 6} 1.00',
        '#TRANS 1930 {x "1"} -1.00',
        "}",
      ].join("\n"),
    );
    expect(sie.ver[0]?.trans.map((t) => t.objects)).toEqual([[[1, "100"]], []]);
    expect(sie.issues.map((i) => i.message)).toEqual([
      "Ofullständig objektlista",
      "Ogiltigt dimensionsnummer",
    ]);
  });
});
