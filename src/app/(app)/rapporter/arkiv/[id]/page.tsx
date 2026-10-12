import { Lock, Presentation, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenNotesButton } from "@/components/present/OpenNotesButton";
import { SlideFrame } from "@/components/present/SlideFrame";
import { FormMessage } from "@/components/reports/FormMessage";
import { loadFrozenReport } from "@/components/reports/server-data";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/db/session";
import { frozenMeta, lockedBanner } from "@/lib/present/labels";
import { deckReport } from "@/lib/present/slide-view";

export const metadata: Metadata = { title: "Arkiv" };

/** A frozen report: rendered from its snapshot only, never recomputed. */
export default async function FrozenReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const result = await loadFrozenReport(id);
  if (result.kind === "not_found") notFound();
  if (result.kind === "error") {
    return (
      <>
        <PageHeader title="Fryst rapport" />
        <FormMessage>{result.error}</FormMessage>
      </>
    );
  }

  const frozen = result.value;
  const report = deckReport(frozen.report);
  const count = report.slides.length;

  return (
    <>
      <PageHeader
        title={frozen.title}
        description={frozenMeta(frozen.frozenAt, frozen.anchorMonth)}
        actions={
          <>
            <Button asChild size="lg" className="gap-2">
              <Link href={`/presentera/arkiv/${frozen.id}`} data-testid="present-link">
                <Presentation aria-hidden="true" />
                Presentera
              </Link>
            </Button>
            <OpenNotesButton href={`/presentera/arkiv/${frozen.id}/manus`} variant="outline" />
            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link href={`/presentera/arkiv/${frozen.id}/utskrift`} data-testid="print-link">
                <Printer aria-hidden="true" />
                Utskrift
              </Link>
            </Button>
          </>
        }
      />
      <p
        data-testid="archive-lock"
        className="mb-8 flex items-start gap-3 rounded-card bg-bla-100 px-5 py-4 text-sm text-antracit md:mb-10"
      >
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {lockedBanner(frozen.frozenAt)}
      </p>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Rapporten har inga bilder.</p>
      ) : (
        <ol className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Bilder">
          {report.slides.map((slide, i) => (
            <li key={slide.id} className="flex flex-col gap-2">
              <div className="relative">
                <SlideFrame slide={slide} index={i} count={count} />
                <Link
                  href={`/presentera/arkiv/${frozen.id}?bild=${i + 1}`}
                  aria-label={`Presentera från bild ${i + 1}: ${slide.headline}`}
                  className="absolute inset-0 rounded-card focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {i + 1}. {slide.metricName}
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
