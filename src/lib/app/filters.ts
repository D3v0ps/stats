// Global dashboard filters live in the URL so every view is linkable and the browser's back
// button works: ?bolag=MBAB&period=ytd&manad=2026-09
import { CompanyFilterSchema, PeriodGrainSchema, type CompanyFilter } from "../contracts/domain";
import { isMonth, type Month, type PeriodGrain } from "../core/month";

export interface UrlFilters {
  company: CompanyFilter;
  grain: PeriodGrain;
  /** null = use the default anchor (latest complete month). */
  anchor: Month | null;
}

export const DEFAULT_FILTERS: UrlFilters = { company: "ALL", grain: "month", anchor: null };

export const GRAIN_LABELS: Record<PeriodGrain, string> = {
  month: "Månad",
  quarter: "Kvartal",
  year: "År",
  ytd: "Hittills i år",
  r12: "Rullande 12",
};

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

function first(params: SearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Lenient parse: unknown or invalid values fall back to defaults (URLs get hand-edited). */
export function parseUrlFilters(params: SearchParams): UrlFilters {
  const company = CompanyFilterSchema.safeParse(first(params, "bolag")?.toUpperCase());
  const grain = PeriodGrainSchema.safeParse(first(params, "period"));
  const manad = first(params, "manad");
  return {
    company: company.success ? company.data : DEFAULT_FILTERS.company,
    grain: grain.success ? grain.data : DEFAULT_FILTERS.grain,
    anchor: manad && isMonth(manad) ? manad : null,
  };
}

/** Serialize, omitting defaults. Extra params (e.g. drill-down state) are preserved. */
export function withUrlFilters(filters: UrlFilters, base?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  const set = (key: string, value: string | null, dflt: string | null) => {
    if (value === null || value === dflt) out.delete(key);
    else out.set(key, value);
  };
  set("bolag", filters.company, DEFAULT_FILTERS.company);
  set("period", filters.grain, DEFAULT_FILTERS.grain);
  set("manad", filters.anchor, null);
  return out;
}
