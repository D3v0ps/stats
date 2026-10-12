// MetricDataSource over the SQL RPCs (metric_monthly, metric_distinct, ledger_monthly,
// metric_coverage, metric_sources). The metric engine (src/lib/metrics) does all
// roll-up semantics; this adapter only fetches and reshapes rows.
import { dateToMonth, monthToDate } from "@/lib/core/month";
import type {
  AccountGroup,
  DimFilter,
  DistinctRow,
  LedgerMonthlyRow,
  MetricDataSource,
  MetricDefinition,
  MonthlyRow,
  SourceScope,
} from "@/lib/contracts/metric-query";
import { COMPANY_GROUP } from "@/lib/contracts/metric-query";
import { formulaOperands, listAccountGroups, listMetricDefinitions } from "./catalog";
import { fetchAll, toGroup, toNumber, unwrap, type DbClient } from "./shared";

/** The budget dataset's metric used as budget for every ledger metric (per kontogrupp). */
export const BUDGET_METRIC_KEY = "budget_belopp";
const KONTOGRUPP = "kontogrupp";
const KOSTNADSSTALLE = "kostnadsstalle";

type Group = Record<string, number | string | null>;

function groupKey(group: Group, keys: string[]): string {
  return JSON.stringify(keys.map((k) => group[k] ?? null));
}

function pick(group: Group, keys: string[]): Group {
  const out: Group = {};
  for (const k of keys) out[k] = group[k] ?? null;
  return out;
}

/** Re-sum rows after dropping/narrowing grouping keys. */
export function regroupLedger(rows: LedgerMonthlyRow[], keys: string[]): LedgerMonthlyRow[] {
  const sums = new Map<string, LedgerMonthlyRow>();
  for (const r of rows) {
    const group = pick(r.group, keys);
    const id = `${r.accountGroupKey}|${r.month}|${groupKey(group, keys)}`;
    const prev = sums.get(id);
    if (prev) prev.value += r.value;
    else
      sums.set(id, { accountGroupKey: r.accountGroupKey, month: r.month, group, value: r.value });
  }
  return [...sums.values()];
}

function matchesFilters(group: Group, filters: DimFilter[]): boolean {
  return filters.every((f) => {
    const v = group[f.dimension];
    return typeof v === "number" && f.valueIds.includes(v);
  });
}

export class SupabaseMetricDataSource implements MetricDataSource {
  private definitionsCache: Promise<MetricDefinition[]> | null = null;
  private accountGroupsCache: Promise<AccountGroup[]> | null = null;
  private kontogruppCache: Promise<Map<number, string>> | null = null;
  private dimensionIdCache: Promise<Map<string, number>> | null = null;
  private fiscalCache: Promise<number> | null = null;

  constructor(private readonly db: DbClient) {}

  definitions(): Promise<MetricDefinition[]> {
    this.definitionsCache ??= listMetricDefinitions(this.db).catch((e: unknown) => {
      this.definitionsCache = null;
      throw e;
    });
    return this.definitionsCache;
  }

  accountGroups(): Promise<AccountGroup[]> {
    this.accountGroupsCache ??= listAccountGroups(this.db).catch((e: unknown) => {
      this.accountGroupsCache = null;
      throw e;
    });
    return this.accountGroupsCache;
  }

  async monthly(metricKeys: string[], scope: SourceScope): Promise<MonthlyRow[]> {
    if (metricKeys.length === 0 || scope.companies.length === 0) return [];
    const rows = await fetchAll("metric_monthly", (from, to) =>
      this.db
        .rpc("metric_monthly", {
          p_metric_keys: metricKeys,
          p_company_codes: scope.companies,
          p_scenario: scope.scenario,
          p_from: monthToDate(scope.from),
          p_to: monthToDate(scope.to),
          p_group_by: scope.groupBy,
          p_filters: scope.filters,
        })
        .range(from, to),
    );
    return rows.map((r) => ({
      metricKey: r.metric_key,
      month: dateToMonth(r.month),
      group: toGroup(r.grp),
      value: toNumber(r.value),
    }));
  }

  async distinct(
    baseMetricKey: string,
    distinctDimension: string,
    scope: SourceScope,
    perMonth: boolean,
  ): Promise<(DistinctRow & { month: string | null })[]> {
    if (scope.companies.length === 0) return [];
    const rows = await fetchAll("metric_distinct", (from, to) =>
      this.db
        .rpc("metric_distinct", {
          p_base_metric_key: baseMetricKey,
          p_dimension: distinctDimension,
          p_company_codes: scope.companies,
          p_scenario: scope.scenario,
          p_from: monthToDate(scope.from),
          p_to: monthToDate(scope.to),
          p_group_by: scope.groupBy,
          p_filters: scope.filters,
          p_per_month: perMonth,
        })
        .range(from, to),
    );
    return rows.map((r) => ({
      month: r.month === null ? null : dateToMonth(r.month),
      group: toGroup(r.grp),
      count: toNumber(r.cnt),
    }));
  }

