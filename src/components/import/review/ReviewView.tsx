"use client";

// "Granska": one review per file (one, or all files at once), with publish per
// file or "Godkänn och publicera alla".
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { UploadChoices } from "@/lib/contracts";
import type { StoredTemplate } from "@/lib/db/repo/templates";
import type { QueueItem } from "@/lib/import-ui/queue";
import type { DictionaryEntry } from "@/lib/import-ui/review";
import type { UploadCatalog } from "../types";
import { ViewHeader } from "../ViewHeader";
import { ReviewPanel, type Publisher } from "./ReviewPanel";

export function ReviewView({
  items,
  catalog,
  templates,
  getDictionaries,
  rememberValues,
  onPublished,
  onBack,
  now,
}: {
  items: QueueItem[];
  catalog: UploadCatalog;
  templates: StoredTemplate[];
  getDictionaries: (keys: readonly string[]) => Promise<Record<string, DictionaryEntry>>;
  rememberValues: (dimension: string, entry: DictionaryEntry) => void;
  onChoices: (id: string, choices: UploadChoices) => void;
  onPublished: (id: string, summary: string, publishedAt: string) => void;
  onBack: () => void;
  now: Date;
}) {
  const publishers = useRef(new Map<string, Publisher>());
  const [readyIds, setReadyIds] = useState<string[]>([]);
  const [publishingAll, setPublishingAll] = useState(false);
  const [allMessage, setAllMessage] = useState<string | null>(null);

  const register = useCallback((id: string, publish: Publisher | null) => {
    if (publish) publishers.current.set(id, publish);
    else publishers.current.delete(id);
    const ids = [...publishers.current.keys()];
    setReadyIds((prev) =>
      prev.length === ids.length && prev.every((x, i) => x === ids[i]) ? prev : ids,
    );
  }, []);

  const publishAll = async () => {
    setPublishingAll(true);
    setAllMessage(null);
    let ok = 0;
    let failed = 0;
    for (const id of items.map((i) => i.id)) {
      const publish = publishers.current.get(id);
      if (!publish) continue;
      if (await publish()) ok++;
      else failed++;
    }
    setPublishingAll(false);
    setAllMessage(
      failed === 0
        ? `${ok} ${ok === 1 ? "fil publicerad" : "filer publicerade"}.`
        : `${ok} publicerade, ${failed} gick inte att publicera. Se meddelandet vid filen.`,
    );
  };

  const several = items.length > 1;
  return (
    <div className="flex flex-col gap-8" data-testid="review-view">
      <ViewHeader
        title={several ? "Granska alla" : "Granska"}
        onBack={onBack}
        description="Kontrollera siffrorna innan de publiceras. Avvikelser mot föregående månad är markerade med en flagga. Ingenting syns i översikten förrän du godkänner."
        actions={
          several ? (
            <Button
              size="lg"
              className="px-5"
              disabled={readyIds.length === 0 || publishingAll}
              onClick={() => void publishAll()}
              data-testid="publish-all-button"
            >
              {publishingAll ? "Publicerar…" : `Godkänn och publicera alla (${readyIds.length})`}
            </Button>
          ) : null
        }
      />
      {allMessage ? (
        <p role="status" className="text-sm font-medium">
          {allMessage}
        </p>
      ) : null}
      <div className="flex flex-col gap-6">
        {items.map((item) => (
          <ReviewPanel
            key={item.id}
            item={item}
            catalog={catalog}
            getDictionaries={getDictionaries}
            rememberValues={rememberValues}
            onPublished={onPublished}
            register={register}
            templateConfig={templates.find((t) => t.id === item.template?.id)?.config}
            onDiscarded={several ? undefined : onBack}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}
