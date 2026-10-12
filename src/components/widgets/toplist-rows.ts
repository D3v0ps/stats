// Rows of the dashboard toplist (ranked bars with links) from a resolved toplist slide.
import type { Direction, ResolvedSlide } from "@/lib/contracts/slides";
import { MINUS } from "@/lib/core/format-sv";
import type { CategoryLink } from "@/lib/dashboard/load-dashboard";
import { OTHERS_LABEL } from "@/lib/metrics";

export interface ToplistRow {
  rank: number | null;
  label: string;
  href: string | null;
  value: number | null;
  /** Bar length relative to the largest positive value (0..1). */
  share: number;
  formatted: string;
  delta: {
    direction: Direction;
    formatted: string;
    favorable: boolean | null;
    againstLabel: string;
  } | null;
  others: boolean;
}

/** Direction of a formatted delta ("+12 %", "−4 %", "±0 %"). */
export function directionOf(formatted: string): Direction | null {
  const t = formatted.trim();
  if (t.startsWith("+")) return "up";
  if (t.startsWith(MINUS) || t.startsWith("-")) return "down";
  if (t.startsWith("±")) return "flat";
  return null;
}

export function toplistRows(
  slide: Pick<ResolvedSlide, "chart" | "table">,
  links: readonly CategoryLink[],
  higherIsBetter: boolean | null,
): ToplistRow[] {
  const categories = slide.chart?.categories ?? [];
  const values = slide.chart?.series[0]?.values ?? [];
  const tableRows = slide.table?.rows ?? [];
  const deltaColumn = (slide.table?.columns.length ?? 0) >= 4 ? 2 : -1;
  const compareLabel = deltaColumn >= 0 ? (slide.table?.columns[2] ?? "") : "";
  const max = Math.max(0, ...values.map((v) => (typeof v === "number" && v > 0 ? v : 0)));
  let rank = 0;
  return categories.map((label, i) => {
    const value = values[i] ?? null;
    const others = label === OTHERS_LABEL && links[i]?.href == null;
    const row = tableRows[i];
    const deltaText = deltaColumn >= 0 ? row?.values[deltaColumn] : undefined;
    const direction = deltaText ? directionOf(deltaText) : null;
    return {
      rank: others ? null : ++rank,
      label,
      href: links[i]?.label === label ? (links[i]?.href ?? null) : null,
      value,
      share: max > 0 && typeof value === "number" && value > 0 ? value / max : 0,
      formatted: row?.values[0] ?? "–",
      delta:
        deltaText && direction
          ? {
              direction,
              formatted: deltaText,
              favorable:
                higherIsBetter === null || direction === "flat"
                  ? null
                  : (direction === "up") === higherIsBetter,
              againstLabel: compareLabel ? `mot ${compareLabel.toLocaleLowerCase("sv-SE")}` : "",
            }
          : null,
      others,
    };
  });
}
