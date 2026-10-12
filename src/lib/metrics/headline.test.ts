import { describe, expect, it } from "vitest";
import type { CompareCell } from "@/lib/contracts/metric-query";
import { NBSP } from "@/lib/core/format-sv";
import { makeCompareCell } from "./compare";
import {
  HEADLINE_MAX_LENGTH,
  headlineSubjectOf,
  headlineTrend,
  normalizeHeadline,
  suggestHeadline,
  type HeadlineInput,
} from "./headline";

const cell = (current: number | null, base: number | null, unit: HeadlineInput["unit"] = "st") =>
  makeCompareCell(current, base, unit, "augusti 2026");

const headline = (over: Partial<HeadlineInput>): string =>
  suggestHeadline({
    subject: "DELTAGARNA",
    filterLabels: [],
    current: 120,
    compare: cell(120, 100),
    unit: "st",
    ...over,
  });

describe("suggestHeadline wording", () => {
  it("says ÖKAR / MINSKAR / LIGGER STILLA by the relative change", () => {
    const krom = [{ dimension: "verksamhet", label: "KROM" }];
    expect(headline({ filterLabels: krom })).toBe("DELTAGARNA I KROM ÖKAR.");
    expect(headline({ filterLabels: krom, current: 80, compare: cell(80, 100) })).toBe(
      "DELTAGARNA I KROM MINSKAR.",
    );
    expect(headline({ current: 101, compare: cell(101, 100) })).toBe("DELTAGARNA LIGGER STILLA.");
  });

  it("treats |deltaPct| below 2 as flat", () => {
    expect(headline({ compare: cell(101.9, 100) })).toBe("DELTAGARNA LIGGER STILLA.");
    expect(headline({ compare: cell(98.1, 100) })).toBe("DELTAGARNA LIGGER STILLA.");
    expect(headline({ compare: cell(102, 100) })).toBe("DELTAGARNA ÖKAR.");
    expect(headline({ compare: cell(98, 100) })).toBe("DELTAGARNA MINSKAR.");
  });

  it("uses percentage points for pct metrics (|Δ| below 1 p.e. is flat)", () => {
    const base = { subject: "SJUKFRÅNVARON", unit: "pct" as const };
    // +8 % relative but only +0.5 p.e.
    expect(headline({ ...base, current: 6.5, compare: cell(6.5, 6, "pct") })).toBe(
      "SJUKFRÅNVARON LIGGER STILLA.",
    );
    expect(headline({ ...base, current: 7, compare: cell(7, 6, "pct") })).toBe(
      "SJUKFRÅNVARON ÖKAR.",
    );
    expect(headline({ ...base, current: 4.5, compare: cell(4.5, 6, "pct") })).toBe(
      "SJUKFRÅNVARON MINSKAR.",
    );
  });

  it("decides by the sign of the change when the base is 0", () => {
    expect(headline({ current: 3, compare: cell(3, 0) })).toBe("DELTAGARNA ÖKAR.");
    expect(headline({ current: 0, compare: cell(0, 0) })).toBe("DELTAGARNA LIGGER STILLA.");
  });

  it("states the value when there is no comparison", () => {
    expect(headline({ subject: "RESULTATET", unit: "kr", current: 2_400_000, compare: null })).toBe(
      `RESULTATET: 2,4${NBSP}MKR.`,
    );
    expect(
      headline({ subject: "TIMMARNA", unit: "h", current: 1234, compare: null, decimals: 0 }),
    ).toBe(`TIMMARNA: 1${NBSP}234${NBSP}H.`);
    expect(
      headline({ subject: "FAKTORN", unit: "faktor", current: 1.1428, compare: null, decimals: 2 }),
    ).toBe("FAKTORN: 1,14.");
    expect(headline({ current: 42, compare: null })).toBe("DELTAGARNA: 42.");
  });

  it("falls back to the value form when the comparison has no data", () => {
    expect(headline({ current: 42, compare: cell(42, null) })).toBe("DELTAGARNA: 42.");
    expect(headline({ current: null, compare: cell(null, 40) })).toBe("DELTAGARNA: –.");
  });
});

describe("suggestHeadline subject phrasing", () => {
  it("phrases customers with HOS, programs and places with I, other dimensions with FÖR", () => {
    expect(
      headline({ subject: "TIMMARNA", filterLabels: [{ dimension: "kund", label: "IKEA" }] }),
    ).toBe("TIMMARNA HOS IKEA ÖKAR.");
    expect(headline({ filterLabels: [{ dimension: "ort", label: "Göteborg" }] })).toBe(
      "DELTAGARNA I GÖTEBORG ÖKAR.",
    );
    expect(
      headline({
        subject: "SJUKTIMMARNA",
        filterLabels: [{ dimension: "franvarotyp", label: "Sjuk LO" }],
      }),
    ).toBe("SJUKTIMMARNA FÖR SJUK LO ÖKAR.");
  });

  it("joins several values of a dimension in Swedish", () => {
    const v = (label: string) => ({ dimension: "verksamhet", label });
    expect(headline({ filterLabels: [v("KROM"), v("KVL")] })).toBe(
      "DELTAGARNA I KROM OCH KVL ÖKAR.",
    );
    expect(headline({ filterLabels: [v("KROM"), v("KVL"), v("ROM2")] })).toBe(
      "DELTAGARNA I KROM, KVL OCH ROM2 ÖKAR.",
    );
    expect(headline({ filterLabels: [v("KROM"), v("KROM")] })).toBe("DELTAGARNA I KROM ÖKAR.");
  });

  it("names a single company but not Summa bolag", () => {
    expect(headline({ companyLabel: "MB AB" })).toBe("DELTAGARNA I MB AB ÖKAR.");
    expect(headline({ companyLabel: "MB Restart" })).toBe("DELTAGARNA I MB RESTART ÖKAR.");
    expect(headline({ companyLabel: "Summa bolag" })).toBe("DELTAGARNA ÖKAR.");
    expect(
      headline({
        companyLabel: "MB Restart",
        filterLabels: [{ dimension: "verksamhet", label: "KROM" }],
      }),
    ).toBe("DELTAGARNA I KROM I MB RESTART ÖKAR.");
  });

  it("uppercases with the Swedish locale and always ends with a single dot", () => {
    expect(
      headline({
        subject: "andelen till arbete",
        filterLabels: [{ dimension: "ort", label: "Örnsköldsvik och Älmhult" }],
      }),
    ).toBe("ANDELEN TILL ARBETE I ÖRNSKÖLDSVIK OCH ÄLMHULT ÖKAR.");
    expect(headline({ subject: "Deltagarna." })).toBe("DELTAGARNA ÖKAR.");
  });
});

