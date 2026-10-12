"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { BreakdownOption } from "@/lib/dashboard/load-explore";
import { cn } from "@/lib/utils";

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export interface BreakdownPickerProps {
  options: BreakdownOption[];
  active: string;
  label?: string;
}

/**
 * "Dela upp per": every breakdown as a link. Breakdowns the selected metrics lack are shown
 * disabled with the reason in a tooltip (also readable by screen readers).
 */
export function BreakdownPicker({ options, active, label = "Dela upp per" }: BreakdownPickerProps) {
  const labelId = useId();
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1.5">
        <span
          id={labelId}
          className="text-[0.68rem] font-medium tracking-[0.12em] text-muted-foreground uppercase"
        >
          {label}
        </span>
        <ul
          aria-labelledby={labelId}
          className="flex flex-wrap gap-2"
          data-testid="breakdown-picker"
        >
          {options.map((o) => {
            const isActive = o.key === active;
            const icon = o.personal ? <Lock aria-hidden="true" className="size-3" /> : null;
            const personalNote = o.personal ? " (personuppgift, visas bara i arbetsytan)" : "";
            if (!o.enabled) {
              return (
                <li key={o.key}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="link"
                        aria-disabled="true"
                        tabIndex={0}
                        data-testid={`breakdown-${o.key}`}
                        className={cn(
                          PILL,
                          "cursor-not-allowed border-dashed border-border text-muted-foreground/70",
                        )}
                      >
                        {icon}
                        {o.label}
                        <span className="sr-only">. {o.reason}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{o.reason}</TooltipContent>
                  </Tooltip>
                </li>
              );
            }
            const link = (
              <Link
                href={o.href}
                scroll={false}
                aria-current={isActive ? "true" : undefined}
                data-testid={`breakdown-${o.key}`}
                className={cn(
                  PILL,
                  isActive
                    ? "border-antracit bg-antracit text-white"
                    : "border-border bg-card text-foreground hover:border-antracit-200",
                )}
              >
                {icon}
                {o.label}
                {personalNote ? <span className="sr-only">{personalNote}</span> : null}
              </Link>
            );
            return (
              <li key={o.key}>
                {o.reason ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent>{o.reason}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </TooltipProvider>
  );
}
