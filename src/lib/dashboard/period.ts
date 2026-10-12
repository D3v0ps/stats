// Period selection helpers for the global filter bar: the month list and the small hint next
// to the month ("senaste kompletta månad" / "ofullständig").
import type { UrlFilters } from "@/lib/app/filters";
import { addMonths, compareMonths, formatMonthLong, type Month } from "@/lib/core/month";
import { KEY_METRICS } from "@/lib/metrics/anchor";

export interface MonthOption {
  value: Month;
  label: string;
}

/** Months offered in the picker, newest first: `count` months ending at the last closed one. */
export function monthOptions(lastClosed: Month, selected: Month | null, count = 36): MonthOption[] {
  const months = Array.from({ length: count }, (_, i) => addMonths(lastClosed, -i));
  if (selected && !months.includes(selected)) months.push(selected);
  return months
    .sort((a, b) => compareMonths(b, a))
    .map((m) => {
      const label = formatMonthLong(m);
      return { value: m, label: label.charAt(0).toLocaleUpperCase("sv-SE") + label.slice(1) };
    });
}

export type AnchorHint =
  | { kind: "latest_complete"; text: string }
  | { kind: "incomplete"; text: string; detail: string }
  | null;

/**
 * The hint under the month picker: the default month that is complete gets "senaste kompletta
 * månad"; a month where a key metric lacks data gets "ofullständig" with what is missing.
 */
export function anchorHint(input: {
  anchor: Month;
  defaultAnchor: { month: Month; complete: boolean };
  /** Coverage of the key metrics for the anchor month (metric key -> months). */
  coverage: Record<string, string[]>;
  metricNames: Record<string, string>;
}): AnchorHint {
  const missing = KEY_METRICS.filter((k) => !(input.coverage[k] ?? []).includes(input.anchor));
  if (missing.length > 0) {
    const names = missing.map((k) => input.metricNames[k] ?? k);
    return {
      kind: "incomplete",
      text: "Ofullständig",
      detail: `Saknar data för ${formatMonthLong(input.anchor)}: ${names.join(", ")}.`,
    };
  }
  if (input.anchor === input.defaultAnchor.month && input.defaultAnchor.complete) {
    return { kind: "latest_complete", text: "Senaste kompletta månad" };
  }
  return null;
}

/** The anchor the page shows: the URL's month, else the default. */
export function effectiveAnchor(filters: UrlFilters, defaultAnchor: Month): Month {
  return filters.anchor ?? defaultAnchor;
}
