import { KpiCard } from "@/components/brand/KpiCard";
import { SourcePopover } from "@/components/widgets/SourcePopover";
import type { Unit } from "@/lib/contracts/domain";
import type { FormatOptions } from "@/lib/core/format-sv";
import type { SourceQuery } from "@/lib/dashboard/load-dashboard";
import type { PivotDelta } from "@/lib/dashboard/pivot";
import { cn } from "@/lib/utils";

export interface MetricKpi {
  key: string;
  title: string;
  value: number | null;
  unit: Unit;
  decimals: number | null;
  /** undefined hides the delta row (no comparison asked for). */
  delta?: PivotDelta | null;
  sparkline?: (number | null)[] | null;
  footnote?: string | null;
  href?: string;
  lastUpdatedAt?: string | null;
  /** Adds the Källa button (uploads behind the number). */
  sourceQuery?: SourceQuery;
}

export function kpiFormatOptions(unit: Unit, decimals: number | null): FormatOptions {
  return unit === "kr" ? { compact: true } : { decimals: decimals ?? undefined };
}

/** KPI cards for several metrics under the same filters (Utforska summary, entity pages). */
export function MetricKpiGrid({
  items,
  testId,
  className,
}: {
  items: MetricKpi[];
  testId?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("@container", className)} data-testid={testId}>
      <div className="grid grid-cols-1 gap-4 md:gap-6 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4 [&_[data-slot=sparkline]]:w-20">
        {items.map((k) => (
          <KpiCard
            key={k.key}
            data-testid={testId ? `${testId}-${k.key}` : undefined}
            className="h-full"
            title={k.title}
            value={k.value}
            unit={k.unit}
            formatOptions={kpiFormatOptions(k.unit, k.decimals)}
            delta={k.delta}
            sparkline={k.sparkline}
            sparklineLabel={k.sparkline ? `${k.title}, senaste 12 månaderna` : undefined}
            footnote={k.footnote}
            lastUpdatedAt={k.lastUpdatedAt}
            href={k.href}
            actionLabel={k.href ? `${k.title}: utforska` : undefined}
            actions={
              k.sourceQuery ? <SourcePopover query={k.sourceQuery} subject={k.title} /> : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
