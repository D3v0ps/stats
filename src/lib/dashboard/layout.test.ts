import { describe, expect, it } from "vitest";
import { WidgetSpecSchema } from "@/lib/contracts/dashboard";
import { DEFAULT_DASHBOARD } from "./default-dashboard";
import {
  bentoSpan,
  kpiMediumSpan,
  kpiSpansBothOnTwoColumns,
  kpiWideSpan,
  layoutBlocks,
} from "./layout";

const w = (id: string, viz: "kpi" | "line", x: number, y: number, width: number, h = 1) =>
  WidgetSpecSchema.parse({ id, viz, metricKey: "timmar", layout: { x, y, w: width, h } });

describe("dashboard layout", () => {
  it("splits the default dashboard into KPI rows and bento rows", () => {
    const blocks = layoutBlocks(DEFAULT_DASHBOARD.widgets);
    expect(blocks.map((b) => [b.kind, b.widgets.map((x) => x.id)])).toEqual([
      ["kpi", ["resultat", "intakter"]],
      ["kpi", ["aktiva-deltagare", "timmar", "konsulter"]],
      ["kpi", ["resultatandel", "faktor", "sjukfranvaro", "nya-deltagare"]],
      ["bento", ["resultat-per-manad", "resultat-per-bolag"]],
      ["bento", ["deltagare-per-verksamhet", "timmar-per-kund"]],
      ["bento", ["intakter-mot-budget"]],
    ]);
  });

  it("joins widgets whose rows overlap and mixes kinds into a bento block", () => {
    const blocks = layoutBlocks([
      w("tall", "kpi", 0, 0, 4, 2),
      w("b", "kpi", 4, 1, 4),
      w("c", "line", 8, 0, 4, 2),
      w("d", "kpi", 0, 2, 3),
    ]);
    expect(blocks.map((b) => [b.kind, b.widgets.map((x) => x.id)])).toEqual([
      ["bento", ["tall", "c", "b"]],
      ["kpi", ["d"]],
    ]);
  });

  it("chooses readable spans", () => {
    expect([3, 4, 6, 12].map(kpiMediumSpan)).toEqual([6, 4, 6, 12]);
    expect([1, 3, 4, 13].map(kpiWideSpan)).toEqual([3, 3, 4, 12]);
    expect([2, 4, 8, 12].map(bentoSpan)).toEqual([4, 4, 8, 12]);
    expect(kpiSpansBothOnTwoColumns(0, 3)).toBe(true);
    expect(kpiSpansBothOnTwoColumns(0, 4)).toBe(false);
    expect(kpiSpansBothOnTwoColumns(1, 3)).toBe(false);
  });
});
