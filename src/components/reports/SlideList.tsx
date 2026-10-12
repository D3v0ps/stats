"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VIZ_LABELS, type SlideSpec } from "@/lib/contracts/slides";
import { slideLabel } from "@/lib/present/editor-options";
import { cn } from "@/lib/utils";
import type { EditorMetric } from "./SlideForm";

export interface SlideListProps {
  slides: SlideSpec[];
  metrics: EditorMetric[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  /** Drag and drop: move `activeId` to the position of `overId`. */
  onReorder: (activeId: string, overId: string) => void;
  onMoveBy: (id: string, delta: -1 | 1) => void;
}

/** Ordered slides; drag the handle (mouse, touch or keyboard) to reorder. */
export function SlideList({
  slides,
  metrics,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onReorder,
  onMoveBy,
}: SlideListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const labelOf = (id: UniqueIdentifier) => {
    const index = slides.findIndex((s) => s.id === id);
    return index < 0 ? "Bilden" : `Bild ${index + 1}`;
  };
  const positionOf = (id: UniqueIdentifier) => slides.findIndex((s) => s.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} är upplockad.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} är över plats ${positionOf(over.id)} av ${slides.length}.`
        : `${labelOf(active.id)} är inte över någon plats.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(active.id)} släpptes på plats ${positionOf(over.id)} av ${slides.length}.`
        : `${labelOf(active.id)} släpptes.`,
    onDragCancel: ({ active }) => `Flytten avbröts. ${labelOf(active.id)} ligger kvar.`,
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Bilder
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="gap-1"
          data-testid="editor-add-slide"
        >
          <Plus aria-hidden="true" />
          Lägg till bild
        </Button>
      </div>
      {slides.length === 0 ? (
        <p className="rounded-xl border border-dashed border-antracit-100 px-4 py-6 text-center text-sm text-muted-foreground">
          Inga bilder ännu.
        </p>
      ) : (
        <DndContext
          id="report-slides"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "Tryck mellanslag eller Enter för att plocka upp bilden. Flytta med piltangenterna, släpp med mellanslag eller Enter och avbryt med Escape.",
            },
          }}
        >
          <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2">
              {slides.map((slide, index) => (
                <SortableSlide
                  key={slide.id}
                  slide={slide}
                  index={index}
                  count={slides.length}
                  label={slideLabel(
                    slide,
                    metrics.find((m) => m.key === slide.metricKey),
                  )}
                  selected={slide.id === selectedId}
                  onSelect={() => onSelect(slide.id)}
                  onDuplicate={() => onDuplicate(slide.id)}
                  onRemove={() => onRemove(slide.id)}
                  onMoveBy={(delta) => onMoveBy(slide.id, delta)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableSlide({
  slide,
  index,
  count,
  label,
  selected,
  onSelect,
  onDuplicate,
  onRemove,
  onMoveBy,
}: {
  slide: SlideSpec;
  index: number;
  count: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMoveBy: (delta: -1 | 1) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="slide-item"
      className={cn(
        "relative flex items-center gap-1 rounded-xl border border-border bg-card p-1.5",
        selected &&
          "border-antracit ring-1 ring-antracit before:absolute before:inset-y-2.5 before:-left-px before:w-[3px] before:rounded-full before:bg-rod",
        isDragging && "z-10 shadow-soft",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Flytta bild ${index + 1}`}
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="slide-select"
      >
        <span
          className={cn(
            "num w-5 shrink-0 text-center text-xs",
            selected ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {index + 1}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{VIZ_LABELS[slide.viz]}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Fler val för bild ${index + 1}`}
            data-testid="slide-menu"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDuplicate} data-testid="slide-duplicate">
            <Copy aria-hidden="true" />
            Duplicera
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMoveBy(-1)} disabled={index === 0}>
            <ArrowUp aria-hidden="true" />
            Flytta upp
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMoveBy(1)} disabled={index >= count - 1}>
            <ArrowDown aria-hidden="true" />
            Flytta ner
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove} data-testid="slide-delete">
            <Trash2 aria-hidden="true" />
            Ta bort
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
