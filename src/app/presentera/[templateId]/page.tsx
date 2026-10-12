import { notFound } from "next/navigation";
import { Deck } from "@/components/present/Deck";
import { DeckMessage } from "@/components/present/DeckMessage";
import { loadTemplateReport } from "@/components/reports/server-data";
import { requireSession } from "@/lib/db/session";
import { parseSlideNumber } from "@/lib/present/deck-nav";
import { deckReport } from "@/lib/present/slide-view";
import { templateDeckKey } from "@/lib/present/sync";

interface Props {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Live presentation of a template, resolved on the server for ?manad (default: latest complete month). */
export default async function PresentTemplatePage({ params, searchParams }: Props) {
  await requireSession();
  const [{ templateId }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadTemplateReport(templateId, query.manad);
  if (loaded.kind === "not_found") notFound();
  const backHref = `/rapporter/${templateId}`;
  if (loaded.kind === "error") {
    return (
      <DeckMessage
        title="Rapporten kunde inte visas"
        description={loaded.error}
        backHref={backHref}
        backLabel="Till rapporten"
      />
    );
  }
  const { report, anchor } = loaded.value;
  if (report.slides.length === 0) {
    return (
      <DeckMessage
        title="Inga bilder ännu"
        description="Lägg till bilder i rapporten för att kunna presentera den."
        backHref={backHref}
        backLabel="Till rapporten"
      />
    );
  }
  return (
    <Deck
      report={deckReport(report)}
      deckKey={templateDeckKey(templateId, anchor)}
      initialIndex={parseSlideNumber(query.bild, report.slides.length) ?? 0}
      exitHref={backHref}
      notesHref={`/presentera/${templateId}/manus?manad=${anchor}`}
    />
  );
}
