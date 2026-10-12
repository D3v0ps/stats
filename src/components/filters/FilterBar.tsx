"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GRAIN_LABELS, withUrlFilters, type UrlFilters } from "@/lib/app/filters";
import {
  COMPANY_FILTER_LABELS,
  CompanyFilterSchema,
  PeriodGrainSchema,
  type CompanyFilter,
} from "@/lib/contracts/domain";
import type { AnchorHint, MonthOption } from "@/lib/dashboard/period";
import { cn } from "@/lib/utils";

const COMPANY_ORDER: CompanyFilter[] = ["MBAB", "MBR", "ALL"];
const GRAIN_ORDER = PeriodGrainSchema.options;

export interface FilterBarProps {
  filters: UrlFilters;
  /** The month the page shows (URL month or default). */
  anchor: string;
  /** Default anchor (latest complete month); picking it removes ?manad from the URL. */
  defaultAnchor: string;
  months: MonthOption[];
  hint: AnchorHint;
  className?: string;
}

const CAPTION = "text-[0.68rem] font-medium tracking-[0.12em] text-muted-foreground uppercase";

/**
 * Global filters: company, period grain and month. State lives in the URL (?bolag, ?period,
 * ?manad) so every view can be shared and the back button works; other params are kept.
 */
export function FilterBar({
  filters,
  anchor,
  defaultAnchor,
  months,
  hint,
  className,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const ids = { company: useId(), grain: useId(), month: useId(), hint: useId() };

  const navigate = (next: UrlFilters) => {
    const params = withUrlFilters(next, new URLSearchParams(searchParams.toString()));
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div
      role="group"
      aria-label="Filter"
      aria-busy={pending}
      data-testid="filter-bar"
      className={cn(
        "flex flex-wrap items-end gap-x-6 gap-y-4 transition-opacity",
        pending && "opacity-60",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span id={ids.company} className={CAPTION}>
          Bolag
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={filters.company}
          aria-labelledby={ids.company}
          data-testid="filter-company"
          onValueChange={(value) => {
            const parsed = CompanyFilterSchema.safeParse(value);
            if (parsed.success && parsed.data !== filters.company) {
              navigate({ ...filters, company: parsed.data });
            }
          }}
        >
          {COMPANY_ORDER.map((c) => (
            <ToggleGroupItem
              key={c}
              value={c}
              data-testid={`filter-company-${c}`}
              className="px-3 data-[state=on]:bg-antracit data-[state=on]:text-white"
            >
              {COMPANY_FILTER_LABELS[c]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={ids.grain} className={CAPTION}>
          Period
        </span>
        <Select
          value={filters.grain}
          onValueChange={(value) => {
            const parsed = PeriodGrainSchema.safeParse(value);
            if (parsed.success) navigate({ ...filters, grain: parsed.data });
          }}
        >
          <SelectTrigger
            aria-labelledby={ids.grain}
            data-testid="filter-grain"
            className="min-w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRAIN_ORDER.map((g) => (
              <SelectItem key={g} value={g}>
                {GRAIN_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={ids.month} className={CAPTION}>
          Månad
        </span>
        <Select
          value={anchor}
          onValueChange={(value) =>
            navigate({ ...filters, anchor: value === defaultAnchor ? null : value })
          }
        >
          <SelectTrigger
            aria-labelledby={ids.month}
            aria-describedby={hint ? ids.hint : undefined}
            data-testid="filter-month"
            className="min-w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {months.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hint ? (
        <div className="pb-1.5" id={ids.hint} data-testid="filter-month-hint">
          {hint.kind === "incomplete" ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    tabIndex={0}
                    className="cursor-help border-rod-200 text-antracit"
                  >
                    <span aria-hidden="true" className="text-rod">
                      ●
                    </span>
                    {hint.text}
                    <span className="sr-only">. {hint.detail}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{hint.detail}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Badge variant="secondary" className="bg-bla-100 text-antracit">
              {hint.text}
            </Badge>
          )}
        </div>
      ) : null}
    </div>
  );
}
