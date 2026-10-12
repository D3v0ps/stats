import { Suspense } from "react";
import { KpiCard } from "@/components/brand/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetSpec } from "@/lib/contracts/dashboard";
import { layoutBlocks } from "@/lib/dashboard/layout";
import { loadWidget, type DashboardContext } from "@/lib/dashboard/load-dashboard";
import { CARD, DASHBOARD_ROOT, blockClass, itemClass } from "./grid-classes";
import { WidgetRenderer } from "./WidgetRenderer";

export interface DashboardGridProps {
  widgets: WidgetSpec[];
  ctx: DashboardContext;
  lastUpdated: Record<string, string | null>;
}

/**
 * The dashboard: KPI rows, then the bento grid. Each widget resolves on the server in its own
 * Suspense boundary, so fast cards appear while slower charts are still computing.
 */
export function DashboardGrid({ widgets, ctx, lastUpdated }: DashboardGridProps) {
  const blocks = layoutBlocks(widgets);
  return (
    <div className={DASHBOARD_ROOT} data-testid="dashboard-grid">
      {blocks.map((block, bi) => (
        <div key={bi} className={blockClass(block)}>
          {block.widgets.map((spec, i) => {
            const className = itemClass(block, i);
            const title =
              spec.title ?? ctx.definitions.find((d) => d.key === spec.metricKey)?.name ?? "";
            return (
              <Suspense
                key={spec.id}
                fallback={<WidgetSkeleton spec={spec} title={title} className={className} />}
              >
                <WidgetSlot
                  spec={spec}
                  ctx={ctx}
                  lastUpdatedAt={lastUpdated[spec.metricKey] ?? null}
                  className={className}
                />
              </Suspense>
            );
          })}
        </div>
      ))}
    </div>
  );
}

async function WidgetSlot({
  spec,
  ctx,
  lastUpdatedAt,
  className,
}: {
  spec: WidgetSpec;
  ctx: DashboardContext;
  lastUpdatedAt: string | null;
  className: string;
}) {
  const widget = await loadWidget(spec, ctx);
  if (widget.status === "hidden") return null;
  return (
    <div className={className}>
      <WidgetRenderer widget={widget} lastUpdatedAt={lastUpdatedAt} />
    </div>
  );
}

export function WidgetSkeleton({
  spec,
  title,
  className,
}: {
  spec: Pick<WidgetSpec, "viz">;
  title: string;
  className?: string;
}) {
  if (spec.viz === "kpi") {
    return (
      <div className={className}>
        <KpiCard title={title} value={null} unit="st" loading className="h-full" />
      </div>
    );
  }
  return (
    <div className={className}>
      <div className={`${CARD} flex h-full flex-col gap-4`} aria-busy="true">
        <span className="sr-only">Laddar {title}</span>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
