// Texts shown on dashboard widgets (titles, subtitles, KPI footnotes), kept pure for tests.
import { DELTA_GLYPH } from "@/components/brand/delta-text";
import type { ResolvedSlide } from "@/lib/contracts/slides";
import { formatValue } from "@/lib/core/format-sv";
import type { LoadedWidget } from "@/lib/dashboard/load-dashboard";

export function widgetTitle(widget: Pick<LoadedWidget, "spec" | "metric">): string {
  return widget.spec.title ?? widget.metric?.name ?? widget.spec.metricKey;
}

/** "september 2026 · Summa bolag" (line charts: "senaste 12 mån"). */
export function widgetSubtitle(widget: Pick<LoadedWidget, "spec" | "slide">): string | null {
  const slide = widget.slide;
  if (!slide) return null;
  const monthly =
    widget.spec.viz === "line" ||
    widget.spec.viz === "stacked_company" ||
    (widget.spec.viz === "bar" && !widget.spec.groupBy);
  const period = monthly ? "Senaste 12 månaderna" : slide.periodLabel;
  const capital = period.charAt(0).toLocaleUpperCase("sv-SE") + period.slice(1);
  return `${capital} · ${slide.companyLabel}`;
}

/** The KPI sparkline: the 12-month series behind the card, when it has any value. */
export function kpiSparkline(slide: Pick<ResolvedSlide, "chart">): (number | null)[] | null {
  const values = slide.chart?.series[0]?.values ?? null;
  return values && values.some((v) => v !== null) ? values : null;
}

/**
 * KPI footnote. With a budget the card's delta is the budget comparison, so the change
 * against the previous period moves here (glyph and sign, never colour alone).
 */
export function kpiFootnote(
  widget: Pick<LoadedWidget, "slide" | "budgetDelta" | "budgetValue" | "budgetNote" | "metric">,
): string | null {
  const parts: string[] = [];
  const slide = widget.slide;
  if (widget.budgetDelta && widget.metric && widget.budgetValue !== null) {
    parts.push(
      `Budget ${formatValue(widget.budgetValue, widget.metric.unit, { compact: widget.metric.unit === "kr" })}`,
    );
    if (widget.budgetNote) parts.push(widget.budgetNote);
    const prev = slide?.delta;
    if (prev) parts.push(`${DELTA_GLYPH[prev.direction]} ${prev.formatted} ${prev.againstLabel}`);
  }
  if (slide?.footnote) parts.push(slide.footnote);
  if (parts.length === 0 && slide?.number?.value === null) parts.push("Ingen publicerad data");
  return parts.length > 0 ? parts.join(" · ") : null;
}
