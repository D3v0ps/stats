// Utforska keeps its whole state in the URL (shareable, back button works):
// /utforska?matt=konsulter,timmar&grupp=kund&f=verksamhet.6&f=kund.42&sort=m0&dir=asc
// Global filters (bolag, period, manad) are handled by src/lib/app/filters.ts and kept alongside.
import { withUrlFilters, type UrlFilters } from "@/lib/app/filters";
import { DimensionKeySchema, MetricKeySchema } from "@/lib/contracts/domain";

/** Pseudo breakdown: one row per month (no grouping). */
export const MONTH_GROUP = "manad";

export const EXPLORE_PATH = "/utforska";

export const EXPLORE_PARAMS = {
  metrics: "matt",
  groupBy: "grupp",
  filter: "f",
  sort: "sort",
  dir: "dir",
} as const;

/** Side-by-side metrics are capped so the table stays readable. */
export const MAX_METRICS = 6;
/** Drill depth cap (bolag is not counted: it lives in the global company filter). */
export const MAX_FILTERS = 6;

export interface DrillFilter {
  dimension: string;
  valueId: number;
}

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface ExploreState {
  /** Selected metric keys; the first is the primary (chart, suggestions). */
  metrics: string[];
  /** Breakdown dimension, "bolag", "manad", or null = use the suggestion. */
  groupBy: string | null;
  /** Drill path in order (each crumb of the breadcrumb). One value per dimension. */
  filters: DrillFilter[];
  /** null = engine order (largest first). */
  sort: SortState | null;
}

export const EMPTY_EXPLORE_STATE: ExploreState = {
  metrics: [],
  groupBy: null,
  filters: [],
  sort: null,
};

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

function all(params: SearchParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

const FILTER_RE = /^([a-z][a-z0-9_]{1,40})\.(\d{1,15})$/;
const SORT_KEY_RE = /^[a-z0-9_.:-]{1,80}$/;

/** Lenient parse: junk is dropped (URLs get hand-edited and shared). */
export function parseExploreState(params: SearchParams): ExploreState {
  const metrics: string[] = [];
  for (const raw of all(params, EXPLORE_PARAMS.metrics)) {
    for (const part of raw.split(",")) {
      const key = part.trim();
      if (MetricKeySchema.safeParse(key).success && !metrics.includes(key)) metrics.push(key);
    }
  }

  const groupRaw = all(params, EXPLORE_PARAMS.groupBy)[0]?.trim() ?? "";
  const groupBy = DimensionKeySchema.safeParse(groupRaw).success ? groupRaw : null;

  const filters: DrillFilter[] = [];
  for (const raw of all(params, EXPLORE_PARAMS.filter)) {
    const m = FILTER_RE.exec(raw.trim());
    if (!m) continue;
    const dimension = m[1] as string;
    const valueId = Number(m[2]);
    if (!Number.isSafeInteger(valueId) || valueId <= 0) continue;
    if (filters.some((f) => f.dimension === dimension)) continue;
    filters.push({ dimension, valueId });
  }

  const sortKey = all(params, EXPLORE_PARAMS.sort)[0]?.trim() ?? "";
  const dirRaw = all(params, EXPLORE_PARAMS.dir)[0];
  const sort: SortState | null = SORT_KEY_RE.test(sortKey)
    ? { key: sortKey, dir: dirRaw === "asc" ? "asc" : "desc" }
    : null;

  return {
    metrics: metrics.slice(0, MAX_METRICS),
    groupBy,
    filters: filters.slice(0, MAX_FILTERS),
    sort,
  };
}

/** Write the explore state into params (replacing earlier explore params, keeping the rest). */
export function withExploreState(state: ExploreState, base?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const key of Object.values(EXPLORE_PARAMS)) out.delete(key);
  if (state.metrics.length > 0) out.set(EXPLORE_PARAMS.metrics, state.metrics.join(","));
  if (state.groupBy) out.set(EXPLORE_PARAMS.groupBy, state.groupBy);
  for (const f of state.filters) out.append(EXPLORE_PARAMS.filter, `${f.dimension}.${f.valueId}`);
  if (state.sort) {
    out.set(EXPLORE_PARAMS.sort, state.sort.key);
    out.set(EXPLORE_PARAMS.dir, state.sort.dir);
  }
  return out;
}

function hrefOf(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Link into Utforska with the given explore state and global filters. */
export function exploreHref(state: Partial<ExploreState>, filters: UrlFilters): string {
  return hrefOf(
    EXPLORE_PATH,
    withExploreState({ ...EMPTY_EXPLORE_STATE, ...state }, withUrlFilters(filters)),
  );
}

/** Entity page of one dimension value (kundkort etc.), keeping the global filters. */
export function entityHref(
  dimension: string,
  valueId: number,
  filters: UrlFilters,
  extra: Partial<Pick<ExploreState, "groupBy" | "sort">> = {},
): string {
  return hrefOf(
    `${EXPLORE_PATH}/${encodeURIComponent(dimension)}/${valueId}`,
    withExploreState({ ...EMPTY_EXPLORE_STATE, ...extra }, withUrlFilters(filters)),
  );
}

/** Same state with a different sort (clicking the active column flips the direction). */
export function toggleSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
  return { key, dir: key === "label" ? "asc" : "desc" };
}
