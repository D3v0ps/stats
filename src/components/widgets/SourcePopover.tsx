"use client";

import { FileText, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SourceListItem } from "@/lib/dashboard/sources";
import { cn } from "@/lib/utils";
import { getMetricSourcesAction, type SourceQueryInput } from "./actions";

export interface SourcePopoverProps {
  query: SourceQueryInput;
  /** What the sources are for, e.g. "Resultat" (accessible name of the button). */
  subject: string;
  className?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loaded"; items: SourceListItem[] }
  | { kind: "error"; message: string };

/** "Källa": which uploads (fil, rapport, mallversion, publicerad, månader) stand behind a number. */
export function SourcePopover({ query, subject, className }: SourcePopoverProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const result = await getMetricSourcesAction(query);
      setState(
        result.ok
          ? { kind: "loaded", items: result.items }
          : { kind: "error", message: result.message },
      );
    });
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && state.kind !== "loaded") load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          data-testid="source-popover"
          aria-label={`Källa för ${subject}`}
          className={cn("relative z-10 text-muted-foreground", className)}
        >
          <FileText aria-hidden="true" />
          Källa
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-xs font-medium tracking-[0.08em] uppercase">Källa</p>
          <p className="text-xs text-muted-foreground">Publicerade filer bakom {subject}</p>
        </div>
        <div className="max-h-80 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
          {pending ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Hämtar källor…
            </p>
          ) : state.kind === "error" ? (
            <p className="text-muted-foreground">{state.message}</p>
          ) : state.kind === "loaded" && state.items.length === 0 ? (
            <p className="text-muted-foreground">Inga publicerade filer för perioden.</p>
          ) : state.kind === "loaded" ? (
            <ul className="flex flex-col gap-3">
              {state.items.map((item) => (
                <li key={item.uploadId} className="flex flex-col gap-0.5">
                  <span className="font-medium break-all">{item.file}</span>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
                    <dt>Rapport</dt>
                    <dd>{item.report}</dd>
                    <dt>Mall</dt>
                    <dd>{item.template}</dd>
                    <dt>Publicerad</dt>
                    <dd>{item.published}</dd>
                    <dt>Månader</dt>
                    <dd>{item.months}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
