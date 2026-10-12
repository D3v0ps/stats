import { describe, expect, it } from "vitest";
import { decodeCp437, encodeCp437 } from "@/lib/core/cp437";
import { buildChecks, normalizeOrgNr, resolveCompany } from "./checks";
import { decodeSie } from "./decode";
import { toLedger } from "./ledger";
import { parseSie } from "./parse";
import { readSieFixture, readSieTruth, SIE_FIXTURES } from "./test-fixtures";

function checksFor(bytes: Uint8Array) {
  const decoded = decodeSie(bytes);
  const sie = parseSie(decoded.text);
  const ledger = toLedger(sie, resolveCompany(sie.orgnr) ?? "MBAB");
  return buildChecks({ sie, decoded, ledger });
}

const checksForText = (text: string) => checksFor(encodeCp437(text));

const ore = (kr: number) => Math.round(kr * 100);

describe("org numbers", () => {
  it("normalizes to NNNNNN-NNNN", () => {
    expect(normalizeOrgNr("556959-9318")).toBe("556959-9318");
    expect(normalizeOrgNr("5569599318")).toBe("556959-9318");
    expect(normalizeOrgNr(" 556959 9318 ")).toBe("556959-9318");
    expect(normalizeOrgNr("16556959-9318")).toBe("556959-9318");
    expect(normalizeOrgNr("SE556959931801")).toBe("SE556959931801");
    expect(normalizeOrgNr("")).toBeNull();
    expect(normalizeOrgNr(null)).toBeNull();
  });

  it("resolves the two companies and nothing else", () => {
    expect(resolveCompany("5569599318")).toBe("MBAB");
    expect(resolveCompany("556959-9318")).toBe("MBAB");
    expect(resolveCompany("5592089071")).toBe("MBR");
    expect(resolveCompany("559208-9071")).toBe("MBR");
    expect(resolveCompany("556677-8899")).toBeNull();
    expect(resolveCompany(null)).toBeNull();
  });
});

describe.each(SIE_FIXTURES)("buildChecks(%s)", (name) => {
  const truth = readSieTruth(name);
  const checks = checksFor(readSieFixture(name));
  const current = truth.years["0"];

  it("identifies the company and file", () => {
    expect(checks.company).toBe(truth.company);
    expect(checks.orgNr).toBe(truth.orgNr);
    expect(checks.companyName).toBe(truth.companyName);
    expect(checks.encoding).toBe(truth.encoding);
    expect(checks.declaredFormat).toBe(truth.declaredFormat);
    expect(checks.usedTransFallback).toBe(truth.usedTransFallback);
    expect(checks.fiscalYears).toEqual(
      Object.entries(truth.fiscalYears)
        .map(([yearNo, y]) => ({ yearNo: Number(yearNo), ...y }))
        .sort((a, b) => b.yearNo - a.yearNo),
    );
  });

  it("computes the result per month and year to date of the current year", () => {
    expect(checks.resultPerMonth.map((r) => [r.month, ore(r.result)])).toEqual(
      Object.entries(current?.resultPerMonth ?? {}).map(([m, v]) => [m, ore(v)]),
    );
    expect(ore(checks.resultYtd)).toBe(ore(current?.resultYtd ?? NaN));
  });

  it("reconciles with #RES", () => {
    expect(checks.resCheck).toEqual({ ok: true, mismatches: [] });
  });
});

