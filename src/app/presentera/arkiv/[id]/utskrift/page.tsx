import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckMessage } from "@/components/present/DeckMessage";
import { PrintButton } from "@/components/present/PrintButton";
import { Slide } from "@/components/present/Slide";
import { loadFrozenReport } from "@/components/reports/server-data";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/db/session";
import { lockedShortLabel } from "@/lib/present/labels";
import { deckReport } from "@/lib/present/slide-view";

export const metadata: Metadata = { title: "Utskrift" };

// Pages are 16:9 (13.333 × 7.5 in, the widescreen slide size), one slide per page. The
// screen view uses the same fixed size so print layout equals what is on screen.
const PRINT_CSS = `
@page { size: 13.333in 7.5in; margin: 0; }
@media print {
  html, body { background: #ffffff !important; }
  [data-print-toolbar] { display: none !important; }
  [data-print-root] { gap: 0 !important; }
  [data-print-page] { box-shadow: none !important; border-radius: 0 !important; }
}
[data-print-page] {
  break-after: page;
  break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  --background: #ffffff;
}
[data-print-page]:last-child {
  break-after: auto;
}
`;

/** Print/PDF view of a frozen report (phase 2 prepares share links on top of this). */
export default async function FrozenPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const loaded = await loadFrozenReport(id);
  if (loaded.kind === "not_found") notFound();
  if (loaded.kind === "error") {
    return (
      <DeckMessage
        title="Rapporten kunde inte visas"
        description={loaded.error}
        backHref="/rapporter"
        backLabel="Till rapporterna"
      />
    );
  }
  const frozen = loaded.value;
  const report = deckReport(frozen.report);
  const count = report.slides.length;

  return (
    <div
      data-static=""
      className="flex min-h-dvh flex-col gap-8 bg-ljusgra-100 px-4 py-8 print:block print:bg-white print:p-0"
    >
      <style>{PRINT_CSS}</style>
      <div
        data-print-toolbar=""
        className="mx-auto flex w-full max-w-[13.333in] flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-medium tracking-[0.08em] uppercase">{frozen.title}</h1>
          <p className="text-xs text-muted-foreground">{lockedShortLabel(frozen.frozenAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="lg">
            <Link href={`/rapporter/arkiv/${frozen.id}`}>Tillbaka</Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <div className="w-full overflow-x-auto print:overflow-visible">
        <div data-print-root="" className="mx-auto flex w-max flex-col gap-8">
          {report.slides.map((slide, i) => (
            <div
              key={slide.id}
              data-print-page=""
              data-testid="print-page"
              className="overflow-hidden rounded-card bg-white shadow-soft"
              style={{ width: "13.333in", height: "7.5in" }}
            >
              <Slide slide={slide} index={i} count={count} showFootnote />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
