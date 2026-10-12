// Turns the 12-column widget layout of a DashboardSpec into blocks the renderer lays out
// responsively: widgets whose rows overlap form one block (a KPI row with a tall card, two
// charts side by side). KPI-only blocks get a KPI grid, the rest the bento grid.
import type { WidgetSpec } from "@/lib/contracts/dashboard";

export interface LayoutBlock {
  kind: "kpi" | "bento";
  widgets: WidgetSpec[];
}

export function layoutBlocks(widgets: readonly WidgetSpec[]): LayoutBlock[] {
  const sorted = [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const blocks: { widgets: WidgetSpec[]; bottom: number }[] = [];
  for (const w of sorted) {
    const current = blocks.at(-1);
    if (current && w.layout.y < current.bottom) {
      current.widgets.push(w);
      current.bottom = Math.max(current.bottom, w.layout.y + w.layout.h);
    } else {
      blocks.push({ widgets: [w], bottom: w.layout.y + w.layout.h });
    }
  }
  // A KPI row followed by another KPI row stays separate (two visual rows), but a block that
  // mixes KPI cards and charts is laid out as one bento grid.
  return blocks.map((b) => ({
    kind: b.widgets.every((w) => w.viz === "kpi") ? "kpi" : "bento",
    widgets: b.widgets,
  }));
}

/** Column span of a KPI card in the 12-column grid at medium width (min 4, i.e. 3 per row). */
export function kpiMediumSpan(w: number): 4 | 6 | 12 {
  if (w >= 12) return 12;
  if (w >= 6) return 6;
  if (w >= 4) return 4;
  // Narrow cards (4 per row on wide screens) pair up two per row at medium width.
  return 6;
}

/** Wide-screen span: the spec's own width, but never narrower than a quarter. */
export function kpiWideSpan(w: number): number {
  return Math.min(12, Math.max(3, w));
}

/** In a two-column layout an odd number of KPI cards lets the first one span both columns. */
export function kpiSpansBothOnTwoColumns(index: number, count: number): boolean {
  return index === 0 && count % 2 === 1;
}

/** Bento chart span at medium+ width; charts narrower than a third are widened. */
export function bentoSpan(w: number): number {
  return Math.min(12, Math.max(4, w));
}
