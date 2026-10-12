import { Skeleton } from "@/components/ui/skeleton";
import type { UrlFilters } from "@/lib/app/filters";
import { loadFilterBarData, loadWorkspace } from "@/components/explore/workspace";
import { FilterBar } from "./FilterBar";

/**
 * Server wrapper: resolves the default month and hint, then renders the interactive bar.
 * Renders nothing when the data cannot be read (the page shows the error itself).
 */
export async function GlobalFilterBar({ filters }: { filters: UrlFilters }) {
  let ws: Awaited<ReturnType<typeof loadWorkspace>>;
  let bar: Awaited<ReturnType<typeof loadFilterBarData>>;
  try {
    ws = await loadWorkspace();
    bar = await loadFilterBarData(ws, filters);
  } catch {
    return null;
  }
  return (
    <FilterBar
      filters={filters}
      anchor={bar.anchor}
      defaultAnchor={ws.defaultAnchor.month}
      months={bar.months}
      hint={bar.hint}
    />
  );
}

export function FilterBarSkeleton() {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4" aria-busy="true">
      <span className="sr-only">Laddar filter</span>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-8 w-44" />
      </div>
    </div>
  );
}
