"use client";

import { ArrowLeftRight, Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_METRICS, withExploreState, type ExploreState } from "@/lib/dashboard/explore-state";
import type { MetricGroup } from "@/lib/dashboard/metrics-meta";
import type { ExplorePreset } from "@/lib/dashboard/presets";
import { cn } from "@/lib/utils";

export interface MetricPickerProps {
  groups: MetricGroup[];
  state: ExploreState;
  presets: ExplorePreset[];
}

type Mode = "replace" | "add";

/**
 * Selected metrics as chips; "Byt mått" replaces the selection, "Lägg till mått" puts another
 * metric side by side (multi-metric mode). Grouped by area, searchable, keyboard friendly.
 */
export function MetricPicker({ groups, state, presets }: MetricPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Mode | null>(null);
  const byKey = new Map(groups.flatMap((g) => g.metrics.map((m) => [m.key, m] as const)));
  const nameOf = (key: string) => byKey.get(key)?.name ?? key;

  const go = (next: Partial<ExploreState>) => {
    const params = withExploreState(
      { ...state, ...next, sort: null },
      new URLSearchParams(searchParams.toString()),
    );
    setOpen(null);
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const choose = (key: string, mode: Mode) => {
    if (mode === "replace") {
      // Keep the breakdown when the new metric has it; otherwise fall back to the suggestion.
      const dims = byKey.get(key)?.dimensions ?? [];
      const keep =
        state.groupBy === null ||
        state.groupBy === "bolag" ||
        state.groupBy === "manad" ||
        dims.includes(state.groupBy);
      go({ metrics: [key], groupBy: keep ? state.groupBy : null });
    } else if (!state.metrics.includes(key))
      go({ metrics: [...state.metrics, key].slice(0, MAX_METRICS) });
  };

  const picker = (mode: Mode) => (
    <Command
      // Search matches the metric name and its area.
      filter={(value, search) =>
        value.toLocaleLowerCase("sv-SE").includes(search.toLocaleLowerCase("sv-SE")) ? 1 : 0
      }
    >
      <CommandInput placeholder="Sök mått…" aria-label="Sök mått" />
      <CommandList>
        <CommandEmpty>Inget mått matchar.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.area} heading={g.area}>
            {g.metrics.map((m) => {
              const selected = state.metrics.includes(m.key);
              return (
                <CommandItem
                  key={m.key}
                  value={`${m.name} ${g.area} ${m.key}`}
                  data-checked={selected}
                  disabled={mode === "add" && selected}
                  data-testid={`metric-option-${m.key}`}
                  onSelect={() => choose(m.key, mode)}
                >
                  <span className="truncate">{m.name}</span>
                  {m.formula ? (
                    <span className="text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase">
                      formel
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );

  const trigger = (mode: Mode) => (
    <Popover open={open === mode} onOpenChange={(o) => setOpen(o ? mode : null)}>
      <PopoverTrigger asChild>
        <Button
          variant={mode === "replace" ? "outline" : "ghost"}
          size="sm"
          data-testid={mode === "replace" ? "metric-picker" : "metric-add"}
          disabled={mode === "add" && state.metrics.length >= MAX_METRICS}
        >
          {mode === "replace" ? <ArrowLeftRight aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {mode === "replace" ? "Byt mått" : "Lägg till mått"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        {picker(mode)}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className={cn("flex flex-col gap-3", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <ul aria-label="Valda mått" className="flex flex-wrap items-center gap-2">
          {state.metrics.map((key, i) => (
            <li
              key={key}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 text-sm",
                i === 0 ? "border-antracit bg-antracit text-white" : "border-border bg-card",
              )}
              data-testid={`metric-chip-${key}`}
            >
              {nameOf(key)}
              {state.metrics.length > 1 ? (
                <button
                  type="button"
                  onClick={() => go({ metrics: state.metrics.filter((k) => k !== key) })}
                  aria-label={`Ta bort ${nameOf(key)}`}
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    i === 0 ? "hover:bg-white/15" : "hover:bg-muted",
                  )}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : (
                <span className="w-2" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
        {trigger("replace")}
        {trigger("add")}
      </div>
      {presets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Snabbval:</span>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`preset-${p.id}`}
              onClick={() => go({ metrics: p.metrics, groupBy: p.groupBy, filters: [] })}
              className="rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
