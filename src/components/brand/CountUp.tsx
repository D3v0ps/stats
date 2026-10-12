"use client";

import { useCountUp } from "@/hooks/use-count-up";
import type { Unit } from "@/lib/contracts";
import { formatValue, type FormatOptions } from "@/lib/core/format-sv";
import { cn } from "@/lib/utils";

export interface CountUpProps {
  value: number;
  unit?: Unit;
  formatOptions?: FormatOptions;
  /** Show the final number immediately (frozen reports, PDF). A [data-static] ancestor does the same. */
  static?: boolean;
  durationMs?: number;
  className?: string;
}

/**
 * A number that counts up once when it appears. Server HTML always holds the formatted final
 * value, so print and frozen views never show zeros; reduced motion skips the animation.
 */
export function CountUp({
  value,
  unit = "st",
  formatOptions,
  static: isStatic = false,
  durationMs,
  className,
}: CountUpProps) {
  const format = (n: number) => formatValue(n, unit, formatOptions);
  const ref = useCountUp<HTMLSpanElement>(value, format, { durationMs, static: isStatic });
  return (
    <span ref={ref} data-slot="count-up" className={cn("num", className)}>
      {format(value)}
    </span>
  );
}
