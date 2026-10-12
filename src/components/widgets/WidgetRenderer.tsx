import Link from "next/link";
import { KpiCard } from "@/components/brand/KpiCard";
import { MbBarChart, MbDonut, MbLineChart, MbStackedCompanyBar } from "@/components/brand/charts";
import { kpiFormatOptions } from "@/components/explore/MetricKpiGrid";
import type { LoadedWidget } from "@/lib/dashboard/load-dashboard";
import { cn } from "@/lib/utils";
import { ChartCard } from "./ChartCard";
import { SourcePopover } from "./SourcePopover";
import { ToplistBars } from "./ToplistBars";
import { kpiFootnote, kpiSparkline, widgetSubtitle, widgetTitle } from "./widget-text";
import { toplistRows } from "./toplist-rows";

export interface WidgetRendererProps {
  widget: LoadedWidget;
  lastUpdatedAt: string | null;
}

/** ResolvedSlide -> KpiCard / Mb* chart / toplist / table, with drill-down links. */
export function WidgetRenderer({ widget, lastUpdatedAt }: WidgetRendererProps) {
  const { spec, slide, metric } = widget;
  const title = widgetTitle(widget);
  const testId = `widget-${spec.id}`;

  if (widget.status === "error" || !slide || !metric) {
    return (
      <ChartCard title={title} testId={testId}>
        <p className="text-sm text-muted-foreground">
          Kunde inte visa widgeten. {widget.error ?? ""}
        </p>
      </ChartCard>
    );
  }

  if (spec.viz === "kpi") {
    return (
      <div
        className="relative h-full [&_[data-slot=kpi-card]:not(:has(>footer))]:pb-14 [&_[data-slot=kpi-card]>footer]:pr-16 [&_[data-slot=sparkline]]:w-20 @7xl:[&_[data-slot=sparkline]]:w-24"
        data-testid={testId}
      >
        <KpiCard
          className="h-full"
          title={title}
          value={slide.number?.value ?? null}
          unit={metric.unit}
          formatOptions={kpiFormatOptions(metric.unit, metric.decimals)}
          delta={widget.budgetDelta ?? slide.delta}
          sparkline={kpiSparkline(slide)}
          sparklineLabel={`${metric.name}, senaste 12 månaderna`}
          lastUpdatedAt={lastUpdatedAt}
          footnote={kpiFootnote(widget)}
          href={widget.href}
          actionLabel={`${title}: utforska`}
        />
        <SourcePopover
          query={widget.sourceQuery}
          subject={title}
          className="absolute right-3 bottom-3 md:right-4 md:bottom-4"
        />
      </div>
    );
  }

  const chart = slide.chart;
  const subtitle = widgetSubtitle(widget);
  const common = {
    title,
    subtitle,
    href: widget.href,
    footnote: slide.footnote,
    lastUpdatedAt,
    sourceQuery: widget.sourceQuery,
    testId,
  };
  const empty = (
    <p className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
      Ingen data för perioden
    </p>
  );

  switch (spec.viz) {
    case "line":
      return (
        <ChartCard {...common}>
          {chart ? <MbLineChart data={chart} title={title} height={260} /> : empty}
        </ChartCard>
      );
    case "stacked_company":
      return (
        <ChartCard {...common}>
          {chart ? <MbStackedCompanyBar data={chart} title={title} height={260} /> : empty}
        </ChartCard>
      );
    case "donut":
      return (
        <ChartCard {...common}>
          {chart ? <MbDonut data={chart} title={title} centerLabel="Totalt" /> : empty}
          <CategoryLinks widget={widget} />
        </ChartCard>
      );
    case "toplist": {
      const rows = toplistRows(slide, widget.categoryLinks, widget.metric?.higherIsBetter ?? null);
      return (
        <ChartCard {...common}>
          {rows.length > 0 ? (
            <ToplistBars rows={rows} label={title} testId={`${testId}-list`} />
          ) : (
            empty
          )}
        </ChartCard>
      );
    }
    case "table":
      return (
        <ChartCard {...common}>
          {slide.table ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    {slide.table.columns.map((c, i) => (
                      <th
                        key={c}
                        scope="col"
                        className={cn("py-2 font-medium", i > 0 && "text-right")}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slide.table.rows.map((r, i) => {
                    const href = widget.categoryLinks[i]?.href ?? null;
                    return (
                      <tr key={`${r.label}-${i}`} className="border-b last:border-0">
                        <th scope="row" className="py-2 text-left font-normal">
                          {href ? (
                            <Link href={href} className="hover:underline hover:underline-offset-4">
                              {r.label}
                            </Link>
                          ) : (
                            r.label
                          )}
                        </th>
                        {r.values.map((v, j) => (
                          <td key={j} className="num py-2 text-right tabular-nums">
                            {v}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            empty
          )}
        </ChartCard>
      );
    case "bar":
    default: {
      const horizontal = Boolean(spec.groupBy) && (chart?.categories.length ?? 0) > 6;
      return (
        <ChartCard {...common}>
          {chart ? (
            <MbBarChart
              data={chart}
              title={title}
              orientation={horizontal ? "horizontal" : "vertical"}
              height={horizontal ? undefined : 260}
            />
          ) : (
            empty
          )}
          <CategoryLinks widget={widget} />
        </ChartCard>
      );
    }
  }
}

/** Drill-down links under a breakdown chart (chart bars themselves are not focusable). */
function CategoryLinks({ widget }: { widget: LoadedWidget }) {
  const links = widget.categoryLinks.filter((l) => l.href);
  if (links.length === 0) return null;
  return (
    <nav aria-label={`Öppna ${widgetTitle(widget)}`} className="mt-3 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <Link
          key={l.label}
          href={l.href as string}
          data-testid={`widget-${widget.spec.id}-link`}
          className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-antracit-200 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
