"use client";

// The /ladda-upp page: the queue with its drop zone, and the mapping, drift and
// review views for a file. Files live in browser memory only, so the views are
// client state rather than routes.
import { useEffect, useMemo, useState } from "react";
import type { StoredTemplate } from "@/lib/db/repo/templates";
import { hasUnfinishedWork } from "@/lib/import-ui/queue";
import { DriftView } from "./DriftView";
import { Panel } from "./fields";
import { QueueView } from "./QueueView";
import type { UploadCatalog } from "./types";
import { useImportQueue } from "./use-import-queue";
import { ViewHeader } from "./ViewHeader";
import { MappingView, type MappingBase } from "./mapping/MappingView";
import { ReviewView } from "./review/ReviewView";

type View =
  | { kind: "queue" }
  | { kind: "map"; id: string; base: MappingBase }
  | { kind: "drift"; id: string }
  | { kind: "review"; ids: string[] }
  /** Right after saving a template: the file is read again, then its review opens by itself. */
  | { kind: "after_save"; id: string };

export function UploadApp({
  catalog: initialCatalog,
  templates,
}: {
  catalog: UploadCatalog;
  templates: StoredTemplate[];
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const queue = useImportQueue(templates, initialCatalog.accountGroups);
  const [view, setView] = useState<View>({ kind: "queue" });
  const [now] = useState(() => new Date());
  const toQueue = () => setView({ kind: "queue" });

  const unfinished = hasUnfinishedWork(queue.items);
  useEffect(() => {
    if (!unfinished) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unfinished]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.kind]);

  // A file dropped beside the drop zone must not make the browser open it (and
  // leave the page with the files read so far). In the file list it is added.
  const { addFiles } = queue;
  const onQueue = view.kind === "queue";
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files") || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (onQueue && files.length > 0) addFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles, onQueue]);

  const byId = useMemo(() => new Map(queue.items.map((i) => [i.id, i])), [queue.items]);

  if (view.kind === "map") {
    const item = byId.get(view.id);
    if (item) {
      return (
        <MappingView
          key={`${item.id}:${view.base.kind}`}
          item={item}
          catalog={catalog}
          base={view.base}
          client={queue.client}
          getDictionaries={queue.getDictionaries}
          onMetricCreated={(m) => setCatalog((c) => ({ ...c, metrics: [...c.metrics, m] }))}
          onSaved={(template, headerRow) => {
            queue.templateSaved(item.id, template, headerRow);
            setView({ kind: "after_save", id: item.id });
          }}
          onCancel={toQueue}
        />
      );
    }
  }

  if (view.kind === "drift") {
    const item = byId.get(view.id);
    const template = item?.template
      ? queue.templates.find((t) => t.id === item.template!.id)
      : undefined;
    if (item && template && item.drift) {
      const diff = item.drift;
      return (
        <DriftView
          item={item}
          template={template}
          diff={diff}
          onUpdate={() =>
            setView({ kind: "map", id: item.id, base: { kind: "update", template, diff } })
          }
          onCancel={toQueue}
        />
      );
    }
  }

  if (view.kind === "after_save") {
    const item = byId.get(view.id);
    if (item?.status === "running") {
      return (
        <div className="flex flex-col gap-8">
          <ViewHeader title="Mallen är sparad" onBack={toQueue} />
          <Panel aria-busy="true" role="status">
            Läser {item.fileName} med den nya mallen…
          </Panel>
        </div>
      );
    }
  }

  const reviewIds =
    view.kind === "review" ? view.ids : view.kind === "after_save" ? [view.id] : null;
  if (reviewIds) {
    const items = reviewIds.flatMap((id) => {
      const item = byId.get(id);
      return item && (item.status === "ready" || item.status === "published") ? [item] : [];
    });
    if (items.length > 0) {
      return (
        <ReviewView
          items={items}
          catalog={catalog}
          templates={queue.templates}
          getDictionaries={queue.getDictionaries}
          rememberValues={queue.rememberValues}
          onChoices={queue.setChoices}
          onPublished={queue.markPublished}
          onBack={toQueue}
          now={now}
        />
      );
    }
  }

  return (
    <QueueView
      items={queue.items}
      now={now}
      onFiles={queue.addFiles}
      onChoices={queue.setChoices}
      onRemove={queue.remove}
      onMap={(id) => setView({ kind: "map", id, base: { kind: "new" } })}
      onDrift={(id) => setView({ kind: "drift", id })}
      onReview={(ids) => setView({ kind: "review", ids })}
      onEditTemplate={(id) => {
        const item = byId.get(id);
        const template = item?.template
          ? queue.templates.find((t) => t.id === item.template!.id)
          : undefined;
        if (template) setView({ kind: "map", id, base: { kind: "update", template, diff: null } });
      }}
    />
  );
}
