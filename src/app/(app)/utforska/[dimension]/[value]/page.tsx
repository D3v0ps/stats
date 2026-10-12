import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EntityPanel } from "@/components/explore/EntityPanel";
import { ExploreError, ExploreSkeleton } from "@/components/explore/ExploreParts";
import { loadWorkspace } from "@/components/explore/workspace";
import { FilterBarSkeleton, GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { parseUrlFilters, withUrlFilters, type UrlFilters } from "@/lib/app/filters";
import { parseExploreState, withExploreState } from "@/lib/dashboard/explore-state";
import {
  entityExists,
  loadEntity,
  parseEntityParams,
  type EntityInput,
  type EntityView,
} from "@/lib/dashboard/load-entity";
import { effectiveAnchor } from "@/lib/dashboard/period";
import { requireSession } from "@/lib/db/session";

export const metadata: Metadata = { title: "Utforska" };

type Params = Promise<{ dimension: string; value: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireSession();
  const { dimension: rawDimension, value } = await params;
  const sp = await searchParams;
  const entity = parseEntityParams(rawDimension, value);
  if (!entity) notFound();
  const { dimension, valueId } = entity;
  // Checked before any Suspense boundary: notFound() while streaming keeps the 200 status, so
  // an unknown dimension or value must be ruled out here to answer with a real 404.
  let known = true;
  try {
    known = await entityExists(entity, await loadWorkspace());
  } catch {
    // The database is unreachable: EntityContent shows the error instead of a 404.
  }
  if (!known) notFound();
  const filters = parseUrlFilters(sp);
  const state = parseExploreState(sp);
  const input: EntityInput = { dimension, valueId, breakdown: state.groupBy, sort: state.sort };
  const viewKey = `${dimension}/${valueId}?${withExploreState(state, withUrlFilters(filters))}`;
  return (
    <Suspense key={viewKey} fallback={<ExploreSkeleton />}>
      <EntityContent input={input} filters={filters} />
    </Suspense>
  );
}

async function EntityContent({ input, filters }: { input: EntityInput; filters: UrlFilters }) {
  let view: EntityView;
  try {
    const ws = await loadWorkspace();
    view = await loadEntity(input, {
      source: ws.source,
      definitions: ws.definitions,
      dimensions: ws.dimensions,
      filters,
      anchor: effectiveAnchor(filters, ws.defaultAnchor.month),
    });
  } catch {
    return <ExploreError />;
  }
  if (!view.found) notFound();

  return (
    <EntityPanel
      view={view}
      sort={input.sort}
      filterBar={
        <Suspense fallback={<FilterBarSkeleton />}>
          <GlobalFilterBar filters={filters} />
        </Suspense>
      }
    />
  );
}