  async ledger(accountGroupKeys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    if (accountGroupKeys.length === 0 || scope.companies.length === 0) return [];
    return scope.scenario === "budget"
      ? this.budgetLedger(accountGroupKeys, scope)
      : this.actualLedger(accountGroupKeys, scope);
  }

  /**
   * ledger_monthly has no filter parameter: a kostnadsställe filter is applied here by
   * grouping on kostnadsställe and re-summing. Any other filter cannot be honoured and
   * returns no rows rather than a silently unfiltered total (the engine marks such
   * queries not_applicable before asking).
   */
  private async actualLedger(keys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    if (scope.filters.some((f) => f.dimension !== KOSTNADSSTALLE)) return [];
    const filtered = scope.filters.length > 0;
    const groupBy =
      filtered && !scope.groupBy.includes(KOSTNADSSTALLE)
        ? [...scope.groupBy, KOSTNADSSTALLE]
        : scope.groupBy;
    const raw = await fetchAll("ledger_monthly", (from, to) =>
      this.db
        .rpc("ledger_monthly", {
          p_group_keys: keys,
          p_company_codes: scope.companies,
          p_from: monthToDate(scope.from),
          p_to: monthToDate(scope.to),
          p_group_by: groupBy,
        })
        .range(from, to),
    );
    const rows: LedgerMonthlyRow[] = raw.map((r) => ({
      accountGroupKey: r.group_key,
      month: dateToMonth(r.month),
      group: toGroup(r.grp),
      value: toNumber(r.value),
    }));
    if (!filtered) return rows;
    return regroupLedger(
      rows.filter((r) => matchesFilters(r.group, scope.filters)),
      scope.groupBy,
    );
  }

  /**
   * Budget for ledger metrics: budget_belopp facts grouped by kontogrupp, whose value
   * codes equal account group keys. Budget files carry amounts in presentation sign
   * (revenue and costs positive), so no account-group sign is applied.
   */
  private async budgetLedger(keys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    const kontogrupp = await this.kontogruppValues();
    const ids = [...kontogrupp].filter(([, code]) => keys.includes(code)).map(([id]) => id);
    if (ids.length === 0) return [];
    const groupBy = scope.groupBy.includes(KONTOGRUPP)
      ? scope.groupBy
      : [...scope.groupBy, KONTOGRUPP];
    const rows = await this.monthly([BUDGET_METRIC_KEY], {
      ...scope,
      scenario: "budget",
      groupBy,
      filters: [
        ...scope.filters.filter((f) => f.dimension !== KONTOGRUPP),
        { dimension: KONTOGRUPP, valueIds: ids },
      ],
    });
    const out: LedgerMonthlyRow[] = [];
    for (const r of rows) {
      const id = r.group[KONTOGRUPP];
      const code = typeof id === "number" ? kontogrupp.get(id) : undefined;
      if (!code || !keys.includes(code)) continue;
      out.push({ accountGroupKey: code, month: r.month, group: r.group, value: r.value });
    }
    return regroupLedger(out, scope.groupBy);
  }

  async coverage(metricKeys: string[], scope: SourceScope): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = Object.fromEntries(metricKeys.map((k) => [k, []]));
    if (metricKeys.length === 0 || scope.companies.length === 0) return out;
    const defs = new Map((await this.definitions()).map((d) => [d.key, d]));
    const budgetLedger = scope.scenario === "budget";
    const direct = metricKeys.filter((k) => {
      const kind = defs.get(k)?.kind;
      return kind !== "formula" && !(budgetLedger && kind === "ledger");
    });
    const viaBudget = budgetLedger ? metricKeys.filter((k) => defs.get(k)?.kind === "ledger") : [];
    const query = viaBudget.length > 0 ? [...new Set([...direct, BUDGET_METRIC_KEY])] : direct;
    if (query.length === 0) return out;

