import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeckMessage } from "@/components/present/DeckMessage";
import { SpeakerNotes } from "@/components/present/SpeakerNotes";
import { loadTemplateReport } from "@/components/reports/server-data";
import { requireSession } from "@/lib/db/session";
import { notesOutline } from "@/lib/present/slide-view";
import { templateDeckKey } from "@/lib/present/sync";

export const metadata: Metadata = { title: "Talarmanus" };

interface Props {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Speaker notes for a live presentation (only on the presenter's screen). */
export default async function TemplateNotesPage({ params, searchParams }: Props) {
  await requireSession();
  const [{ templateId }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadTemplateReport(templateId, query.manad);
  if (loaded.kind === "not_found") notFound();
  if (loaded.kind === "error") {
    return (
      <DeckMessage
        title="Talarmanuset kunde inte visas"
        description={loaded.error}
        backHref={`/rapporter/${templateId}`}
        backLabel="Till rapporten"
      />
    );
  }
  const { report, anchor } = loaded.value;
  return (
    <SpeakerNotes
      outline={notesOutline(report)}
      deckKey={templateDeckKey(templateId, anchor)}
      deckHref={`/presentera/${templateId}?manad=${anchor}`}
    />
  );
}
