import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

// Class maps are spelled out so Tailwind can see every class at build time.
const COLUMNS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

const SPAN = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 lg:col-span-3",
  4: "sm:col-span-2 lg:col-span-4",
} as const;

const ROW_SPAN = {
  1: "",
  2: "lg:row-span-2",
} as const;

export interface StatGridProps extends ComponentPropsWithoutRef<"div"> {
  /** Columns on large screens; one column on phones, two from `sm`. */
  columns?: keyof typeof COLUMNS;
}

/** Bento grid for KPI cards and charts. */
export function StatGrid({ columns = 4, className, ...props }: StatGridProps) {
  return (
    <div
      data-slot="stat-grid"
      className={cn(
        "grid grid-flow-row-dense grid-cols-1 gap-4 md:gap-6",
        COLUMNS[columns],
        className,
      )}
      {...props}
    />
  );
}

export interface StatGridItemProps extends ComponentPropsWithoutRef<"div"> {
  span?: keyof typeof SPAN;
  rowSpan?: keyof typeof ROW_SPAN;
}

export function StatGridItem({ span = 1, rowSpan = 1, className, ...props }: StatGridItemProps) {
  return (
    <div
      data-slot="stat-grid-item"
      className={cn("min-w-0", SPAN[span], ROW_SPAN[rowSpan], className)}
      {...props}
    />
  );
}
