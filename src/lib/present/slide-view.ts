// How a ResolvedSlide is shown: which single visual it gets, what the deck and the notes
// window receive, and the chart scale that keeps axis labels readable on a projector.
import type { ResolvedReport, ResolvedSlide } from "@/lib/contracts/slides";

/** The one visual element of a slide. */
export type SlideVisual = "line" | "columns" | "bars" | "stacked" | "donut" | "table";

export function slideVisual(
  slide: Pick<ResolvedSlide, "viz" | "chart" | "table">,
): SlideVisual | null {
  switch (slide.viz) {
    case "kpi":
    case "line":
      return slide.chart && slide.chart.categories.length > 0 ? "line" : null;
    case "bar":
      if (!slide.chart || slide.chart.categories.length === 0) return null;
      // Monthly bars carry a highlighted (current) month; breakdowns read better horizontally.
      return slide.chart.highlightIndex !== null ? "columns" : "bars";
    case "toplist":
      return slide.chart && slide.chart.categories.length > 0 ? "bars" : null;
    case "stacked_company":
      return slide.chart && slide.chart.categories.length > 0 ? "stacked" : null;
    case "donut":
      return slide.chart && slide.chart.categories.length > 0 ? "donut" : null;
    case "table":
      return slide.table && slide.table.rows.length > 0 ? "table" : null;
  }
}

/** "number" puts the big number first (KPI slides); "chart" gives the chart the room. */
export function slideEmphasis(slide: Pick<ResolvedSlide, "viz">): "number" | "chart" {
  return slide.viz === "kpi" ? "number" : "chart";
}

/** "SEPTEMBER 2026 · SUMMA BOLAG" (shown in small caps above the headline). */
export function slideKicker(slide: Pick<ResolvedSlide, "periodLabel" | "companyLabel">): string {
  return [slide.periodLabel, slide.companyLabel].filter((s) => s.trim() !== "").join(" · ");
}

/**
 * Font scale for the headline: short messages get the full projector size, long overrides
 * (up to 80 characters) shrink so the number and the chart keep their room.
 */
export function headlineScale(headline: string): number {
  const n = headline.trim().length;
  if (n <= 28) return 1;
  if (n <= 40) return 0.88;
  if (n <= 56) return 0.76;
  return 0.64;
}

/** Font scale for the big number so long amounts ("−12,3 mkr") stay on one line. */
export function numberScale(formatted: string): number {
  const n = [...formatted.trim()].length;
  if (n <= 5) return 1;
  if (n <= 7) return 0.86;
  if (n <= 9) return 0.72;
  return 0.6;
}

/** Font scale for table slides so every row fits on the slide. */
export function tableScale(rows: number): number {
  if (rows <= 6) return 1;
  if (rows <= 10) return 0.8;
  if (rows <= 15) return 0.62;
  return 0.5;
}

/** The deck never receives speaker notes: they exist only in the notes window. */
export function deckReport(report: ResolvedReport): ResolvedReport {
  return { ...report, slides: report.slides.map((s) => ({ ...s, notes: "" })) };
}

export interface NotesSlide {
  id: string;
  headline: string;
  metricName: string;
  notes: string;
  footnote: string | null;
}

export interface NotesOutline {
  title: string;
  periodLabel: string;
  slides: NotesSlide[];
}

/** What the speaker notes window needs (no chart data). */
export function notesOutline(report: ResolvedReport): NotesOutline {
  return {
    title: report.title,
    periodLabel: report.periodLabel,
    slides: report.slides.map((s) => ({
      id: s.id,
      headline: s.headline,
      metricName: s.metricName,
      notes: s.notes,
      footnote: s.footnote,
    })),
  };
}

/** Screen reader announcement when the slide changes. */
export function slideAnnouncement(index: number, count: number, headline: string): string {
  return `Bild ${index + 1} av ${count}: ${headline}`;
}

export interface ChartScaleOptions {
  /** Logical chart width the brand charts are designed for (12 px axis labels). */
  baseWidth?: number;
  /** Smallest scale: 1 on screens (never smaller text), 0 for thumbnails (true miniature). */
  min?: number;
  max?: number;
}

/**
 * The CSS scale for a chart box `width` px wide: the chart is laid out at width / scale and
 * scaled up, so axis labels grow with the projector instead of staying at 12 px.
 */
export function chartScale(width: number, opts: ChartScaleOptions = {}): number {
  const { baseWidth = 560, min = 1, max = 2.4 } = opts;
  if (!Number.isFinite(width) || width <= 0) return 1;
  const raw = width / baseWidth;
  const scale = Math.min(Math.max(raw, min), max);
  return scale > 0 ? scale : 1;
}

/** Elapsed presentation time: "0:07", "12:05", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
