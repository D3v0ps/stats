"use client";

import { ChevronLeft, ChevronRight, Lock, Maximize, Minimize, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ResolvedReport } from "@/lib/contracts/slides";
import { tapAction } from "@/lib/present/deck-nav";
import { slideAnnouncement } from "@/lib/present/slide-view";
import { cn } from "@/lib/utils";
import { OpenNotesButton } from "./OpenNotesButton";
import { Slide } from "./Slide";
import { useDeckNavigation } from "./use-deck-navigation";
import { useFullscreen } from "./use-fullscreen";

/** Controls fade out after this long without pointer movement in fullscreen. */
const IDLE_MS = 2500;
/** More slides than this: the counter alone (the dots would wrap into a second row). */
const MAX_DOTS = 24;

export interface DeckProps {
  /** Resolved report without speaker notes (see deckReport). */
  report: ResolvedReport;
  deckKey: string;
  initialIndex: number;
  exitHref: string;
  notesHref: string;
  /** Frozen decks: "Låst version från 12 okt 2026". */
  lockedLabel?: string | null;
}

/**
 * The presentation: one slide at a time on the antracit canvas. Arrow keys, Space, PageUp/
 * PageDown (presenter clickers), Home/End, taps on the left/right half and the progress
 * dots move; F toggles fullscreen. The notes window follows via BroadcastChannel.
 */
export function Deck({
  report,
  deckKey,
  initialIndex,
  exitHref,
  notesHref,
  lockedLabel,
}: DeckProps) {
  const count = report.slides.length;
  const fullscreen = useFullscreen();

  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  // Start the idle countdown too, so the controls fade even if the mouse never moves.
  const toggleFullscreen = () => {
    fullscreen.toggle();
    wake();
  };

  const { index, move } = useDeckNavigation({
    deckKey,
    count,
    initialIndex,
    syncUrl: true,
    onCommand: (command) =>
      command.type === "toggleFullscreen" ? toggleFullscreen() : fullscreen.exit(),
  });
  const slide = report.slides[index];
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );
  const chromeHidden = fullscreen.active && idle;

  const onStageClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    move(tapAction(event.clientX - rect.left, rect.width));
  };

  const chrome = cn(
    "pointer-events-none absolute inset-x-0 z-10 flex items-center gap-3 px-4 transition-opacity duration-300 sm:px-6 [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
    chromeHidden ? "opacity-0 focus-within:opacity-100" : "opacity-100",
  );

  return (
    <div
      data-testid="deck"
      onPointerMove={wake}
      className={cn(
        "theme-present fixed inset-0 overflow-hidden select-none",
        chromeHidden && "cursor-none",
      )}
    >
      <h1 className="sr-only">
        {report.title} – {report.periodLabel}
      </h1>
      <div
        role="presentation"
        data-testid="deck-stage"
        onClick={onStageClick}
        className="absolute inset-0"
      >
        {slide ? <Slide key={slide.id} slide={slide} index={index} count={count} fade /> : null}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {slide ? slideAnnouncement(index, count, slide.headline) : ""}
      </p>

      <div className={cn(chrome, "top-0 justify-between pt-3 sm:pt-4")}>
        <Button asChild variant="ghost" size="lg" className="gap-2">
          <Link href={exitHref} data-testid="deck-exit">
            <X aria-hidden="true" />
            Avsluta
          </Link>
        </Button>
        <div className="flex items-center gap-1 sm:gap-2">
          {lockedLabel ? (
            <span className="hidden items-center gap-1.5 text-xs tracking-[0.08em] text-muted-foreground uppercase md:inline-flex">
              <Lock aria-hidden="true" className="size-3.5" />
              {lockedLabel}
            </span>
          ) : null}
          <OpenNotesButton href={notesHref} />
          {fullscreen.supported ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={toggleFullscreen}
              aria-label={fullscreen.active ? "Lämna helskärm (F)" : "Helskärm (F)"}
              aria-pressed={fullscreen.active}
              data-testid="deck-fullscreen"
            >
              {fullscreen.active ? (
                <Minimize aria-hidden="true" />
              ) : (
                <Maximize aria-hidden="true" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <nav aria-label="Bilder" className={cn(chrome, "bottom-0 justify-center pb-3 sm:pb-4")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          onClick={() => move({ type: "prev" })}
          disabled={index === 0}
          aria-label="Föregående bild"
          data-testid="deck-prev"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {count <= MAX_DOTS ? (
          <ol className="hidden flex-wrap items-center justify-center sm:flex">
            {report.slides.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => move({ type: "goto", index: i })}
                  aria-label={`Gå till bild ${i + 1}`}
                  aria-current={i === index ? "step" : undefined}
                  data-testid="deck-dot"
                  className="group grid h-7 w-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-2 rounded-full transition-all duration-300",
                      i === index ? "w-5 bg-rod" : "w-2 bg-white/35 group-hover:bg-white/70",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        {/* Between the arrows on phones (no dots there), bottom right on larger screens. */}
        <span
          data-testid="deck-counter"
          className="num min-w-12 text-center text-sm text-muted-foreground sm:absolute sm:right-6 sm:min-w-0"
          aria-hidden="true"
        >
          {index + 1} / {count}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          onClick={() => move({ type: "next" })}
          disabled={index >= count - 1}
          aria-label="Nästa bild"
          data-testid="deck-next"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