describe("suggestHeadline length", () => {
  it("truncates a long filter label with an ellipsis to fit 60 characters", () => {
    const h = headline({
      subject: "FAKTURERINGEN",
      filterLabels: [
        { dimension: "kund", label: "Stockholms läns landsting regionala kollektivtrafik" },
      ],
    });
    expect(h).toBe("FAKTURERINGEN HOS STOCKHOLMS LÄNS LANDSTING REGIONALA… ÖKAR.");
    expect(h.length).toBe(HEADLINE_MAX_LENGTH);
  });

  it('collapses several long values to "… M.FL." before truncating', () => {
    const h = headline({
      filterLabels: [
        { dimension: "verksamhet", label: "Karriärvägledning" },
        { dimension: "verksamhet", label: "Stöd och matchning" },
        { dimension: "verksamhet", label: "Rusta och matcha" },
      ],
    });
    expect(h).toBe("DELTAGARNA I KARRIÄRVÄGLEDNING M.FL. ÖKAR.");
  });

  it("drops the company and then filters when shortening labels is not enough", () => {
    const h = headline({
      subject: "ANDELEN TILL ARBETE ELLER STUDIER",
      companyLabel: "MB Restart",
      filterLabels: [
        { dimension: "verksamhet", label: "Stöd och matchning" },
        { dimension: "ort", label: "Göteborg" },
      ],
    });
    // Without the company and the last filter the first label fits untruncated.
    expect(h).toBe("ANDELEN TILL ARBETE ELLER STUDIER I STÖD OCH MATCHNING ÖKAR.");
    expect(h.length).toBe(HEADLINE_MAX_LENGTH);
  });

  it("keeps the company and cuts a long label between words", () => {
    const h = headline({
      subject: "FAKTURERINGEN",
      companyLabel: "MB Restart",
      filterLabels: [{ dimension: "kund", label: "Göteborgs Stads Leasing Aktiebolag" }],
    });
    expect(h).toBe("FAKTURERINGEN HOS GÖTEBORGS STADS… I MB RESTART ÖKAR.");
  });

  it("cuts inside a word only when there is no sensible word boundary", () => {
    const h = headline({
      subject: "FAKTURERINGEN",
      filterLabels: [{ dimension: "kund", label: "Arbetsmarknadsförvaltningsmyndigheten Västra" }],
    });
    expect(h).toBe("FAKTURERINGEN HOS ARBETSMARKNADSFÖRVALTNINGSMYNDIGHET… ÖKAR.");
    expect(h.length).toBeLessThanOrEqual(HEADLINE_MAX_LENGTH);
  });

  it("never exceeds the limit for any combination that can fit", () => {
    const labels = ["Kommunal förvaltning i Norrbotten", "Volvo Personvagnar AB", "Scania CV"];
    for (let n = 0; n <= labels.length; n++) {
      const h = headline({
        subject: "TIMMARNA",
        companyLabel: "MB AB",
        filterLabels: labels.slice(0, n).map((label) => ({ dimension: "kund", label })),
      });
      expect(h.length).toBeLessThanOrEqual(HEADLINE_MAX_LENGTH);
      expect(h.endsWith(".")).toBe(true);
    }
  });
});

describe("headline helpers", () => {
  it("derives the subject from headlineSubject or the uppercased name", () => {
    expect(headlineSubjectOf({ name: "Aktiva deltagare", headlineSubject: "DELTAGARNA" })).toBe(
      "DELTAGARNA",
    );
    expect(headlineSubjectOf({ name: "Fakturerat per kund", headlineSubject: null })).toBe(
      "FAKTURERAT PER KUND",
    );
    expect(headlineSubjectOf({ name: "Snittlön", headlineSubject: "  " })).toBe("SNITTLÖN");
  });

  it("normalizes user headlines to uppercase ending with a dot", () => {
    expect(normalizeHeadline("  rekordmånad för  fakturering ")).toBe(
      "REKORDMÅNAD FÖR FAKTURERING.",
    );
    expect(normalizeHeadline("Klart.")).toBe("KLART.");
  });

  it("classifies trends", () => {
    const none: CompareCell | null = null;
    expect(headlineTrend(none, "st")).toBeNull();
    expect(headlineTrend(cell(5, null), "st")).toBeNull();
    expect(headlineTrend(cell(110, 100), "st")).toBe("up");
    expect(headlineTrend(cell(90, 100), "kr")).toBe("down");
    expect(headlineTrend(cell(-90, -100), "kr")).toBe("up");
    expect(headlineTrend(cell(10.5, 10, "pct"), "pct")).toBe("flat");
  });
});
