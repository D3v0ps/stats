// Drill-down: which breakdown comes next, what clicking a row does, and the breadcrumb
// "Summa bolag › MB AB › Bemanning › Budbee Södertälje" that leads back up.
import type { UrlFilters } from "@/lib/app/filters";
import {
  COMPANY_FILTER_LABELS,
  CompanyCodeSchema,
  type CompanyFilter,
} from "@/lib/contracts/domain";
import { COMPANY_GROUP } from "@/lib/contracts/metric-query";
import { isMonth } from "@/lib/core/month";
import { MONTH_GROUP, exploreHref, type DrillFilter, type ExploreState } from "./explore-state";

/**
 * The natural drill order: bolag → verksamhet/kostnadsställe → kund → uppdrag → konsult.
 * Dimensions outside the chain (ort, resultattyp, ...) follow in the metric's own order.
 */
export const DRILL_CHAIN = [
  COMPANY_GROUP,
  "verksamhet",
  "kostnadsstalle",
  "kund",
  "uppdrag",
  "konsult",
] as const;

/** Dimensions never offered as a drill suggestion (bookkeeping plumbing). */
const NOT_SUGGESTED: ReadonlySet<string> = new Set(["kontogrupp"]);

/**
 * The breakdown to suggest after `after` (null = start), among the supported dimensions
 * ("bolag" is always supported) that are not already used by the drill path.
 */
export function suggestNextDimension(
  after: string | null,
  supported: readonly string[],
  used: ReadonlySet<string>,
): string | null {
  const available = (d: string) =>
    (d === COMPANY_GROUP || supported.includes(d)) && !used.has(d) && !NOT_SUGGESTED.has(d);
  const chain: string[] = [...DRILL_CHAIN];
  const start = after === null ? 0 : chain.indexOf(after) + 1;
  // after a dimension outside the chain, only other non-chain dimensions remain to suggest
  if (after === null || chain.includes(after)) {
    for (const d of chain.slice(start)) if (available(d)) return d;
  }
  for (const d of supported) if (!chain.includes(d) && d !== after && available(d)) return d;
  return null;
}

/** Dimensions already fixed by the drill path (bolag counts when a company is chosen). */
export function usedDimensions(
  company: CompanyFilter,
  filters: readonly DrillFilter[],
): Set<string> {
  const used = new Set(filters.map((f) => f.dimension));
  if (company !== "ALL") used.add(COMPANY_GROUP);
  return used;
}

/** The last step of the drill path: the newest filter, else bolag when a company is chosen. */
export function lastDrilled(
  company: CompanyFilter,
  filters: readonly DrillFilter[],
): string | null {
  const last = filters.at(-1);
  if (last) return last.dimension;
  return company === "ALL" ? null : COMPANY_GROUP;
}

/** Breakdown used when the URL names none: the next step of the drill path, else per month. */
export function defaultBreakdown(
  company: CompanyFilter,
  filters: readonly DrillFilter[],
  supported: readonly string[],
): string {
  return (
    suggestNextDimension(
      lastDrilled(company, filters),
      supported,
      usedDimensions(company, filters),
    ) ?? MONTH_GROUP
  );
}

/** A row the user can click: a company, a dimension value, or a month. */
export type DrillRow =
  | { kind: "company"; company: string }
  | { kind: "value"; dimension: string; valueId: number }
  | { kind: "month"; month: string };

export interface DrillResult {
  state: ExploreState;
  filters: UrlFilters;
}

/**
 * Clicking a row adds it to the drill path and switches to the suggested next breakdown
 * (per month when nothing is left to break down by). Returns null for rows that cannot be
 * drilled into (Övriga, (saknas), Ofördelat).
 */
export function drillInto(
  state: ExploreState,
  filters: UrlFilters,
  row: DrillRow,
  supported: readonly string[],
): DrillResult | null {
  const base: ExploreState = { ...state, sort: null };
  if (row.kind === "company") {
    const company = CompanyCodeSchema.safeParse(row.company);
    if (!company.success) return null;
    const next = { ...filters, company: company.data };
    return {
      filters: next,
      state: { ...base, groupBy: defaultBreakdown(next.company, state.filters, supported) },
    };
  }
  if (row.kind === "month") {
    if (!isMonth(row.month)) return null;
    const next: UrlFilters = { ...filters, grain: "month", anchor: row.month };
    return {
      filters: next,
      state: { ...base, groupBy: defaultBreakdown(next.company, state.filters, supported) },
    };
  }
  if (row.dimension === COMPANY_GROUP || row.dimension === MONTH_GROUP) return null;
  const without = state.filters.filter((f) => f.dimension !== row.dimension);
  const drilled = [...without, { dimension: row.dimension, valueId: row.valueId }];
  return {
    filters,
    state: {
      ...base,
      filters: drilled,
      groupBy: defaultBreakdown(filters.company, drilled, supported),
    },
  };
}

export interface Crumb {
  label: string;
  /** null for the current (last) crumb. */
  href: string | null;
}

export const ROOT_CRUMB_LABEL = COMPANY_FILTER_LABELS.ALL;

/**
 * Breadcrumb of the drill path. Going back to a crumb restores the breakdown that was used
 * at that level (the dimension that was drilled into next), so "back" really is back.
 */
export function buildBreadcrumbs(
  state: ExploreState,
  filters: UrlFilters,
  labelOf: (f: DrillFilter) => string,
): Crumb[] {
  const groupBy = state.groupBy;
  const levels: { label: string; company: CompanyFilter; path: DrillFilter[] }[] = [
    { label: ROOT_CRUMB_LABEL, company: "ALL", path: [] },
  ];
  if (filters.company !== "ALL") {
    levels.push({
      label: COMPANY_FILTER_LABELS[filters.company],
      company: filters.company,
      path: [],
    });
  }
  state.filters.forEach((f, i) => {
    levels.push({
      label: labelOf(f),
      company: filters.company,
      path: state.filters.slice(0, i + 1),
    });
  });

  return levels.map((level, i) => {
    if (i === levels.length - 1) return { label: level.label, href: null };
    // The breakdown that led from this level to the next one.
    const nextLevel = levels[i + 1];
    const nextBreakdown =
      nextLevel && nextLevel.path.length === level.path.length
        ? COMPANY_GROUP
        : (nextLevel?.path.at(-1)?.dimension ?? groupBy);
    return {
      label: level.label,
      href: exploreHref(
        { metrics: state.metrics, groupBy: nextBreakdown, filters: level.path },
        { ...filters, company: level.company },
      ),
    };
  });
}
