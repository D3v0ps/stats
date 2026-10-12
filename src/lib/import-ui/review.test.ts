import { describe, expect, it } from "vitest";
import type { FactDraft } from "@/lib/contracts";
import { CATALOG_METRICS } from "@/lib/contracts/catalog";
import {
  aliasTablesFromDictionary,
  buildReviewRows,
  emptyDimensionRows,
  existingValues,
  factDimensions,
  flaggedCount,
  groupSkipped,
  publishSummaryText,
  resolveFacts,
  resultMetricKeys,
  scopeKostnadsstalle,
  splitIssues,
  withResolvedValues,
  type DictionaryEntry,
} from "./review";

const fact = (dims: Record<string, string>, extra: Partial<FactDraft> = {}): FactDraft => ({
  metricKey: "timmar",
  company: "MBAB",
  month: "2026-09",
  dims,
  value: 8,
  sourceRows: [2],
  ...extra,
});

const DICT: Record<string, DictionaryEntry> = {
  kund: {
    byNorm: { "acme ab": 1, postnord: 2, "postnord ab": 2 },
    policy: "ask",
    personal: false,
    labels: { 1: "Acme AB", 2: "PostNord AB", 3: "Gammal AB" },
  },
  konsult: {
    byNorm: { "1001": 10 },
    policy: "auto_create",
    personal: true,
    labels: { 10: "1001" },
  },
  kostnadsstalle: {
    byNorm: { "mbab:100": 20, "100 stockholm": 20 },
    policy: "auto_create",
    personal: false,
    labels: { 20: "100 Stockholm" },
  },
};

describe("dimension resolution", () => {
  it("lists the dimensions used", () => {
    expect(
      factDimensions([fact({ kund: "Acme AB", konsult: "1001" }), fact({ ort: "Märsta" })]),
    ).toEqual(["konsult", "kund", "ort"]);
  });

  it("scopes kostnadsställe codes per company", () => {
    expect(
      scopeKostnadsstalle([
        fact({ kostnadsstalle: "100" }),
        fact({ kostnadsstalle: "MBR:200" }, { company: "MBR" }),
      ]).map((f) => f.dims.kostnadsstalle),
    ).toEqual(["MBAB:100", "MBR:200"]);
  });

  it("resolves known labels and separates values to ask about from values to create", () => {
    const r = resolveFacts(
      [
        fact({ kund: "Acme AB", konsult: "1001", kostnadsstalle: "100" }),
        fact({ kund: "Nya Kunden", konsult: "2002" }),
      ],
      DICT,
      { kund: "Kund", konsult: "Konsult" },
    );
    expect(r.rows).toBeNull();
    expect(r.onlyAutoCreate).toBe(false);
    expect(r.unknown).toEqual([
      { dimension: "konsult", label: "Konsult", personal: true, ask: [], create: ["2002"] },
      { dimension: "kund", label: "Kund", personal: false, ask: ["Nya Kunden"], create: [] },
    ]);
    const ok = resolveFacts([fact({ kund: "postnord", kostnadsstalle: "100" })], DICT);
    expect(ok.rows?.[0]?.dims).toEqual({ kund: 2, kostnadsstalle: 20 });
  });

  it("adds new or aliased values to the dictionary", () => {
    const next = withResolvedValues(DICT, "kund", { "Nya Kunden": 7 });
    expect(next.kund?.byNorm["nya kunden"]).toBe(7);
    expect(next.kund?.labels[7]).toBe("Nya Kunden");
    expect(DICT.kund?.byNorm["nya kunden"]).toBeUndefined();
    const aliased = withResolvedValues(DICT, "kund", { Acme: 1 });
    expect(aliased.kund?.labels[1]).toBe("Acme AB");
    expect(resolveFacts([fact({ kund: "ACME" })], aliased).rows?.[0]?.dims).toEqual({ kund: 1 });
    expect(withResolvedValues({}, "ort", { Märsta: 3 }).ort).toMatchObject({
      policy: "ask",
      byNorm: { märsta: 3 },
    });
  });

  it("offers active values for 'Samma som…'", () => {
    expect(existingValues(DICT.kund)).toEqual([
      { id: 1, label: "Acme AB" },
      { id: 2, label: "PostNord AB" },
    ]);
    expect(existingValues(undefined)).toEqual([]);
  });

  it("builds lookup tables from the dictionary", () => {
    expect(aliasTablesFromDictionary({ kund: DICT.kund! })).toEqual({
      kund: { "acme ab": "Acme AB", postnord: "PostNord AB", "postnord ab": "PostNord AB" },
    });
  });

  it("counts empty dimension cells per dimension", () => {
    expect(
      emptyDimensionRows([
        fact({ kund: "(saknas)" }, { sourceRows: [2, 3] }),
        fact({ kund: "(saknas)", ort: "(saknas)" }, { sourceRows: [3, 4] }),
        fact({ kund: "Acme AB" }, { sourceRows: [5] }),
      ]),
    ).toEqual([
      { dimension: "kund", rows: 3 },
      { dimension: "ort", rows: 2 },
    ]);
  });
});

