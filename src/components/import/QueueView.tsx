"use client";

import { ArrowRight } from "lucide-react";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import type { UploadChoices } from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { queueCounts, type QueueItem } from "@/lib/import-ui/queue";
import { DropZone } from "./DropZone";
import { QueueCard } from "./QueueCard";

function countsText(c: ReturnType<typeof queueCounts>): string {
  const parts = [`${formatNumber(c.total)} ${c.total === 1 ? "fil" : "filer"}`];
  if (c.busy) parts.push(`${formatNumber(c.busy)} läses`);
  if (c.needsAction) parts.push(`${formatNumber(c.needsAction)} behöver dig`);
  if (c.ready) parts.push(`${formatNumber(c.ready)} klara att granska`);
  if (c.published) parts.push(`${formatNumber(c.published)} publicerade`);
  return parts.join(" · ");
}

const STEPS = [
  { title: "Släpp filerna", text: "Alla månadens exporter på en gång." },
  {
    title: "Vi känner igen dem",
    text: "Kända rapporter läses direkt. En ny rapport mappar du en gång.",
  },
  { title: "Granska och publicera", text: "Jämför med förra månaden och godkänn." },
];

export function QueueView({
  items,
  now,
  onFiles,
  onChoices,
  onRemove,
  onMap,
  onDrift,
  onReview,
  onEditTemplate,
}: {
  items: QueueItem[];
  now: Date;
  onFiles: (files: File[]) => void;
  onChoices: (id: string, choices: UploadChoices) => void;
  onRemove: (id: string) => void;
  onMap: (id: string) => void;
  onDrift: (id: string) => void;
  onReview: (ids: string[]) => void;
  onEditTemplate: (id: string) => void;
}) {
  const counts = queueCounts(items);
  const readyIds = items.filter((i) => i.status === "ready").map((i) => i.id);
  return (
    <div className="flex flex-col gap-8">
      <DropZone onFiles={onFiles} compact={items.length > 0} />
      {items.length === 0 ? (
        <ol className="grid gap-4 md:grid-cols-3" aria-label="Så går det till">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-card bg-card p-5 shadow-soft">
              <span
                aria-hidden="true"
                className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-antracit text-sm text-white"
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium tracking-[0.06em] uppercase">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Heading id="queue-heading" level={2}>
                Filer
              </Heading>
              <p
                className="num text-sm text-muted-foreground"
                aria-live="polite"
                data-testid="queue-counts"
              >
                {countsText(counts)}
              </p>
            </div>
            {readyIds.length > 0 ? (
              <Button
                size="lg"
                className="px-4"
                onClick={() => onReview(readyIds)}
                data-testid="review-all-button"
              >
                Granska alla ({formatNumber(readyIds.length)})
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-3" data-testid="queue-list">
            {items.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                now={now}
                actions={{
                  onChoices: (c) => onChoices(item.id, c),
                  onMap: () => onMap(item.id),
                  onDrift: () => onDrift(item.id),
                  onReview: () => onReview([item.id]),
                  onEditTemplate: () => onEditTemplate(item.id),
                  onRemove: () => onRemove(item.id),
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
