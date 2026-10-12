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
import { BUDGET_METRIC_KEY, COMPANY_GROUP } from "@/lib/contracts/metric-query";
import { budgetLeafTargets, budgetLedgerRows } from "@/lib/metrics/memory-source";
import { formulaOperands, listAccountGroups, listMetricDefinitions } from "./catalog";
import { fetchAll, toGroup, toNumber, unwrap, type DbClient } from "./shared";

export { BUDGET_METRIC_KEY };
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

/** Cache key for an RPC result: the arguments that RPC reads, with sets sorted. */
function memoKey(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

function matchesFilters(group: Group, filters: DimFilter[]): boolean {
  return filters.every((f) => {
    const v = group[f.dimension];
    return typeof v === "number" && f.valueIds.includes(v);
  });
}

/**
 * One instance serves one request (getMetricSource): definitions, account groups and the
 * results of coverage, labels and lastUpdated are memoized per instance, keyed by the
 * arguments each RPC reads, so a dashboard whose widgets ask the same questions sends each
 * RPC once. A failed call is forgotten so a retry asks again. Callers get their own copies.
 */
export class SupabaseMetricDataSource implements MetricDataSource {
  private definitionsCache: Promise<MetricDefinition[]> | null = null;
  private accountGroupsCache: Promise<AccountGroup[]> | null = null;
  private kontogruppCache: Promise<Map<number, string>> | null = null;
  private dimensionIdCache: Promise<Map<string, number>> | null = null;
  private fiscalCache: Promise<number> | null = null;
  private readonly coverageMemo = new Map<string, Promise<Record<string, string[]>>>();
  private readonly labelsMemo = new Map<string, Promise<Record<number, string>>>();
  private readonly lastUpdatedMemo = new Map<string, Promise<Record<string, string | null>>>();

  constructor(private readonly db: DbClient) {}

  private memoized<T>(memo: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
    let promise = memo.get(key);
    if (!promise) {
      promise = load().catch((e: unknown) => {
        memo.delete(key);
        throw e;
      });
      memo.set(key, promise);
    }
    return promise;
  }

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
   * Budget for ledger metrics: budget_belopp facts (SIE sign) grouped by kontogrupp, whose
   * value codes equal account group keys. The budget of group G is the sum of the leaf
   * groups within G's ranges times G.sign (budgetLedgerRows, the same code the in-memory
   * reference source runs), so kostnader and resultat are derived from their parts.
   */
  private async budgetLedger(keys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    const [kontogrupp, groups] = await Promise.all([this.kontogruppValues(), this.accountGroups()]);
    const leaves = budgetLeafTargets(keys, groups);
    const ids = [...kontogrupp].filter(([, code]) => leaves.has(code)).map(([id]) => id);
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
    return budgetLedgerRows(keys, rows, (id) => kontogrupp.get(id), groups, scope.groupBy);
  }

  /** Months with data per metric. metric_coverage reads no grouping or filters. */
  async coverage(metricKeys: string[], scope: SourceScope): Promise<Record<string, string[]>> {
    if (metricKeys.length === 0 || scope.companies.length === 0) {
      return Object.fromEntries(metricKeys.map((k) => [k, []]));
    }
    const keys = sortedSet(metricKeys);
    const key = memoKey(keys, sortedSet(scope.companies), scope.scenario, scope.from, scope.to);
    const all = await this.memoized(this.coverageMemo, key, () => this.loadCoverage(keys, scope));
    return Object.fromEntries(metricKeys.map((k) => [k, [...(all[k] ?? [])]]));
  }

  private async loadCoverage(
    metricKeys: string[],
    scope: SourceScope,
  ): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = Object.fromEntries(metricKeys.map((k) => [k, []]));
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
    if (ids.length === 0 || dimension === COMPANY_GROUP) return {};
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    const found = await this.memoized(this.labelsMemo, memoKey(dimension, unique), () =>
      this.loadLabels(dimension, unique),
    );
    return { ...found };
  }

  private async loadLabels(dimension: string, unique: number[]): Promise<Record<number, string>> {
    const out: Record<number, string> = {};
    const dimensionId = (await this.dimensionIds()).get(dimension);
    if (dimensionId === undefined) return out;
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

  /** Newest publish behind each metric. metric_sources reads no grouping or filters. */
  async lastUpdated(
    metricKeys: string[],
    scope: SourceScope,
  ): Promise<Record<string, string | null>> {
    if (metricKeys.length === 0 || scope.companies.length === 0) {
      return Object.fromEntries(metricKeys.map((k) => [k, null]));
    }
    const keys = sortedSet(metricKeys);
    const key = memoKey(keys, sortedSet(scope.companies), scope.scenario, scope.from, scope.to);
    const all = await this.memoized(this.lastUpdatedMemo, key, () =>
      this.loadLastUpdated(keys, scope),
    );
    return Object.fromEntries(metricKeys.map((k) => [k, all[k] ?? null]));
  }

  private async loadLastUpdated(
    metricKeys: string[],
    scope: SourceScope,
  ): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = Object.fromEntries(metricKeys.map((k) => [k, null]));
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
