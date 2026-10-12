"use client";

import { Presentation, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { saveTemplateAction } from "@/app/(app)/rapporter/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SlideSpec } from "@/lib/contracts/slides";
import type { FilterValue } from "@/lib/db/repo/present-extra";
import type { ReportDimension } from "@/lib/present/context";
import { previewHeadline, validateReportSpec } from "@/lib/present/editor-options";
import type { MonthOption } from "@/lib/present/freeze";
import { monthTitle } from "@/lib/present/labels";
import {
  createSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  moveSlideBy,
  neighbourAfterRemoval,
  newSlideId,
  patchSlide,
  removeSlide,
  specFingerprint,
} from "@/lib/present/spec-edit";
import { DeleteTemplateButton } from "./DeleteTemplateButton";
import { FormMessage } from "./FormMessage";
import { FreezeDialog } from "./FreezeDialog";
import { SlideForm, type EditorMetric } from "./SlideForm";
import { SlideList } from "./SlideList";
import { SlidePreview } from "./SlidePreview";
import { useSlidePreview } from "./use-slide-preview";

export interface TemplateEditorProps {
  templateId: string;
  initialName: string;
  initialSlides: SlideSpec[];
  metrics: EditorMetric[];
  dimensions: ReportDimension[];
  filterValues: Record<string, FilterValue[]>;
  /** Month the preview resolves (latest complete month). */
  anchor: string;
  freeze: { defaultTitle: string; months: MonthOption[]; defaultMonth: string };
}

type Status = { kind: "error" | "success"; text: string } | null;

/**
 * Report template editor: ordered slides (drag to reorder), the selected slide's settings and
 * a live preview rendered with the deck's own Slide component.
 */
export function TemplateEditor({
  templateId,
  initialName,
  initialSlides,
  metrics,
  dimensions,
  filterValues,
  anchor,
  freeze,
}: TemplateEditorProps) {
  const router = useRouter();
  const ids = useId();
  const [name, setName] = useState(initialName);
  const [slides, setSlides] = useState(initialSlides);
  const [selectedId, setSelectedId] = useState<string | null>(initialSlides[0]?.id ?? null);
  const [saved, setSaved] = useState(() => specFingerprint(initialName, initialSlides));
  const [status, setStatus] = useState<Status>(null);
  const [saving, startSaving] = useTransition();

  const dirty = specFingerprint(name, slides) !== saved;
  const selectedIndex = slides.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? (slides[selectedIndex] ?? null) : null;
  const preview = useSlidePreview(selected, anchor);
  const suggested = preview.resolved?.suggestedHeadline ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (next: SlideSpec[]) => {
    setSlides(next);
    setStatus(null);
  };

  const add = () => {
    const slide = createSlide(newSlideId(slides));
    edit(insertSlide(slides, slide, selectedId));
    setSelectedId(slide.id);
  };
  const duplicate = (id: string) => {
    const copyId = newSlideId(slides);
    edit(duplicateSlide(slides, id, copyId));
    setSelectedId(copyId);
  };
  const remove = (id: string) => {
    if (id === selectedId) setSelectedId(neighbourAfterRemoval(slides, id));
    edit(removeSlide(slides, id));
  };

  const save = (then?: () => void) => {
    const valid = validateReportSpec({ name, slides }, dimensions);
    if (!valid.ok) {
      setStatus({ kind: "error", text: valid.error });
      return;
    }
    startSaving(async () => {
      const result = await saveTemplateAction(templateId, valid.spec);
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error });
        return;
      }
      setSaved(specFingerprint(name, slides));
      setStatus({ kind: "success", text: "Sparat." });
      then?.();
    });
  };

  const presentHref = `/presentera/${templateId}`;

  return (
    <div className="flex flex-col gap-8" data-testid="template-editor">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid w-full max-w-xl gap-1.5">
          <Label htmlFor={`${ids}-name`}>Namn på rapporten</Label>
          <Input
            id={`${ids}-name`}
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setStatus(null);
            }}
            className="h-10 text-base"
            data-testid="editor-name"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="lg"
            className="gap-2"
            onClick={() => save()}
            disabled={saving || !dirty}
            data-testid="editor-save"
          >
            <Save aria-hidden="true" />
            {saving ? "Sparar …" : dirty ? "Spara" : "Sparat"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="gap-2"
              onClick={() => save(() => router.push(presentHref))}
              disabled={saving}
              data-testid="editor-present"
            >
              <Presentation aria-hidden="true" />
              Spara och presentera
            </Button>
          ) : (
            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link href={presentHref} data-testid="editor-present">
                <Presentation aria-hidden="true" />
                Presentera
              </Link>
            </Button>
          )}
          <FreezeDialog
            templateId={templateId}
            defaultTitle={freeze.defaultTitle}
            months={freeze.months}
            defaultMonth={freeze.defaultMonth}
            blockedReason={
              dirty
                ? "Spara ändringarna först: rapporten fryses som den är sparad."
                : slides.length === 0
                  ? "Rapporten har inga bilder att frysa."
                  : null
            }
          />
          <DeleteTemplateButton templateId={templateId} name={initialName} />
        </div>
      </div>
      {status ? <FormMessage kind={status.kind}>{status.text}</FormMessage> : null}

      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)_26rem]">
        <div className="lg:row-span-2 2xl:row-span-1">
          <SlideList
            slides={slides}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={add}
            onDuplicate={duplicate}
            onRemove={remove}
            onReorder={(activeId, overId) => edit(moveSlide(slides, activeId, overId))}
            onMoveBy={(id, delta) => edit(moveSlideBy(slides, id, delta))}
          />
        </div>
        {selected ? (
          <>
            <div className="min-w-0">
              <SlidePreview
                resolved={preview.resolved}
                error={preview.error}
                pending={preview.pending}
                headline={
                  preview.resolved
                    ? previewHeadline(selected, preview.resolved.suggestedHeadline)
                    : null
                }
                index={selectedIndex}
                count={slides.length}
                periodNote={`Siffror för ${monthTitle(anchor).toLocaleLowerCase("sv-SE")}`}
              />
            </div>
            <div className="min-w-0 rounded-card bg-card p-5 shadow-soft md:p-6">
              <h2 className="mb-5 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                Bild {selectedIndex + 1}
              </h2>
              <SlideForm
                key={selected.id}
                slide={selected}
                metrics={metrics}
                dimensions={dimensions}
                filterValues={filterValues}
                suggestedHeadline={suggested}
                onChange={(next) => edit(patchSlide(slides, next.id, next))}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Lägg till en bild för att börja bygga rapporten.
          </p>
        )}
      </div>
    </div>
  );
}
