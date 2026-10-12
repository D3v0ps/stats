import { notFound } from "next/navigation";
import { Deck } from "@/components/present/Deck";
import { DeckMessage } from "@/components/present/DeckMessage";
import { loadFrozenReport } from "@/components/reports/server-data";
import { requireSession } from "@/lib/db/session";
import { parseSlideNumber } from "@/lib/present/deck-nav";
import { lockedShortLabel } from "@/lib/present/labels";
import { deckReport } from "@/lib/present/slide-view";
import { frozenDeckKey } from "@/lib/present/sync";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Presentation of a frozen report: rendered from the stored snapshot only, never recomputed. */
export default async function PresentFrozenPage({ params, searchParams }: Props) {
  await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadFrozenReport(id);
  if (loaded.kind === "not_found") notFound();
  const backHref = `/rapporter/arkiv/${id}`;
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
  if (frozen.report.slides.length === 0) {
    return (
      <DeckMessage
        title="Inga bilder"
        description="Den här frysta rapporten har inga bilder."
        backHref={backHref}
        backLabel="Till arkivet"
      />
    );
  }
  return (
    <Deck
      report={deckReport(frozen.report)}
      deckKey={frozenDeckKey(frozen.id)}
      initialIndex={parseSlideNumber(query.bild, frozen.report.slides.length) ?? 0}
      exitHref={backHref}
      notesHref={`/presentera/arkiv/${frozen.id}/manus`}
      lockedLabel={lockedShortLabel(frozen.frozenAt)}
    />
  );
}
