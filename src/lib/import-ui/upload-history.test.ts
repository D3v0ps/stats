import { describe, expect, it } from "vitest";
import {
  RetractInputSchema,
  canRetract,
  historyRows,
  historyStatus,
  isListed,
  retractResultText,
  type HistorySource,
} from "./upload-history";

const upload = (extra: Partial<HistorySource>): HistorySource => ({
  id: "u1",
  datasetKey: "ip_timmar",
  fileName: "timmar.xlsx",
  templateId: "t1",
  templateVersion: 1,
  scenario: "utfall",
  status: "published",
  companies: ["MBAB"],
  months: ["2026-09"],
  currentMonths: ["2026-09"],
  publishedAt: "2026-10-02T08:00:00Z",
  retractedAt: null,
  retractReason: null,
  ...extra,
});

describe("historyStatus", () => {
  it("derives Publicerad, Delvis ersatt, Ersatt and Återkallad", () => {
    expect(historyStatus(upload({}))).toBe("published");
    expect(
      historyStatus(upload({ months: ["2026-08", "2026-09"], currentMonths: ["2026-08"] })),
    ).toBe("partly_replaced");
    expect(historyStatus(upload({ currentMonths: [] }))).toBe("replaced");
    expect(historyStatus(upload({ status: "retracted", currentMonths: [] }))).toBe("retracted");
    expect(historyStatus(upload({ status: "staged" }))).toBe("staged");
  });

  it("lists published and retracted uploads and only retracts published ones", () => {
    expect(isListed(upload({ status: "discarded" }))).toBe(false);
    expect(isListed(upload({ status: "retracted" }))).toBe(true);
    expect(canRetract(upload({}))).toBe(true);
    expect(canRetract(upload({ status: "retracted" }))).toBe(false);
  });
});

describe("historyRows", () => {
  const datasets = [
    { key: "ip_timmar", name: "Intelliplan – timmar och pass" },
    { key: "budget", name: "Budget" },
    { key: "fx_bokforing", name: "Fortnox – bokföring (SIE4)" },
  ];
  const templates = [{ id: "t1", name: "Intelliplan timmar" }];

  it("builds view rows, newest publish first", () => {
    const rows = historyRows(
      [
        upload({}),
        upload({
          id: "u2",
          datasetKey: "fx_bokforing",
          templateId: null,
          templateVersion: null,
          fileName: "mbab.se",
          months: ["2026-01", "2026-09"],
          currentMonths: [],
          publishedAt: "2026-10-05T08:00:00Z",
        }),
        upload({ id: "u3", status: "discarded" }),
        upload({
          id: "u4",
          status: "retracted",
          templateVersion: 2,
          retractedAt: "2026-10-06T08:00:00Z",
          retractReason: "Fel månad",
          publishedAt: "2026-10-01T08:00:00Z",
        }),
      ],
      datasets,
      templates,
    );
    expect(
      rows.map((r) => [r.id, r.report, r.months, r.statusLabel, r.publishedAt, r.canRetract]),
    ).toEqual([
      ["u2", "Fortnox – bokföring (SIE4)", "jan–sep 2026", "Ersatt", "5 okt 2026", true],
      ["u1", "Intelliplan timmar", "sep 2026", "Publicerad", "2 okt 2026", true],
      ["u4", "Intelliplan timmar (version 2)", "sep 2026", "Återkallad", "1 okt 2026", false],
    ]);
    expect(rows[2]?.retracted).toBe("6 okt 2026: Fel månad");
    expect(rows[1]?.companies).toBe("MB AB");
  });

  it("marks budget uploads", () => {
    const [row] = historyRows(
      [upload({ templateId: null, scenario: "budget", datasetKey: "ip_timmar" })],
      datasets,
      templates,
    );
    expect(row?.report).toBe("Intelliplan – timmar och pass (budget)");
  });
});

describe("retract input and result", () => {
  it("requires a short reason", () => {
    const id = "6f1c2b8e-1d2a-4c3b-9e4f-0a1b2c3d4e5f";
    expect(
      RetractInputSchema.safeParse({ uploadId: id, reason: " ok " }).error?.issues[0]?.message,
    ).toBe("Skriv kort varför publiceringen ångras.");
    expect(RetractInputSchema.parse({ uploadId: id, reason: " Fel månad " })).toEqual({
      uploadId: id,
      reason: "Fel månad",
    });
    expect(RetractInputSchema.safeParse({ uploadId: "x", reason: "Fel månad" }).success).toBe(
      false,
    );
  });

  it("says what happened", () => {
    expect(retractResultText({ restored: 2, released: 2 })).toBe(
      "Publiceringen är ångrad. Föregående version är tillbaka för 2 månader.",
    );
    expect(retractResultText({ restored: 1, released: 1 })).toContain("1 månad.");
    expect(retractResultText({ restored: 0, released: 1 })).toContain("ingen tidigare version");
    expect(retractResultText({ restored: 0, released: 0 })).toBe("Publiceringen är ångrad.");
  });
});
