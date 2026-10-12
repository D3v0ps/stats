"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FilterValue } from "@/lib/db/repo/present-extra";
import type { ReportDimension } from "@/lib/present/context";
import { filterSearchScore, filterSummary } from "@/lib/present/editor-options";

export interface FilterPickerProps {
  id: string;
  dimension: ReportDimension;
  values: FilterValue[];
  selected: number[];
  onToggle: (valueId: number) => void;
  onClear: () => void;
}

/** Multi-select of one dimension's values with search (e.g. Verksamhet: KROM, ROM2). */
export function FilterPicker({
  id,
  dimension,
  values,
  selected,
  onToggle,
  onClear,
}: FilterPickerProps) {
  const chosen = new Set(selected);
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{dimension.label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="h-9 w-full justify-between border-input font-normal"
            disabled={values.length === 0 && selected.length === 0}
            data-testid={`filter-${dimension.key}`}
          >
            <span className="truncate">
              {values.length === 0 && selected.length === 0
                ? "Inga värden ännu"
                : filterSummary(selected, values)}
            </span>
            <ChevronDown aria-hidden="true" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64 gap-0 p-0"
        >
          <Command filter={filterSearchScore}>
            <CommandInput placeholder={`Sök ${dimension.label.toLocaleLowerCase("sv-SE")}`} />
            <CommandList>
              <CommandEmpty>Inga träffar.</CommandEmpty>
              <CommandGroup>
                {values.map((v) => {
                  const isChosen = chosen.has(v.id);
                  return (
                    <CommandItem
                      key={v.id}
                      value={String(v.id)}
                      keywords={[v.label]}
                      data-checked={isChosen}
                      onSelect={() => onToggle(v.id)}
                    >
                      <span className="truncate">{v.label}</span>
                      <span className="sr-only">{isChosen ? ", vald" : ""}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {selected.length > 0 ? (
            <div className="border-t border-border p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onClear}>
                Rensa urvalet
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
