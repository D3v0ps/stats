"use client";

import { ChevronLeft, ChevronRight, MonitorPlay, RotateCcw } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatElapsed, slideAnnouncement, type NotesOutline } from "@/lib/present/slide-view";
import { DECK_WINDOW_NAME, isDeckLocation } from "@/lib/present/sync";
import { useDeckNavigation } from "./use-deck-navigation";

export interface SpeakerNotesProps {
  outline: NotesOutline;
  deckKey: string;
  deckHref: string;
}

const KICKER = "text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

/**
 * Brings the deck window forward (the deck names its window), loading the deck there only
 * when that window shows something else. Without a reference the link opens it normally.
 */
function focusDeck(event: MouseEvent<HTMLAnchorElement>, deckHref: string) {
  const win = window.open("", DECK_WINDOW_NAME);
  if (!win) return;
  event.preventDefault();
  let showing = false;
  try {
    showing = isDeckLocation(win.location.pathname, deckHref);
  } catch {
    // Not readable (another origin): load the deck.
  }
  if (!showing) win.location.href = deckHref;
  win.focus();
}

/**
 * The presenter's window: current slide's notes in large type, the next headline and the
 * elapsed time. Arrow keys here move the deck too (and vice versa).
 */
export function SpeakerNotes({ outline, deckKey, deckHref }: SpeakerNotesProps) {
  const count = outline.slides.length;
  const { index, move } = useDeckNavigation({ deckKey, count, initialIndex: 0 });
  const current = outline.slides[index];
  const next = outline.slides[index + 1];

  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [run]);
  const resetTimer = () => {
    setElapsed(0);
    setRun((r) => r + 1);
  };

  return (
    <div
      data-testid="notes-window"
      className="theme-present flex min-h-dvh flex-col gap-8 px-5 py-6 sm:px-10 sm:py-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={KICKER}>Talarmanus</h1>
          <p className="truncate text-sm text-muted-foreground">
            {outline.title} · {outline.periodLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="flex flex-col items-end">
            <span className={KICKER}>Tid</span>
            <span
              className="num text-3xl font-light"
              data-testid="notes-timer"
              role="timer"
              aria-live="off"
            >
              {formatElapsed(elapsed)}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={resetTimer}
            aria-label="Nollställ tiden"
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5">
        {current ? (
          <>
            <p className={KICKER} aria-live="polite" aria-atomic="true">
              <span className="sr-only">{slideAnnouncement(index, count, current.headline)}</span>
              <span aria-hidden="true">
                Bild {index + 1} av {count}
              </span>
            </p>
            <h2 className="text-xl font-light tracking-[0.06em] uppercase md:text-2xl">
              {current.headline}
            </h2>
            {current.notes.trim() ? (
              <p
                data-testid="notes-text"
                className="max-w-[60ch] text-[clamp(1.5rem,3.2vw,2.75rem)] leading-snug whitespace-pre-wrap"
              >
                {current.notes}
              </p>
            ) : (
              <p data-testid="notes-text" className="text-xl text-muted-foreground">
                Inget talarmanus för den här bilden.
              </p>
            )}
            {current.footnote ? (
              <p className="text-sm text-muted-foreground">Fotnot: {current.footnote}</p>
            ) : null}
          </>
        ) : (
          <p className="text-xl text-muted-foreground">Rapporten har inga bilder.</p>
        )}
      </main>

      <footer className="flex flex-wrap items-end justify-between gap-6 border-t border-border pt-6">
        <div className="flex min-w-0 flex-col gap-1" data-testid="notes-next">
          <span className={KICKER}>Nästa</span>
          <span className="text-lg tracking-[0.06em] uppercase md:text-xl">
            {next ? next.headline : "Sista bilden."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="lg" className="gap-2">
            <a
              href={deckHref}
              target={DECK_WINDOW_NAME}
              onClick={(event) => focusDeck(event, deckHref)}
            >
              <MonitorPlay aria-hidden="true" />
              Presentationen
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => move({ type: "prev" })}
            disabled={index === 0}
            aria-label="Föregående bild"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={() => move({ type: "next" })}
            disabled={index >= count - 1}
            aria-label="Nästa bild"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
