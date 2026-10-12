"use client";

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { Unit } from "@/lib/contracts";
import { formatChartValue } from "./chart-format";

/** Animate only when asked and the user has not requested reduced motion. */
export function useChartAnimation(animate: boolean): boolean {
  const reduced = usePrefersReducedMotion();
  return animate && !reduced;
}

/** Tooltip row for ChartTooltipContent: swatch, series name, value formatted in Swedish. */
export function tooltipFormatter(unit: Unit) {
  return function formatTooltipRow(
    value: unknown,
    name: unknown,
    item: { color?: string; payload?: { fill?: string } },
  ): ReactNode {
    const swatch = item.payload?.fill ?? item.color;
    return (
      <div className="flex w-full items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: swatch }}
          />
          {String(name ?? "")}
        </span>
        <span className="num font-medium text-foreground">{formatChartValue(value, unit)}</span>
      </div>
    );
  };
}

/** Axis tick styling shared by the cartesian charts. */
export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 } as const;
