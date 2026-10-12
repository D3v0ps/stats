import { CloudOff, Info } from "lucide-react";
import { EmptyState } from "@/components/brand/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/components/widgets/grid-classes";
import type { ExploreView } from "@/lib/dashboard/load-explore";

/** Why a metric has no number here: "Kund finns inte i bokföringen." */
export function ExploreNotes({ notes }: { notes: ExploreView["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <div
      role="note"
      data-testid="explore-notes"
      className="flex gap-3 rounded-card border border-bla-200 bg-bla-100/60 px-5 py-4 text-sm text-antracit"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <ul className="flex flex-col gap-1">
          {notes.map((n) => (
            <li key={n.metricKey}>{n.text}</li>
          ))}
        </ul>
        {notes.some((n) => n.kind === "not_applicable") ? (
          <p className="text-xs text-antracit-300">
            Välj en annan uppdelning eller ett annat mått.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ExploreError() {
  return (
    <EmptyState
      icon={<CloudOff />}
      title="Kunde inte läsa data"
      description="Databasen svarar inte just nu. Försök igen om en stund."
    />
  );
}

export function ExploreSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:gap-8" aria-busy="true">
      <span className="sr-only">Laddar</span>
      <div className={`${CARD} flex flex-col gap-4`}>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-4 w-64" />
      <div className={`${CARD} flex flex-col gap-4`}>
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <div className={`${CARD} flex flex-col gap-3`}>
        <Skeleton className="h-5 w-56" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
