// Tailwind classes for the dashboard grid, spelled out so the compiler sees every class.
// The grid uses container queries: card widths follow the content area, not the viewport
// (the sidebar takes 256 px from 1024 px up).
import type { LayoutBlock } from "@/lib/dashboard/layout";
import {
  bentoSpan,
  kpiMediumSpan,
  kpiSpansBothOnTwoColumns,
  kpiWideSpan,
} from "@/lib/dashboard/layout";

const MEDIUM_SPAN: Record<number, string> = {
  4: "@4xl:col-span-4",
  6: "@4xl:col-span-6",
  12: "@4xl:col-span-12",
};

const WIDE_SPAN: Record<number, string> = {
  3: "@7xl:col-span-3",
  4: "@7xl:col-span-4",
  5: "@7xl:col-span-5",
  6: "@7xl:col-span-6",
  7: "@7xl:col-span-7",
  8: "@7xl:col-span-8",
  9: "@7xl:col-span-9",
  10: "@7xl:col-span-10",
  11: "@7xl:col-span-11",
  12: "@7xl:col-span-12",
};

const BENTO_SPAN: Record<number, string> = {
  4: "@4xl:col-span-4",
  5: "@4xl:col-span-5",
  6: "@4xl:col-span-6",
  7: "@4xl:col-span-7",
  8: "@4xl:col-span-8",
  9: "@4xl:col-span-9",
  10: "@4xl:col-span-10",
  11: "@4xl:col-span-11",
  12: "@4xl:col-span-12",
};

export const DASHBOARD_ROOT = "@container flex flex-col gap-4 md:gap-6";

export function blockClass(block: LayoutBlock): string {
  return block.kind === "kpi"
    ? "grid grid-cols-1 gap-4 md:gap-6 @2xl:grid-cols-2 @4xl:grid-cols-12"
    : "grid grid-cols-1 gap-4 md:gap-6 @4xl:grid-cols-12";
}

/** Span classes of one widget inside its block. */
export function itemClass(block: LayoutBlock, index: number): string {
  const w = block.widgets[index]?.layout.w ?? 12;
  if (block.kind === "bento") return `min-w-0 ${BENTO_SPAN[bentoSpan(w)] ?? ""}`;
  return [
    "min-w-0",
    kpiSpansBothOnTwoColumns(index, block.widgets.length) ? "@2xl:col-span-2" : "",
    MEDIUM_SPAN[kpiMediumSpan(w)] ?? "",
    WIDE_SPAN[kpiWideSpan(w)] ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Card frame shared by chart widgets and Utforska panels (18 px radius, soft shadow). */
export const CARD = "rounded-card bg-card p-5 shadow-soft md:p-6";
