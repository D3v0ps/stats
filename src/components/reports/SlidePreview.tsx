"use client";

import { useId } from "react";
import { SlideFrame } from "@/components/present/SlideFrame";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResolvedSlide } from "@/lib/contracts/slides";
import { FormMessage } from "./FormMessage";

export interface SlidePreviewProps {
  resolved: ResolvedSlide | null;
  error: string | null;
  pending: boolean;
  /** The headline the deck will show (override applied locally). */
  headline: string | null;
  index: number;
  count: number;
  /** "Siffror för september 2026" */
  periodNote: string;
}

/** The selected slide exactly as the deck renders it, scaled down. */
export function SlidePreview({
  resolved,
  error,
  pending,
  headline,
  index,
  count,
  periodNote,
}: SlidePreviewProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-testid="slide-preview"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={headingId}
          className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
        >
          Förhandsvisning
        </h2>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Uppdaterar …" : periodNote}
        </p>
      </div>
      {resolved ? (
        <SlideFrame
          slide={headline ? { ...resolved, headline } : resolved}
          index={index}
          count={count}
          className={pending ? "opacity-80 transition-opacity" : "transition-opacity"}
        />
      ) : error ? (
        <div className="theme-present grid aspect-video w-full place-items-center rounded-card p-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <Skeleton className="aspect-video w-full rounded-card" />
      )}
      {resolved && error ? <FormMessage>{error}</FormMessage> : null}
    </section>
  );
}
