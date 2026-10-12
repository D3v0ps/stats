"use client";

import { ArrowRight, Minus, Plus, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SignatureDiff } from "@/lib/contracts";
import type { StoredTemplate } from "@/lib/db/repo/templates";
import { proposeRenames } from "@/lib/import-ui/drift";
import type { QueueItem } from "@/lib/import-ui/queue";
import { Panel } from "./fields";
import { ViewHeader } from "./ViewHeader";

/** What changed in the file compared with its template. Nothing is imported until the user decides. */
export function DriftView({
  item,
  template,
  diff,
  onUpdate,
  onCancel,
}: {
  item: QueueItem;
  template: StoredTemplate;
  diff: SignatureDiff;
  onUpdate: () => void;
  onCancel: () => void;
}) {
  const renames = proposeRenames(diff);
  const renamedFrom = new Set(renames.map((r) => r.from));
  const renamedTo = new Set(renames.map((r) => r.to));
  const added = diff.added.filter((c) => !renamedTo.has(c));
  const removed = diff.removed.filter((c) => !renamedFrom.has(c));

  return (
    <div className="flex flex-col gap-8" data-testid="drift-view">
      <ViewHeader
        title="Filen har ändrats"
        onBack={onCancel}
        description={
          <>
            <span className="font-medium text-foreground">{item.fileName}</span> liknar rapporten ”
            {template.name}”, men kolumnerna är inte desamma som när mallen sparades. Ingenting har
            lästs in.
          </>
        }
      />
      <Panel className="flex flex-col gap-5">
        <h3 className="text-sm font-medium tracking-[0.06em] uppercase">Det här har ändrats</h3>
        <ul className="flex flex-col divide-y divide-border" data-testid="drift-changes">
          {renames.map((r) => (
            <li key={`r-${r.from}`} className="flex flex-wrap items-center gap-3 py-3">
              <Shuffle aria-hidden="true" className="size-4 text-antracit-300" />
              <span className="text-sm text-muted-foreground">
                Omdöpt kolumn{r.certain ? "" : " (troligen)"}:
              </span>
              <span className="font-medium">{r.from}</span>
              <ArrowRight aria-label="till" className="size-4 text-antracit-300" />
              <span className="font-medium">{r.to}</span>
            </li>
          ))}
          {added.map((c) => (
            <li key={`a-${c}`} className="flex flex-wrap items-center gap-3 py-3">
              <Plus aria-hidden="true" className="size-4 text-antracit-300" />
              <span className="text-sm text-muted-foreground">Ny kolumn:</span>
              <span className="font-medium">{c || "(utan rubrik)"}</span>
            </li>
          ))}
          {removed.map((c) => (
            <li key={`m-${c}`} className="flex flex-wrap items-center gap-3 py-3">
              <Minus aria-hidden="true" className="size-4 text-rod" />
              <span className="text-sm text-muted-foreground">Saknad kolumn:</span>
              <span className="font-medium">{c || "(utan rubrik)"}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Uppdatera mallen så öppnas mappningen med de gamla inställningarna där kolumnerna finns
          kvar. Omdöpta kolumner får sina gamla namn, och du bestämmer vad som ska hända med de nya.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="px-4"
            onClick={onUpdate}
            data-testid="update-template-button"
          >
            Uppdatera mallen
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-4"
            onClick={onCancel}
            data-testid="drift-cancel-button"
          >
            Avbryt
          </Button>
        </div>
      </Panel>
    </div>
  );
}