describe("buildChecks warnings on fixtures", () => {
  it.each([
    ["mbab_2026_psaldo.se", [/#PSALDO-rader med flera objekt/]],
    ["mbab_2026_cumulative.se", [/flera objekt/, /ackumulerade saldon/]],
    [
      "mbr_2026_trans_only.se",
      [/saknar #PSALDO.*år 0/, /2 transaktioner har transaktionsdatum utanför/],
    ],
    [
      "mbab_declared_pc8_but_1252.se",
      [/anger #FORMAT PC8 men är kodad som Windows-1252/, /flera objekt/],
    ],
    ["mbr_broken_fy.se", []],
    ["unknown_org.se", [/556677-8899 hör inte till något av bolagen/, /flera objekt/]],
  ])("%s", (name, patterns) => {
    const { warnings } = checksFor(readSieFixture(name));
    expect(warnings).toHaveLength(patterns.length);
    patterns.forEach((p, i) => expect(warnings[i]).toMatch(p));
  });
});

describe("resCheck", () => {
  it("detects a tampered #RES", () => {
    const text = decodeCp437(readSieFixture("mbab_2026_psaldo.se"));
    const line = /^#RES 0 5010 (\S+)$/m.exec(text);
    expect(line).not.toBeNull();
    const original = Number(line?.[1]);
    const tampered = text.replace(line?.[0] ?? "", `#RES 0 5010 ${(original + 1000).toFixed(2)}`);
    const checks = checksForText(tampered);
    expect(checks.resCheck.ok).toBe(false);
    expect(checks.resCheck.mismatches).toEqual([
      { account: 5010, psaldoSum: original, res: original + 1000 },
    ]);
    expect(checks.warnings.some((w) => /stämmer inte mot #RES för 1 konto: 5010/.test(w))).toBe(
      true,
    );
  });

  it("tolerates differences below one krona", () => {
    const text = decodeCp437(readSieFixture("mbab_2026_psaldo.se"));
    const line = /^#RES 0 5010 (\S+)$/m.exec(text);
    const nudged = text.replace(
      line?.[0] ?? "",
      `#RES 0 5010 ${(Number(line?.[1]) + 0.99).toFixed(2)}`,
    );
    expect(checksForText(nudged).resCheck.ok).toBe(true);
  });

  it("flags accounts that have movements but no #RES, and #RES without movements", () => {
    const checks = checksForText(
      [
        "#SIETYP 4",
        "#ORGNR 556959-9318",
        "#RAR 0 20260101 20261231",
        "#RES 0 3041 -100.00",
        "#RES 0 6110 20.00",
        "#PSALDO 0 202601 3041 {} -100.00",
        "#PSALDO 0 202601 5010 {} 30.00",
      ].join("\r\n"),
    );
    expect(checks.resCheck.mismatches).toEqual([
      { account: 5010, psaldoSum: 30, res: 0 },
      { account: 6110, psaldoSum: 0, res: 20 },
    ]);
  });

  it("warns instead of failing when #RES is missing", () => {
    const checks = checksForText(
      [
        "#SIETYP 4",
        "#ORGNR 5592089071",
        "#RAR 0 20260101 20261231",
        "#PSALDO 0 202601 3041 {} -100.00",
      ].join("\r\n"),
    );
    expect(checks.company).toBe("MBR");
    expect(checks.resCheck).toEqual({ ok: true, mismatches: [] });
    expect(checks.warnings.some((w) => w.includes("saknar #RES"))).toBe(true);
    expect(checks.resultPerMonth).toEqual([{ month: "2026-01", result: 100 }]);
    expect(checks.resultYtd).toBe(100);
  });
});

describe("structural warnings", () => {
  it("reports missing #ORGNR, #RAR, #SIETYP and an empty file", () => {
    const checks = checksForText("#FLAGGA 0\r\n#FORMAT PC8\r\n");
    expect(checks.company).toBeNull();
    expect(checks.orgNr).toBeNull();
    expect(checks.fiscalYears).toEqual([]);
    expect(checks.resultPerMonth).toEqual([]);
    expect(checks.resultYtd).toBe(0);
    expect(checks.warnings).toEqual([
      expect.stringMatching(/saknar #ORGNR/),
      "Filen saknar #RAR (räkenskapsår).",
      "Filen saknar #SIETYP.",
      expect.stringMatching(/inga belopp på resultatkonton/),
      expect.stringMatching(/saknar #RES/),
    ]);
  });

  it("reports a missing current year, another SIE type, unknown labels, parse issues and names", () => {
    const checks = checksForText(
      [
        "#FORMAT PC8",
        "#SIETYP 3",
        "#ORGNR 556959-9318",
        "#RAR -1 20250101 20251231",
        "#FOO 1",
        "#FOO 2",
        "#BAR",
        "#RES -1 3041 abc",
        '#PSALDO -1 202501 3041 {1 "999"} -10.00',
        "#PSALDO -1 202501 3041 {} -10.00",
      ].join("\r\n"),
    );
    expect(checks.warnings).toEqual([
      "Filen saknar #RAR 0 (innevarande räkenskapsår).",
      "Filen är SIE typ 3; SIE typ 4 förväntas.",
      "1 rad kunde inte tolkas och hoppades över.",
      "Okända poster ignorerades: #BAR (1), #FOO (2).",
      expect.stringMatching(/månadsbelopp har antagits/),
      expect.stringMatching(/inga belopp på resultatkonton/),
      expect.stringMatching(/saknar #RES för innevarande år/),
      "Kontonamn saknas (#KONTO) för: 3041.",
      "Objektnamn saknas (#OBJEKT) för: 1:999.",
    ]);
  });

  it("reports vouchers outside the fiscal years and without a date", () => {
    const checks = checksForText(
      [
        "#FORMAT PC8",
        "#SIETYP 4",
        "#ORGNR 556959-9318",
        "#RAR 0 20260101 20261231",
        '#KONTO 3041 "Försäljning"',
        '#VER A 1 20240105 "gammal"',
        "{",
        "#TRANS 3041 {} -5.00",
        "}",
        '#VER A 2 2026 "inget datum"',
        "{",
        "#TRANS 3041 {} -5.00",
        "}",
        '#VER A 3 20260105 "ok"',
        "{",
        "#TRANS 3041 {} -5.00",
        "}",
      ].join("\r\n"),
    );
    expect(checks.warnings).toEqual([
      "1 rad kunde inte tolkas och hoppades över.",
      expect.stringMatching(/saknar #PSALDO/),
      "1 verifikation saknar giltigt datum och togs inte med.",
      "1 verifikation ligger utanför räkenskapsåren och togs inte med.",
      expect.stringMatching(/saknar #RES/),
    ]);
    expect(checks.resultPerMonth).toEqual([{ month: "2026-01", result: 5 }]);
  });
});
