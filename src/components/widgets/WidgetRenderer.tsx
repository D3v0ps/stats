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
}

/** ResolvedSlide -> KpiCard / Mb* chart / toplist / table, with drill-down links. */
export function WidgetRenderer({ widget }: WidgetRendererProps) {
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

  const lastUpdatedAt = slide.lastUpdatedAt ?? null;
  if (spec.viz === "kpi") {
    return (
      <KpiCard
        data-testid={testId}
        className="h-full [&_[data-slot=sparkline]]:w-20 @7xl:[&_[data-slot=sparkline]]:w-24"
        title={title}
        value={slide.number?.value ?? null}
        unit={metric.unit}
        formatOptions={kpiFormatOptions(metric.unit, metric.decimals)}
        delta={slide.delta}
        secondaryDelta={widget.budgetDelta}
        sparkline={kpiSparkline(slide)}
        sparklineLabel={`${metric.name}, senaste 12 månaderna`}
        lastUpdatedAt={lastUpdatedAt}
        footnote={kpiFootnote(widget)}
        href={widget.href}
        actionLabel={`${title}: utforska`}
        actions={<SourcePopover query={widget.sourceQuery} subject={title} />}
      />
    );
  }

  const chart = slide.chart;
  // Aligned with the chart's categories (built from ChartData.categoryIds).
  const categoryHrefs = widget.categoryLinks.some((l) => l.href)
    ? widget.categoryLinks.map((l) => l.href)
    : undefined;
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
          {chart ? (
            <MbDonut
              data={chart}
              title={title}
              centerLabel="Totalt"
              categoryHrefs={categoryHrefs}
            />
          ) : (
            empty
          )}
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
              categoryHrefs={categoryHrefs}
            />
          ) : (
            empty
          )}
        </ChartCard>
      );
    }
  }
}