    const rows = await fetchAll("metric_coverage", (from, to) =>
      this.db
        .rpc("metric_coverage", {
          p_metric_keys: query,
          p_company_codes: scope.companies,
          p_scenario: scope.scenario,
          p_from: monthToDate(scope.from),
          p_to: monthToDate(scope.to),
        })
        .range(from, to),
    );
    const byKey = new Map<string, string[]>();
    for (const r of rows) {
      const list = byKey.get(r.metric_key) ?? [];
      list.push(dateToMonth(r.month));
      byKey.set(r.metric_key, list);
    }
    for (const k of direct) out[k] = byKey.get(k) ?? [];
    for (const k of viaBudget) out[k] = byKey.get(BUDGET_METRIC_KEY) ?? [];
    return out;
  }

  async labels(dimension: string, ids: number[]): Promise<Record<number, string>> {
    const out: Record<number, string> = {};
    if (ids.length === 0 || dimension === COMPANY_GROUP) return out;
    const dimensionId = (await this.dimensionIds()).get(dimension);
    if (dimensionId === undefined) return out;
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 500) {
      const rows = unwrap(
        "dimension_values",
        await this.db
          .from("dimension_values")
          .select("id, label")
          .eq("dimension_id", dimensionId)
          .in("id", unique.slice(i, i + 500)),
      );
      for (const r of rows) out[r.id] = r.label;
    }
    return out;
  }

  async lastUpdated(
    metricKeys: string[],
    scope: SourceScope,
  ): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = Object.fromEntries(metricKeys.map((k) => [k, null]));
    if (metricKeys.length === 0 || scope.companies.length === 0) return out;
    const defs = new Map((await this.definitions()).map((d) => [d.key, d]));
    const allKeys = new Set(defs.keys());

    // Metric -> the non-formula metrics whose data stands behind it.
    const leaves = (key: string, seen = new Set<string>()): string[] => {
      const def = defs.get(key);
      if (!def || seen.has(key)) return [];
      seen.add(key);
      if (def.kind === "formula") {
        return formulaOperands(def.formula ?? "", allKeys).flatMap((k) => leaves(k, seen));
      }
      if (def.kind === "ledger" && scope.scenario === "budget") return [BUDGET_METRIC_KEY];
      return [key];
    };
    const leafMap = new Map(metricKeys.map((k) => [k, leaves(k)]));
    const query = [...new Set([...leafMap.values()].flat())];
    if (query.length === 0) return out;

    const rows = await fetchAll("metric_sources", (from, to) =>
      this.db
        .rpc("metric_sources", {
          p_metric_keys: query,
          p_company_codes: scope.companies,
          p_from: monthToDate(scope.from),
          p_to: monthToDate(scope.to),
        })
        .range(from, to),
    );
    const newestByDataset = new Map<string, string>();
    for (const r of rows) {
      const prev = newestByDataset.get(r.dataset_key);
      if (!prev || Date.parse(r.published_at) > Date.parse(prev)) {
        newestByDataset.set(r.dataset_key, r.published_at);
      }
    }
    for (const [key, leafKeys] of leafMap) {
      let newest: string | null = null;
      for (const leaf of leafKeys) {
        const datasetKey = defs.get(leaf)?.datasetKey;
        const at = datasetKey ? newestByDataset.get(datasetKey) : undefined;
        if (at && (newest === null || Date.parse(at) > Date.parse(newest))) newest = at;
      }
      out[key] = newest;
    }
    return out;
  }

  fiscalStartMonth(): Promise<number> {
    this.fiscalCache ??= (async () => {
      const rows = unwrap(
        "companies",
        await this.db.from("companies").select("fiscal_start_month").order("id").limit(1),
      );
      return rows[0]?.fiscal_start_month ?? 1;
    })().catch((e: unknown) => {
      this.fiscalCache = null;
      throw e;
    });
    return this.fiscalCache;
  }

  private kontogruppValues(): Promise<Map<number, string>> {
    this.kontogruppCache ??= (async () => {
      const dimensionId = (await this.dimensionIds()).get(KONTOGRUPP);
      if (dimensionId === undefined) return new Map<number, string>();
      const rows = unwrap(
        "dimension_values",
        await this.db.from("dimension_values").select("id, code").eq("dimension_id", dimensionId),
      );
      return new Map(rows.map((r) => [r.id, r.code]));
    })().catch((e: unknown) => {
      this.kontogruppCache = null;
      throw e;
    });
    return this.kontogruppCache;
  }

  private dimensionIds(): Promise<Map<string, number>> {
    this.dimensionIdCache ??= (async () => {
      const rows = unwrap("dimensions", await this.db.from("dimensions").select("id, key"));
      return new Map(rows.map((r) => [r.key, r.id]));
    })().catch((e: unknown) => {
      this.dimensionIdCache = null;
      throw e;
    });
    return this.dimensionIdCache;
  }
}
