import { CloudOff, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/brand/EmptyState";
import { loadWorkspace } from "@/components/explore/workspace";
import { FilterBarSkeleton, GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { DashboardGrid, WidgetSkeleton } from "@/components/widgets/DashboardGrid";
import { parseUrlFilters, withUrlFilters, type UrlFilters } from "@/lib/app/filters";
import { formatDateSv } from "@/lib/core/format-sv";
import {
  chooseDashboard,
  DEFAULT_DASHBOARD,
  orderedWidgets,
} from "@/lib/dashboard/default-dashboard";
import { loadDashboardMeta } from "@/lib/dashboard/load-dashboard";
import { effectiveAnchor } from "@/lib/dashboard/period";
import { createSupabaseServerClient } from "@/lib/db/client-server";
import { getDefaultDashboard } from "@/lib/db/repo/dashboards";
import { requireSession } from "@/lib/db/session";
import { FOOTNOTE_COMPANY_SUM } from "@/lib/metrics";

export const metadata: Metadata = { title: "Översikt" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const filters = parseUrlFilters(await searchParams);
  return (
    <>
      <PageHeader
        title="Översikt"
        description="Nyckeltal för Miljonbemanning AB och Miljonbemanning Restart AB."
      />
      <div className="mb-8 md:mb-10">
        <Suspense fallback={<FilterBarSkeleton />}>
          <GlobalFilterBar filters={filters} />
        </Suspense>
      </div>
      {/* Keyed by the filters: a new period shows skeletons at once instead of stale cards. */}
      <Suspense key={withUrlFilters(filters).toString()} fallback={<OverviewSkeleton />}>
        <OverviewContent filters={filters} />
      </Suspense>
    </>
  );
}

async function OverviewContent({ filters }: { filters: UrlFilters }) {
  let loaded;
  try {
    const ws = await loadWorkspace();
    const db = await createSupabaseServerClient();
    // A broken saved dashboard must never take the start page down: fall back to the code default.
    const saved = await getDefaultDashboard(db).catch(() => null);
    const widgets = orderedWidgets(chooseDashboard(saved));
    const anchor = effectiveAnchor(filters, ws.defaultAnchor.month);
    const meta = await loadDashboardMeta({
      widgets,
      source: ws.source,
      definitions: ws.definitions,
      filters,
      anchor,
      now: new Date(),
    });
    loaded = { ws, widgets, anchor, meta };
  } catch {
    return (
      <EmptyState
        icon={<CloudOff />}
        title="Kunde inte läsa data"
        description="Databasen svarar inte just nu. Försök igen om en stund."
      />
    );
  }

  const { ws, widgets, anchor, meta } = loaded;
  if (!meta.hasData) {
    return (
      <div data-testid="dashboard-empty">
        <EmptyState
          icon={<Inbox />}
          title="Ingen data ännu"
          description="När den första filen är uppladdad och publicerad visas nyckeltalen här."
          action={
            <Button asChild>
              <Link href="/ladda-upp">Ladda upp en fil</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {meta.newest ? (
        <p className="-mt-4 text-xs text-muted-foreground md:-mt-6" data-testid="last-updated">
          Senast uppdaterad {formatDateSv(meta.newest)}
        </p>
      ) : null}
      <DashboardGrid
        widgets={widgets}
        ctx={{
          source: ws.source,
          definitions: ws.definitions,
          dimensions: ws.dimensions,
          filters,
          anchor,
        }}
        lastUpdated={meta.lastUpdated}
      />
      {filters.company === "ALL" ? (
        <p className="text-xs text-muted-foreground">
          {FOOTNOTE_COMPANY_SUM}: affärer mellan bolagen räknas i båda.
        </p>
      ) : null}
    </div>
  );
}

function OverviewSkeleton() {
  const kpis = DEFAULT_DASHBOARD.widgets.filter((w) => w.viz === "kpi").slice(0, 5);
  return (
    <div className="@container flex flex-col gap-4 md:gap-6" aria-busy="true">
      <span className="sr-only">Laddar nyckeltal</span>
      <div className="grid grid-cols-1 gap-4 md:gap-6 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {kpis.map((w) => (
          <WidgetSkeleton key={w.id} spec={w} title="nyckeltal" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 @4xl:grid-cols-12">
        <WidgetSkeleton spec={{ viz: "line" }} title="diagram" className="@4xl:col-span-8" />
        <WidgetSkeleton spec={{ viz: "bar" }} title="diagram" className="@4xl:col-span-4" />
      </div>
    </div>
  );
}
