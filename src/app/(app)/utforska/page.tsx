import type { Metadata } from "next";
import { Suspense } from "react";
import { ExplorePanel } from "@/components/explore/ExplorePanel";
import { ExploreError, ExploreSkeleton } from "@/components/explore/ExploreParts";
import { loadWorkspace } from "@/components/explore/workspace";
import { FilterBarSkeleton, GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { PageHeader } from "@/components/shell/PageHeader";
import { parseUrlFilters, type UrlFilters } from "@/lib/app/filters";
import { parseExploreState, type ExploreState } from "@/lib/dashboard/explore-state";
import { loadExplore } from "@/lib/dashboard/load-explore";
import { groupMetricsByArea, selectableMetrics } from "@/lib/dashboard/metrics-meta";
import { effectiveAnchor } from "@/lib/dashboard/period";
import { availablePresets } from "@/lib/dashboard/presets";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Utforska" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const params = await searchParams;
  const filters = parseUrlFilters(params);
  const state = parseExploreState(params);
  return (
    <>
      <PageHeader
        title="Utforska"
        description="Bryt ner alla mått per bolag, verksamhet, kund, uppdrag och konsult – eller jämför flera mått sida vid sida."
      />
      <div className="mb-8 md:mb-10">
        <Suspense fallback={<FilterBarSkeleton />}>
          <GlobalFilterBar filters={filters} />
        </Suspense>
      </div>
      <Suspense fallback={<ExploreSkeleton />}>
        <ExploreContent filters={filters} state={state} />
      </Suspense>
    </>
  );
}

async function ExploreContent({ filters, state }: { filters: UrlFilters; state: ExploreState }) {
  let loaded;
  try {
    const ws = await loadWorkspace();
    const view = await loadExplore(state, {
      source: ws.source,
      definitions: ws.definitions,
      dimensions: ws.dimensions,
      filters,
      anchor: effectiveAnchor(filters, ws.defaultAnchor.month),
    });
    loaded = { ws, view };
  } catch {
    return <ExploreError />;
  }
  const { ws, view } = loaded;
  return (
    <ExplorePanel
      view={view}
      groups={groupMetricsByArea(ws.definitions)}
      presets={availablePresets(selectableMetrics(ws.definitions))}
    />
  );
}
