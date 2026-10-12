import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeckMessage } from "@/components/present/DeckMessage";
import { SpeakerNotes } from "@/components/present/SpeakerNotes";
import { loadFrozenReport } from "@/components/reports/server-data";
import { requireSession } from "@/lib/db/session";
import { notesOutline } from "@/lib/present/slide-view";
import { frozenDeckKey } from "@/lib/present/sync";

export const metadata: Metadata = { title: "Talarmanus" };

/** Speaker notes of a frozen report, from the stored snapshot. */
export default async function FrozenNotesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const loaded = await loadFrozenReport(id);
  if (loaded.kind === "not_found") notFound();
  if (loaded.kind === "error") {
    return (
      <DeckMessage
        title="Talarmanuset kunde inte visas"
        description={loaded.error}
        backHref="/rapporter"
        backLabel="Till rapporterna"
      />
    );
  }
  const frozen = loaded.value;
  return (
    <SpeakerNotes
      outline={notesOutline(frozen.report)}
      deckKey={frozenDeckKey(frozen.id)}
      deckHref={`/presentera/arkiv/${frozen.id}`}
    />
  );
}
