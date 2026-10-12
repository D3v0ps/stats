import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ChartCard } from "@/components/widgets/ChartCard";
import { csvFileName } from "@/lib/dashboard/csv";
import type { SortState } from "@/lib/dashboard/explore-state";
import type { EntityView } from "@/lib/dashboard/load-entity";
import { entityPageName } from "@/lib/dashboard/metrics-meta";
import { BreakdownPicker } from "./BreakdownPicker";
import { ExploreChart } from "./ExploreChart";
import { ExportCsvButton } from "./ExportCsvButton";
import { MetricKpiGrid } from "./MetricKpiGrid";
import { PivotTable } from "./PivotTable";

export interface EntityPanelProps {
  view: EntityView;
  sort: SortState | null;
  /** The global filter bar (rendered by the page, streamed separately). */
  filterBar: ReactNode;
}

/**
 * Entity page body (kundkort etc.): header, every metric for the value, a 12-month trend,
 * a breakdown by the next dimension and comparisons.
 */
export function EntityPanel({ view, sort, filterBar }: EntityPanelProps) {
  const pageName = entityPageName(view.dimension);
  const subtitle = `${view.windowLabel.charAt(0).toLocaleUpperCase("sv-SE")}${view.windowLabel.slice(1)} · ${view.companyLabel}`;
  const withData = view.kpis.filter((k) => k.status !== "not_applicable");

  return (
    <div className="flex flex-col gap-6 md:gap-8" data-testid="entity-page">
      <div>
        <Link
          href={view.exploreHref}
          data-testid="entity-back"
          className="mb-4 inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Utforska
        </Link>
        <PageHeader
          className="mb-0 md:mb-0"
          title={view.label}
          description={
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium text-foreground">{view.dimensionLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{pageName.charAt(0).toLocaleUpperCase("sv-SE") + pageName.slice(1)}</span>
              {view.personal ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Personuppgift – visas bara här i arbetsytan</span>
                </>
              ) : null}
            </span>
          }
        />
      </div>

      {filterBar}

      {withData.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Inga mått kan delas upp per {view.dimensionLabel.toLocaleLowerCase("sv-SE")}.
        </p>
      ) : (
        <MetricKpiGrid
          testId="entity-kpis"
          items={withData.map((k) => ({
            key: k.key,
            title: k.name,
            value: k.value,
            unit: k.unit,
            decimals: k.decimals,
            delta: k.delta,
            sparkline: k.sparkline,
            footnote: k.footnote,
            href: k.href,
            lastUpdatedAt: k.lastUpdatedAt,
          }))}
        />
      )}

      {view.trend ? (
        <ChartCard
          title={view.trend.title}
          subtitle={`Senaste 12 månaderna · ${view.companyLabel}`}
          sourceQuery={view.sourceQuery}
          testId="entity-trend"
        >
          <ExploreChart chart={view.trend.chart} title={view.trend.title} monthMode />
        </ChartCard>
      ) : null}

      {view.breakdown ? (
        <ChartCard
          title={`Per ${view.breakdown.label.toLocaleLowerCase("sv-SE")}`}
          subtitle={subtitle}
          sourceQuery={view.sourceQuery}
          footnote={view.footnotes.join(" · ") || null}
          testId="entity-breakdown"
          actions={
            view.breakdown.csv ? (
              <ExportCsvButton
                csv={view.breakdown.csv}
                fileName={csvFileName([view.label, view.breakdown.label, view.windowLabel])}
              />
            ) : null
          }
        >
          <div className="flex flex-col gap-5">
            <BreakdownPicker
              label="Dela upp per"
              active={view.breakdown.dimension}
              options={view.breakdown.options.map((o) => ({
                key: o.key,
                label: o.label,
                enabled: true,
                reason: null,
                personal: o.personal,
                href: o.href,
              }))}
            />
            {view.breakdown.pivot && view.breakdown.sortedRows.length > 0 ? (
              <PivotTable
                model={view.breakdown.pivot}
                rows={view.breakdown.sortedRows}
                rowLinks={view.breakdown.rowLinks}
                sortLinks={view.breakdown.sortLinks}
                sort={sort}
                caption={`${view.label} per ${view.breakdown.label.toLocaleLowerCase("sv-SE")}`}
                entityLabel={`Öppna ${entityPageName(view.breakdown.dimension)}`}
                testId="entity-pivot"
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ingen data att dela upp för perioden.
              </p>
            )}
          </div>
        </ChartCard>
      ) : null}

      {view.comparison && view.comparison.rows.length > 0 ? (
        <ChartCard title="Jämförelser" subtitle={view.companyLabel} testId="entity-comparison">
          <PivotTable
            model={view.comparison}
            rows={view.comparison.rows}
            rowLinks={{}}
            sortLinks={{}}
            sort={null}
            caption={`Jämförelser för ${view.label}`}
            testId="entity-compare"
          />
        </ChartCard>
      ) : null}
    </div>
  );
}