describe("buildReviewRows", () => {
  const metrics = CATALOG_METRICS.map((m) => ({
    key: m.key,
    name: m.name,
    unit: m.unit,
    decimals: m.decimals,
    higherIsBetter: m.higherIsBetter,
  }));
  const row = (metricKey: string, extra: Record<string, unknown> = {}) => ({
    metricKey,
    company: "MBAB" as const,
    month: "2026-09",
    staged: 100,
    current: null,
    previous: 80,
    changePct: null,
    deviationPct: 25,
    flagged: true,
    replacesCurrent: true,
    ...extra,
  });

  it("orders by catalog metric, company, month and labels the rows", () => {
    const rows = buildReviewRows(
      [
        row("pass", { month: "2026-08" }),
        row("timmar", { company: "MBR" }),
        row("timmar", { current: 90, changePct: 11.1 }),
        row("pass", { deviationPct: null, previous: null, flagged: false }),
      ],
      metrics,
    );
    expect(rows.map((r) => [r.metricKey, r.company, r.month])).toEqual([
      ["timmar", "MBAB", "2026-09"],
      ["timmar", "MBR", "2026-09"],
      ["pass", "MBAB", "2026-08"],
      ["pass", "MBAB", "2026-09"],
    ]);
    expect(rows[0]).toMatchObject({
      metricName: "Fakturerade timmar",
      unit: "h",
      companyLabel: "MB AB",
      monthLabel: "sep 2026",
      replacing: true,
      direction: "up",
    });
    expect(rows[1]?.replacing).toBe(false);
    expect(rows[3]?.direction).toBeNull();
    expect(flaggedCount(rows)).toBe(3);
  });

  it("does not call low-priority slices replacing", () => {
    const [r] = buildReviewRows([row("intakter", { current: 5, replacesCurrent: false })], metrics);
    expect(r?.replacing).toBe(false);
  });
});

describe("parse report helpers", () => {
  it("groups skipped rows by reason with examples", () => {
    const groups = groupSkipped(
      [
        { sourceRow: 5, reason: "filtered", detail: "Steg 1: status är Makulerad" },
        { sourceRow: 9, reason: "sum_row" },
        { sourceRow: 7, reason: "filtered" },
        { sourceRow: 8, reason: "filtered" },
        { sourceRow: 10, reason: "filtered" },
      ],
      2,
    );
    expect(groups.map((g) => [g.label, g.count, g.examples.map((e) => e.sourceRow)])).toEqual([
      ["Bortfiltrerade rader", 4, [5, 7]],
      ["Summarader", 1, [9]],
    ]);
  });

  it("splits mapping problems from unreadable cells", () => {
    const issues = [
      {
        sourceRow: 0,
        column: "x",
        value: "",
        message: "Kolumnen saknar mått",
        severity: "error" as const,
      },
      {
        sourceRow: 4,
        column: "timmar",
        value: "abc",
        message: "Inte ett tal",
        severity: "error" as const,
      },
    ];
    expect(splitIssues(issues)).toEqual({ general: [issues[0]], cells: [issues[1]] });
  });

  it("lists the metrics of a result", () => {
    expect(
      resultMetricKeys({
        facts: [fact({}), fact({}, { metricKey: "pass" }), fact({})],
        totals: [{ metricKey: "timmar", company: "MBAB", month: "2026-09", value: 1 }],
      }),
    ).toEqual(["timmar", "pass"]);
  });
});

describe("publishSummaryText", () => {
  it("summarizes like the spec", () => {
    expect(
      publishSummaryText({
        metricCount: 3,
        months: ["2026-09"],
        companies: ["MBAB"],
        replacedPublishedAt: "2026-10-02T09:00:00Z",
        now: new Date("2026-10-12T10:00:00Z"),
      }),
    ).toBe("Publicerat: 3 mått, sep 2026, MB AB. Ersatte version från 2 okt.");
  });

  it("handles several months and companies and older replaced versions", () => {
    expect(
      publishSummaryText({
        metricCount: 1,
        months: ["2026-03", "2026-01", "2026-02"],
        companies: ["MBAB", "MBR"],
        replacedPublishedAt: "2025-12-30T09:00:00Z",
        now: new Date("2026-10-12T10:00:00Z"),
      }),
    ).toBe(
      "Publicerat: 1 mått, jan–mar 2026, MB AB och MB Restart. Ersatte version från 30 dec 2025.",
    );
    expect(publishSummaryText({ metricCount: 2, months: ["2026-09"], companies: ["MBR"] })).toBe(
      "Publicerat: 2 mått, sep 2026, MB Restart.",
    );
  });
});
