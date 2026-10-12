// Comparison cells and delta wording shared by the engine, headlines and slides.
import type { Unit } from "@/lib/contracts/domain";
import type { CompareCell } from "@/lib/contracts/metric-query";
import type { Direction } from "@/lib/contracts/slides";
import {
  MINUS,
  formatDeltaAbsolute,
  formatDeltaPercent,
  formatDeltaPp,
} from "@/lib/core/format-sv";

/**
 * current vs base. deltaPct is relative to |base| (so a smaller loss reads as an
 * improvement) and null when the base is 0 or missing; deltaPp is set for pct units.
 */
export function makeCompareCell(
  current: number | null,
  base: number | null,
  unit: Unit,
  label: string,
): CompareCell {
  const delta = current !== null && base !== null ? current - base : null;
  const deltaPct =
    delta !== null && base !== null && base !== 0 ? (delta / Math.abs(base)) * 100 : null;
  return { value: base, delta, deltaPct, deltaPp: unit === "pct" ? delta : null, label };
}

/**
 * The delta as shown on slides and tables: percentage points for pct units, otherwise
 * relative percent, falling back to the absolute change when the base is 0. The
 * direction follows the displayed (rounded) figure, so "±0 %" is flat.
 */
export function describeDelta(
  cell: CompareCell,
  unit: Unit,
  opts: { compact?: boolean } = {},
): { formatted: string; direction: Direction } | null {
  let formatted: string;
  if (unit === "pct" && cell.deltaPp !== null) formatted = formatDeltaPp(cell.deltaPp, 1);
  else if (cell.deltaPct !== null) formatted = formatDeltaPercent(cell.deltaPct, 0);
  else if (cell.delta !== null) {
    formatted = formatDeltaAbsolute(cell.delta, unit, { compact: opts.compact && unit === "kr" });
  } else return null;
  const direction: Direction = formatted.startsWith("+")
    ? "up"
    : formatted.startsWith(MINUS)
      ? "down"
      : "flat";
  return { formatted, direction };
}
