import { describe, expect, it } from "vitest";
import type { ChartData, ResolvedReport, ResolvedSlide } from "@/lib/contracts/slides";
import {
  chartScale,
  miniatureChartText,
  deckReport,
  formatElapsed,
  headlineScale,
  notesOutline,
  numberScale,
  slideAnnouncement,
  slideEmphasis,
  slideKicker,
  slideVisual,
  tableScale,
} from "./slide-view";

const chart = (highlightIndex: number | null, categories = ["a", "b"]): ChartData => ({
  categories,
  series: [{ key: "k", label: "K", role: "primary", values: categories.map(() => 1) }],
  unit: "st",
  highlightIndex,
});

const resolved = (input: Partial<ResolvedSlide>): ResolvedSlide => ({
  id: "s1",
  viz: "kpi",
  headline: "DELTAGARNA ÖKAR.",
  suggestedHeadline: "DELTAGARNA ÖKAR.",
  metricName: "Aktiva deltagare",
  periodLabel: "september 2026",
  companyLabel: "Summa bolag",
  number: { value: 12, formatted: "12 st", unit: "st" },
  delta: null,
  chart: chart(1),
  table: null,
  footnote: "2 av 3 mån har data",
  notes: "Hemligt manus",
  sourceUploadIds: [],
  ...input,
});

describe("slideVisual", () => {
  it("gives each visualisation its single chart", () => {
    expect(slideVisual(resolved({ viz: "kpi" }))).toBe("line");
    expect(slideVisual(resolved({ viz: "line" }))).toBe("line");
    expect(slideVisual(resolved({ viz: "bar", chart: chart(1) }))).toBe("columns");
    expect(slideVisual(resolved({ viz: "bar", chart: chart(null) }))).toBe("bars");
    expect(slideVisual(resolved({ viz: "toplist", chart: chart(null) }))).toBe("bars");
    expect(slideVisual(resolved({ viz: "stacked_company", chart: chart(null) }))).toBe("stacked");
    expect(slideVisual(resolved({ viz: "donut", chart: chart(null) }))).toBe("donut");
    expect(
      slideVisual(
        resolved({
          viz: "table",
          chart: null,
          table: { columns: ["A"], rows: [{ label: "x", values: [] }] },
        }),
      ),
    ).toBe("table");
  });

  it("shows no chart when there is nothing to draw", () => {
    expect(slideVisual(resolved({ chart: null }))).toBeNull();
    expect(slideVisual(resolved({ viz: "bar", chart: chart(null, []) }))).toBeNull();
    expect(slideVisual(resolved({ viz: "table", table: { columns: [], rows: [] } }))).toBeNull();
    expect(slideVisual(resolved({ viz: "table", table: null }))).toBeNull();
  });
});

describe("slide text", () => {
  it("puts the number first on KPI slides", () => {
    expect(slideEmphasis({ viz: "kpi" })).toBe("number");
    expect(slideEmphasis({ viz: "line" })).toBe("chart");
  });

  it("joins period and company", () => {
    expect(slideKicker(resolved({}))).toBe("september 2026 · Summa bolag");
    expect(slideKicker(resolved({ companyLabel: "" }))).toBe("september 2026");
  });

  it("announces slide changes", () => {
    expect(slideAnnouncement(2, 9, "TIMMARNA ÖKAR.")).toBe("Bild 3 av 9: TIMMARNA ÖKAR.");
  });
});

describe("type scales", () => {
  it("shrinks long headlines step by step", () => {
    expect(headlineScale("DELTAGARNA ÖKAR.")).toBe(1);
    expect(headlineScale("ANDELEN TILL ARBETE ELLER STUDIER ÖKAR.")).toBe(0.88);
    expect(headlineScale("X".repeat(50))).toBe(0.76);
    expect(headlineScale("X".repeat(80))).toBe(0.64);
    expect(headlineScale(`  ${"X".repeat(28)}  `)).toBe(1);
  });

  it("shrinks long numbers", () => {
    expect(numberScale("128 st")).toBe(0.86);
    expect(numberScale("48 %")).toBe(1);
    expect(numberScale("2,4 mkr")).toBe(0.86);
    expect(numberScale("−12,3 mkr")).toBe(0.72);
    expect(numberScale("12 345 678 h")).toBe(0.6);
  });

  it("shrinks tables with many rows", () => {
    expect(tableScale(3)).toBe(1);
    expect(tableScale(10)).toBe(0.8);
    expect(tableScale(12)).toBe(0.62);
    expect(tableScale(40)).toBe(0.5);
  });
});

describe("deckReport and notesOutline", () => {
  const report: ResolvedReport = {
    schemaVersion: 1,
    title: "Styrelserapport",
    anchorMonth: "2026-09",
    periodLabel: "september 2026",
    generatedAt: "2026-10-12T08:00:00Z",
    slides: [resolved({}), resolved({ id: "s2", notes: "Mer manus" })],
  };

  it("never hands speaker notes to the deck", () => {
    const deck = deckReport(report);
    expect(deck.slides.map((s) => s.notes)).toEqual(["", ""]);
    expect(JSON.stringify(deck)).not.toContain("manus");
    expect(deck.slides[0]?.chart).toEqual(report.slides[0]?.chart);
    // The input is untouched.
    expect(report.slides[0]?.notes).toBe("Hemligt manus");
  });

  it("gives the notes window headlines, notes and footnotes only", () => {
    expect(notesOutline(report)).toEqual({
      title: "Styrelserapport",
      periodLabel: "september 2026",
      slides: [
        {
          id: "s1",
          headline: "DELTAGARNA ÖKAR.",
          metricName: "Aktiva deltagare",
          notes: "Hemligt manus",
          footnote: "2 av 3 mån har data",
        },
        {
          id: "s2",
          headline: "DELTAGARNA ÖKAR.",
          metricName: "Aktiva deltagare",
          notes: "Mer manus",
          footnote: "2 av 3 mån har data",
        },
      ],
    });
  });
});

describe("miniatureChartText", () => {
  it("shrinks axis labels with the box, between 6 and 12 px", () => {
    expect(miniatureChartText(560)).toEqual({ fontSize: 12, yAxisWidth: 54 });
    expect(miniatureChartText(1200)).toEqual({ fontSize: 12, yAxisWidth: 54 });
    expect(miniatureChartText(230)).toEqual({ fontSize: 6, yAxisWidth: 27 });
    expect(miniatureChartText(368)).toEqual({ fontSize: 8, yAxisWidth: 36 });
    expect(miniatureChartText(0)).toEqual({ fontSize: 12, yAxisWidth: 54 });
    expect(miniatureChartText(Number.NaN).fontSize).toBe(12);
  });
});

describe("chartScale", () => {
  it("scales charts up with the screen but never below 1 on screens", () => {
    expect(chartScale(560)).toBe(1);
    expect(chartScale(280)).toBe(1);
    expect(chartScale(1120)).toBe(2);
    expect(chartScale(5000)).toBe(2.4);
  });

  it("shrinks for miniatures when allowed", () => {
    expect(chartScale(280, { min: 0 })).toBe(0.5);
    expect(chartScale(760, { baseWidth: 760 })).toBe(1);
    expect(chartScale(0)).toBe(1);
    expect(chartScale(Number.NaN, { min: 0 })).toBe(1);
  });
});

describe("formatElapsed", () => {
  it("formats minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(725_000)).toBe("12:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});
