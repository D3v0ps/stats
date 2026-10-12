import { ChartCard } from "@/components/widgets/ChartCard";
import { CARD } from "@/components/widgets/grid-classes";
import { csvFileName } from "@/lib/dashboard/csv";
import type { ExploreView } from "@/lib/dashboard/load-explore";
import { entityPageName, perGroupTitle, type MetricGroup } from "@/lib/dashboard/metrics-meta";
import { toPivotDelta } from "@/lib/dashboard/pivot";
import type { ExplorePreset } from "@/lib/dashboard/presets";
import { BreakdownPicker } from "./BreakdownPicker";
import { DrillBreadcrumb } from "./DrillBreadcrumb";
import { ExploreChart } from "./ExploreChart";
import { ExploreNotes } from "./ExploreParts";
import { ExportCsvButton } from "./ExportCsvButton";
import { MetricKpiGrid, type MetricKpi } from "./MetricKpiGrid";
import { MetricPicker } from "./MetricPicker";
import { PivotTable } from "./PivotTable";

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
}

/** Summary cards for the selected metrics under the current drill path. */
export function exploreKpis(view: ExploreView): MetricKpi[] {
  return view.results.flatMap((r, i) => {
    const def = view.metrics[i];
    if (!def || r.status === "not_applicable") return [];
    const cell = r.total.compare.prev_period ?? r.total.compare.prev_year;
    const { withData, expected } = r.total.coverage;
    return [
      {
        key: def.key,
        title: def.name,
        value: r.total.value,
        unit: def.unit,
        decimals: def.decimals,
        delta: cell ? toPivotDelta(cell, def.unit, def.higherIsBetter) : undefined,
        footnote:
          r.status === "ok" && withData < expected
            ? `${withData} av ${expected} mån har data`
            : null,
        lastUpdatedAt: r.lastUpdatedAt,
      },
    ];
  });
}

export interface ExplorePanelProps {
  view: ExploreView;
  groups: MetricGroup[];
  presets: ExplorePreset[];
}

/** Utforska: metric + breakdown pickers, breadcrumb, summary cards, chart and pivot table. */
export function ExplorePanel({ view, groups, presets }: ExplorePanelProps) {
  const subtitle = `${capitalize(view.windowLabel)} · ${view.companyLabel}`;
  const groupWord = view.groupLabel.toLocaleLowerCase("sv-SE");
  const tableCaption =
    view.metrics.length === 1
      ? perGroupTitle(view.metrics[0]?.name ?? "", view.groupLabel)
      : `Per ${groupWord}`;
  const hasRows = (view.pivot?.rows.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6 md:gap-8" data-testid="explore">
      <section aria-label="Mått och uppdelning" className={`${CARD} flex flex-col gap-5`}>
        <MetricPicker groups={groups} state={view.state} presets={presets} />
        <BreakdownPicker options={view.breakdownOptions} active={view.groupBy} />
      </section>

      <div className="flex flex-col gap-1.5">
        <DrillBreadcrumb crumbs={view.crumbs} />
        {view.nextBreakdownLabel && hasRows ? (
          <p className="text-xs text-muted-foreground">
            Klicka på en rad för att dela upp vidare per{" "}
            {view.nextBreakdownLabel.toLocaleLowerCase("sv-SE")}.
          </p>
        ) : null}
      </div>

      <ExploreNotes notes={view.notes} />

      <MetricKpiGrid items={exploreKpis(view)} testId="explore-kpis" />

      {view.chart ? (
        <ChartCard
          title={view.chartTitle}
          subtitle={subtitle}
          sourceQuery={view.sourceQuery}
          testId="explore-chart"
        >
          <ExploreChart
            chart={view.chart}
            title={view.chartTitle}
            monthMode={view.groupBy === "manad"}
          />
        </ChartCard>
      ) : null}

      {view.pivot ? (
        <ChartCard
          title="Tabell"
          subtitle={`${capitalize(tableCaption)} · ${subtitle}`}
          sourceQuery={view.sourceQuery}
          footnote={view.footnotes.join(" · ") || null}
          testId="explore-table"
          actions={
            view.csv ? (
              <ExportCsvButton
                csv={view.csv}
                fileName={csvFileName([
                  ...view.metrics.map((m) => m.name),
                  view.groupLabel,
                  view.state.filters.length > 0 ? "filtrerad" : "",
                  view.windowLabel,
                ])}
              />
            ) : null
          }
        >
          {hasRows ? (
            <PivotTable
              model={view.pivot}
              rows={view.sortedRows}
              rowLinks={view.rowLinks}
              sortLinks={view.sortLinks}
              sort={view.state.sort}
              caption={`${tableCaption}, ${view.windowLabel}, ${view.companyLabel}`}
              entityLabel={`Öppna ${entityPageName(view.groupBy)}`}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ingen data att dela upp för perioden.
            </p>
          )}
        </ChartCard>
      ) : null}
    </div>
  );
}
