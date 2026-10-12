// The metric engine: turns a MetricQuery into MetricResults by reading monthly rows
// through a MetricDataSource and applying each metric kind's roll-up rule
// (docs/architecture.md "Metric semantics"). Pure TypeScript, no I/O of its own.
import {
  COMPANY_FILTER_LABELS,
  type CompanyCode,
  type CompanyFilter,
  type ComparisonKind,
  type Scenario,
} from "@/lib/contracts/domain";
import {
  COMPANY_GROUP,
  MetricQuerySchema,
  type CompareCell,
  type Coverage,
  type DimFilter,
  type GroupCell,
  type MetricDataSource,
  type MetricDefinition,
  type MetricQuery,
  type MetricQueryResult,
  type MetricResult,
  type SourceScope,
  type ValueCell,
} from "@/lib/contracts/metric-query";
import {
  addMonths,
  compareMonths,
  formatPeriodLabel,
  monthRange,
  previousPeriod,
  previousYear,
  resolvePeriod,
  type Month,
  type PeriodWindow,
} from "@/lib/core/month";
import { makeCompareCell } from "./compare";
import { FormulaSyntaxError, MetricConfigError } from "./errors";
import { evaluateFormula, parseFormula, referencedKeys, type FormulaNode } from "./formula";

export const OTHERS_LABEL = "Övriga";
export const UNASSIGNED_LABEL = "(saknas)";
/** Ledger remainder not booked on any kostnadsställe (and budget rows without one). */
export const UNALLOCATED_LABEL = "Ofördelat";
export const BUDGET_LABEL = "budget";

const KOSTNADSSTALLE = "kostnadsstalle";

type GroupId = number | string | null;

interface EvalScope {
  companies: CompanyCode[];
  scenario: Scenario;
  groupBy: string | null;
  filters: DimFilter[];
}

/** Months actually read: the window clipped at its anchor (later months have no data yet). */
export interface DataRange {
  from: Month;
  to: Month;
  months: Month[];
}

interface GroupValue {
  id: GroupId;
  value: number | null;
}

interface WindowEval {
  /** Months in the range with published data. */
  covered: Set<Month>;
  total: number | null;
  /**
   * Value of a group without rows: 0 when the window has data (a covered month is a real
   * 0), but null for a company group whose company has no data at all in the window.
   */
  absentFor: (groupKey: string) => number | null;
  groups: Map<string, GroupValue>;
}

interface Point {
  month: Month;
  group: Record<string, number | string | null>;
  value: number;
}

export function companiesOf(filter: CompanyFilter): CompanyCode[] {
  return filter === "ALL" ? ["MBAB", "MBR"] : [filter];
}

/** Months of the window up to and including the anchor. */
export function dataRangeOf(window: PeriodWindow): DataRange {
  const to = compareMonths(window.to, window.anchor) > 0 ? window.anchor : window.to;
  return { from: window.from, to, months: monthRange(window.from, to) };
}

/** Group/filter dimensions the metric does not have ("bolag" is always available for grouping). */
export function notApplicableDimensions(
  def: MetricDefinition,
  groupBy: string | null,
  filters: readonly DimFilter[],
): string[] {
  const out: string[] = [];
  if (groupBy !== null && groupBy !== COMPANY_GROUP && !def.dimensions.includes(groupBy)) {
    out.push(groupBy);
  }
  for (const f of filters) {
    if (!def.dimensions.includes(f.dimension) && !out.includes(f.dimension)) out.push(f.dimension);
  }
  return out;
}

/** Whether group values add up to the total (so an "Övriga" remainder is meaningful). */
export function isAdditiveKind(kind: MetricDefinition["kind"]): boolean {
  return kind === "sum" || kind === "ledger" || kind === "snapshot";
}

const groupKey = (id: GroupId): string => JSON.stringify(id);

function sourceScope(scope: EvalScope, range: DataRange, groupBy: string[]): SourceScope {
  return {
    companies: scope.companies,
    scenario: scope.scenario,
    from: range.from,
    to: range.to,
    groupBy,
    filters: scope.filters,
  };
}

function emptyEval(): WindowEval {
  return { covered: new Set(), total: null, absentFor: () => null, groups: new Map() };
}

/** Absent groups are 0, except companies without any data in the window (unknown). */
function zeroUnlessCompanyMissing(companiesWithData: Set<string> | null) {
  return (key: string): number | null =>
    companiesWithData === null || companiesWithData.has(key) ? 0 : null;
}

function coveredSet(months: string[] | undefined, points: Point[], range: DataRange): Set<Month> {
  const inRange = new Set(range.months);
  const out = new Set<Month>();
  for (const m of months ?? []) if (inRange.has(m)) out.add(m);
  // Rows imply data even if a source's coverage lags behind.
  for (const p of points) if (inRange.has(p.month)) out.add(p.month);
  return out;
}

function latest(months: Iterable<Month>): Month | null {
  let best: Month | null = null;
  for (const m of months) if (best === null || compareMonths(m, best) > 0) best = m;
  return best;
}

/** The most recent ISO timestamp, compared as instants. */
function newest(timestamps: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const t of timestamps) {
    if (t && (best === null || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

function earliest(months: Iterable<Month>): Month | null {
  let best: Month | null = null;
  for (const m of months) if (best === null || compareMonths(m, best) < 0) best = m;
  return best;
}

/** sum/ledger: add months; snapshot: last month with data or the average of months with data. */
function rollUpAdditive(
  points: Point[],
  covered: Set<Month>,
  mode: "sum" | "last" | "avg",
  groupBy: string | null,
  companiesWithData: Set<string> | null,
): WindowEval {
  if (covered.size === 0) return emptyEval();
  let contributing = covered;
  let divisor = 1;
  if (mode === "last") contributing = new Set([latest(covered) as Month]);
  if (mode === "avg") divisor = covered.size;

  let total = 0;
  const groups = new Map<string, GroupValue>();
  for (const p of points) {
    if (!contributing.has(p.month)) continue;
    total += p.value;
    if (groupBy === null) continue;
    const id = p.group[groupBy] ?? null;
    const key = groupKey(id);
    const g = groups.get(key);
    if (g) g.value = (g.value ?? 0) + p.value;
    else groups.set(key, { id, value: p.value });
  }
  if (divisor !== 1) {
    total /= divisor;
    for (const g of groups.values()) if (g.value !== null) g.value /= divisor;
  }
  return { covered, total, absentFor: zeroUnlessCompanyMissing(companiesWithData), groups };
}

class Evaluator {
  private readonly parsed = new Map<string, FormulaNode>();

  constructor(
    readonly source: MetricDataSource,
    private readonly defs: Map<string, MetricDefinition>,
  ) {}

  def(key: string): MetricDefinition {
    const def = this.defs.get(key);
    if (!def) throw new MetricConfigError(`Okänt mått: ${key}.`, key);
    return def;
  }

  private formula(def: MetricDefinition): FormulaNode {
    const cached = this.parsed.get(def.key);
    if (cached) return cached;
    if (!def.formula?.trim()) throw new MetricConfigError(`${def.name} saknar formel.`, def.key);
    try {
      const node = parseFormula(def.formula);
      this.parsed.set(def.key, node);
      return node;
    } catch (e) {
      if (e instanceof FormulaSyntaxError) {
        throw new MetricConfigError(`Fel i formeln för ${def.name}: ${e.message}`, def.key);
      }
      throw e;
    }
  }

  /**
   * The metric and, for a formula, every metric behind it (recursively). Lineage is
   * resolved here rather than left to the source, which may know nothing about formulas.
   */
  lineage(def: MetricDefinition, seen = new Set<string>()): string[] {
    if (seen.has(def.key)) return [];
    seen.add(def.key);
    if (def.kind !== "formula") return [def.key];
    let operands: string[];
    try {
      operands = referencedKeys(this.formula(def));
    } catch (e) {
      if (e instanceof MetricConfigError) return [def.key];
      throw e;
    }
    return [
      def.key,
      ...operands.flatMap((key) => {
        const operand = this.defs.get(key);
        return operand ? this.lineage(operand, seen) : [];
      }),
    ];
  }

  private operands(def: MetricDefinition, visiting: readonly string[]): MetricDefinition[] {
    if (visiting.includes(def.key)) {
      throw new MetricConfigError(
        `Formeln för ${def.name} refererar till sig själv (${[...visiting, def.key].join(" → ")}).`,
        def.key,
      );
    }
    return referencedKeys(this.formula(def)).map((k) => this.def(k));
  }

  private config<T>(def: MetricDefinition, value: T | null | undefined, what: string): T {
    if (value === null || value === undefined || value === "") {
      throw new MetricConfigError(`${def.name} saknar ${what}.`, def.key);
    }
    return value;
  }

  private async additivePoints(
    def: MetricDefinition,
    scope: SourceScope,
  ): Promise<{ points: Point[]; coverage: string[] | undefined }> {
    if (def.kind === "ledger") {
      const groupKeyOfAccounts = this.config(def, def.accountGroupKey, "kontogrupp");
      // A budget file that does not budget an account group says nothing about it: its
      // budget is unknown, not 0. So ledger budget counts only months with rows.
      const budget = scope.scenario === "budget";
      const [rows, coverage] = await Promise.all([
        this.source.ledger([groupKeyOfAccounts], scope),
        budget ? Promise.resolve(null) : this.source.coverage([def.key], scope),
      ]);
      return {
        points: rows.filter((r) => r.accountGroupKey === groupKeyOfAccounts),
        coverage: coverage?.[def.key],
      };
    }
    const [rows, coverage] = await Promise.all([
      this.source.monthly([def.key], scope),
      this.source.coverage([def.key], scope),
    ]);
    return { points: rows.filter((r) => r.metricKey === def.key), coverage: coverage[def.key] };
  }

  /**
   * Grouping by company: the companies (as group keys) with data in the range, so a
   * company that has not reported is unknown rather than 0. null when not grouping by
   * company. Ledger budget has no coverage of its own; its rows decide (added by caller).
   */
  private async companiesWithData(
    def: MetricDefinition,
    scope: EvalScope,
    range: DataRange,
  ): Promise<Set<string> | null> {
    if (scope.groupBy !== COMPANY_GROUP) return null;
    if (def.kind === "ledger" && scope.scenario === "budget") return new Set();
    const inRange = new Set(range.months);
    const perCompany = await Promise.all(
      scope.companies.map((company) =>
        this.source.coverage([def.key], sourceScope({ ...scope, companies: [company] }, range, [])),
      ),
    );
    const out = new Set<string>();
    scope.companies.forEach((company, i) => {
      if ((perCompany[i]?.[def.key] ?? []).some((m) => inRange.has(m))) out.add(groupKey(company));
    });
    return out;
  }

  /** The metric's value over a window, in total and per group, by its own roll-up rule. */
  async window(
    def: MetricDefinition,
    range: DataRange,
    scope: EvalScope,
    visiting: readonly string[] = [],
  ): Promise<WindowEval> {
    switch (def.kind) {
      case "sum":
      case "ledger":
      case "snapshot": {
        const groupBy = scope.groupBy === null ? [] : [scope.groupBy];
        const [{ points, coverage }, companies] = await Promise.all([
          this.additivePoints(def, sourceScope(scope, range, groupBy)),
          this.companiesWithData(def, scope, range),
        ]);
        if (companies !== null) {
          const inRange = new Set(range.months);
          for (const p of points) {
            if (inRange.has(p.month)) companies.add(groupKey(p.group[COMPANY_GROUP] ?? null));
          }
        }
        const mode = def.kind === "snapshot" ? (def.snapshotRollup ?? "last") : "sum";
        return rollUpAdditive(
          points,
          coveredSet(coverage, points, range),
          mode,
          scope.groupBy,
          companies,
        );
      }
      case "distinct": {
        const base = this.config(def, def.baseMetricKey, "basmått");
        const dimension = this.config(def, def.distinctDimension, "dimension att räkna");
        const totalScope = sourceScope(scope, range, []);
        const [totalRows, groupRows, coverage, companies] = await Promise.all([
          this.source.distinct(base, dimension, totalScope, false),
          scope.groupBy === null
            ? Promise.resolve([])
            : this.source.distinct(
                base,
                dimension,
                sourceScope(scope, range, [scope.groupBy]),
                false,
              ),
          this.source.coverage([def.key], totalScope),
          this.companiesWithData(def, scope, range),
        ]);
        const covered = coveredSet(coverage[def.key], [], range);
        if (covered.size === 0) return emptyEval();
        // Distinct counts are never added across months or groups: the total is its own count.
        const total = totalRows.reduce((acc, r) => acc + r.count, 0);
        const groups = new Map<string, GroupValue>();
        if (scope.groupBy !== null) {
          for (const r of groupRows) {
            const id = r.group[scope.groupBy] ?? null;
            const g = groups.get(groupKey(id));
            if (g) g.value = (g.value ?? 0) + r.count;
            else groups.set(groupKey(id), { id, value: r.count });
          }
        }
        return { covered, total, absentFor: zeroUnlessCompanyMissing(companies), groups };
      }
      case "formula": {
        const node = this.formula(def);
        const operands = this.operands(def, visiting);
        const path = [...visiting, def.key];
        const evals = await Promise.all(operands.map((op) => this.window(op, range, scope, path)));
        let covered = new Set(range.months);
        for (const e of evals) covered = new Set([...covered].filter((m) => e.covered.has(m)));
        if (covered.size === 0) return emptyEval();
        // Like for like: an operand with data in months another operand lacks is rolled up
        // again over the common months only, so a ratio never divides three months of one
        // dataset by two of another. (A distinct operand is read over the common months'
        // span; a gap inside that span cannot be excluded from a distinct count.)
        const common: DataRange = {
          from: earliest(covered) as Month,
          to: latest(covered) as Month,
          months: range.months.filter((m) => covered.has(m)),
        };
        await Promise.all(
          operands.map(async (op, i) => {
            if ((evals[i] as WindowEval).covered.size === covered.size) return;
            evals[i] = await this.window(op, common, scope, path);
          }),
        );
        const byKey = new Map(operands.map((op, i) => [op.key, evals[i] as WindowEval]));

        const operand = (key: string): WindowEval => byKey.get(key) as WindowEval;
        const groups = new Map<string, GroupValue>();
        if (scope.groupBy !== null) {
          const ids = new Map<string, GroupId>();
          for (const e of evals) for (const [k, g] of e.groups) ids.set(k, g.id);
          for (const [k, id] of ids) {
            const value = evaluateFormula(node, (key) => {
              const e = operand(key);
              const g = e.groups.get(k);
              return g ? g.value : e.absentFor(k);
            });
            groups.set(k, { id, value });
          }
        }
        return {
          covered,
          total: evaluateFormula(node, (key) => operand(key).total),
          absentFor: (k) => evaluateFormula(node, (key) => operand(key).absentFor(k)),
          groups,
        };
      }
    }
  }

  /** Monthly totals (no grouping); null for months without data. */
  async series(
    def: MetricDefinition,
    range: DataRange,
    scope: EvalScope,
    visiting: readonly string[] = [],
  ): Promise<Map<Month, number | null>> {
    const out = new Map<Month, number | null>();
    switch (def.kind) {
      case "sum":
      case "ledger":
      case "snapshot": {
        const { points, coverage } = await this.additivePoints(def, sourceScope(scope, range, []));
        const covered = coveredSet(coverage, points, range);
        for (const m of range.months) out.set(m, covered.has(m) ? 0 : null);
        for (const p of points) {
          const v = out.get(p.month);
          if (v !== undefined && v !== null) out.set(p.month, v + p.value);
        }
        return out;
      }
      case "distinct": {
        const base = this.config(def, def.baseMetricKey, "basmått");
        const dimension = this.config(def, def.distinctDimension, "dimension att räkna");
        const s = sourceScope(scope, range, []);
        const [rows, coverage] = await Promise.all([
          this.source.distinct(base, dimension, s, true),
          this.source.coverage([def.key], s),
        ]);
        const covered = coveredSet(coverage[def.key], [], range);
        for (const m of range.months) out.set(m, covered.has(m) ? 0 : null);
        for (const r of rows) {
          if (r.month === null) continue;
          const v = out.get(r.month);
          if (v !== undefined && v !== null) out.set(r.month, v + r.count);
        }
        return out;
      }
      case "formula": {
        const node = this.formula(def);
        const operands = this.operands(def, visiting);
        const maps = await Promise.all(
          operands.map((op) => this.series(op, range, scope, [...visiting, def.key])),
        );
        const byKey = new Map(
          operands.map((op, i) => [op.key, maps[i] as Map<Month, number | null>]),
        );
        for (const m of range.months) {
          out.set(
            m,
            evaluateFormula(node, (key) => byKey.get(key)?.get(m) ?? null),
          );
        }
        return out;
      }
    }
  }
}

export interface ComparisonPlan {
  kind: ComparisonKind;
  /** Months read for the comparison (clipped like the current window). */
  range: DataRange;
  scenario: Scenario;
  label: string;
}

/**
 * The window a comparison reads, like for like: the previous period contributes as many
 * leading months as the current window has up to its anchor (a quarter anchored on its
 * second month compares two months with two months); the previous year is the same
 * window a year earlier, clipped at its own anchor; budget is the current window. The
 * period comparisons stay in the query's scenario (a budget query compares budgets).
 * null for the previous period of a YTD window, which has no meaning.
 */
export function comparisonPlan(
  kind: ComparisonKind,
  window: PeriodWindow,
  fiscalStart: number,
  scenario: Scenario = "utfall",
): ComparisonPlan | null {
  const current = dataRangeOf(window);
  if (kind === "budget") {
    return { kind, range: current, scenario: "budget", label: BUDGET_LABEL };
  }
  if (kind === "prev_year") {
    const w = previousYear(window, fiscalStart);
    return { kind, range: dataRangeOf(w), scenario, label: formatPeriodLabel(w, fiscalStart) };
  }
  const w = previousPeriod(window, fiscalStart);
  if (w === null) return null;
  const months = w.months.slice(0, current.months.length);
  return {
    kind,
    range: { from: w.from, to: months.at(-1) as Month, months },
    scenario,
    label: formatPeriodLabel(w, fiscalStart),
  };
}

function compareGroups(a: GroupCell, b: GroupCell): number {
  if (a.value === null && b.value !== null) return 1;
  if (b.value === null && a.value !== null) return -1;
  if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
  // Ties are ordered by label, then id, so the topN cut never depends on row order.
  return a.label.localeCompare(b.label, "sv") || String(a.id).localeCompare(String(b.id));
}

/** Float noise from subtracting sums must not become a phantom remainder. */
function clean(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function othersGroup(
  kept: GroupCell[],
  total: ValueCell,
  unit: MetricDefinition["unit"],
): GroupCell {
  const remainder = (whole: number | null, parts: (number | null)[]): number | null =>
    whole === null ? null : clean(parts.reduce<number>((acc, v) => acc - (v ?? 0), whole));
  const value = remainder(
    total.value,
    kept.map((g) => g.value),
  );
  const compare: Partial<Record<ComparisonKind, CompareCell>> = {};
  for (const [kind, cell] of Object.entries(total.compare) as [ComparisonKind, CompareCell][]) {
    const base = remainder(
      cell.value,
      kept.map((g) => g.compare[kind]?.value ?? null),
    );
    compare[kind] = makeCompareCell(value, base, unit, cell.label);
  }
  return { id: null, label: OTHERS_LABEL, value, coverage: total.coverage, compare };
}

export async function runMetricQuery(
  query: MetricQuery,
  source: MetricDataSource,
): Promise<MetricQueryResult> {
  const q = MetricQuerySchema.parse(query);
  const [definitions, fiscalStart] = await Promise.all([
    source.definitions(),
    source.fiscalStartMonth(),
  ]);
  const evaluator = new Evaluator(source, new Map(definitions.map((d) => [d.key, d])));
  const metricDefs = q.metricKeys.map((k) => evaluator.def(k));

  const window = resolvePeriod(q.period, fiscalStart);
  const range = dataRangeOf(window);
  const windowLabel = formatPeriodLabel(window, fiscalStart);
  const companies = companiesOf(q.company);
  const scope: EvalScope = {
    companies,
    scenario: q.scenario,
    groupBy: q.groupBy,
    filters: q.filters,
  };
  const comparisons = [...new Set(q.compare)]
    .map((kind) => comparisonPlan(kind, window, fiscalStart, q.scenario))
    .filter((plan): plan is ComparisonPlan => plan !== null);
  const seriesMonths =
    q.series === null
      ? null
      : q.series === "window"
        ? window.months
        : monthRange(addMonths(window.anchor, -11), window.anchor);

  const lineage = new Map(metricDefs.map((def) => [def.key, evaluator.lineage(def)]));
  const lineageKeys = [...new Set([...lineage.values()].flat())];

  const [lastUpdated, results] = await Promise.all([
    source.lastUpdated(lineageKeys, sourceScope({ ...scope, groupBy: null }, range, [])),
    Promise.all(
      metricDefs.map(async (def): Promise<MetricResult> => {
        const coverageOf = (e: WindowEval): Coverage => ({
          withData: e.covered.size,
          expected: range.months.length,
        });
        const base = {
          metricKey: def.key,
          name: def.name,
          unit: def.unit,
          kind: def.kind,
          higherIsBetter: def.higherIsBetter,
          window: { from: window.from, to: window.to, label: windowLabel },
        };

        const notApplicable = notApplicableDimensions(def, q.groupBy, q.filters);
        if (notApplicable.length > 0) {
          return {
            ...base,
            status: "not_applicable",
            notApplicable,
            total: {
              value: null,
              coverage: { withData: 0, expected: range.months.length },
              compare: {},
            },
            groups: [],
            series: null,
            lastUpdatedAt: null,
          };
        }

        const [current, compared, seriesMap] = await Promise.all([
          evaluator.window(def, range, scope),
          Promise.all(
            comparisons.map(async (c) => ({
              plan: c,
              result: await evaluator.window(def, c.range, { ...scope, scenario: c.scenario }),
            })),
          ),
          seriesMonths === null
            ? Promise.resolve(null)
            : evaluator.series(
                def,
                dataRangeOf({
                  ...window,
                  from: seriesMonths[0] as Month,
                  to: seriesMonths.at(-1) as Month,
                }),
                { ...scope, groupBy: null },
              ),
        ]);

        const coverage = coverageOf(current);
        const total: ValueCell = { value: current.total, coverage, compare: {} };
        for (const { plan, result } of compared) {
          total.compare[plan.kind] = makeCompareCell(
            current.total,
            result.total,
            def.unit,
            plan.label,
          );
        }

        let groups: GroupCell[] = [];
        if (q.groupBy !== null) {
          const groupBy = q.groupBy;
          const ids = [...current.groups.values()]
            .map((g) => g.id)
            .filter((id): id is number => typeof id === "number");
          const labels =
            groupBy === COMPANY_GROUP || ids.length === 0 ? {} : await source.labels(groupBy, ids);
          const labelOf = (id: GroupId): string => {
            if (id === null)
              return groupBy === KOSTNADSSTALLE ? UNALLOCATED_LABEL : UNASSIGNED_LABEL;
            if (typeof id === "string") return COMPANY_FILTER_LABELS[id as CompanyFilter] ?? id;
            return labels[id] ?? String(id);
          };
          groups = [...current.groups.entries()].map(([key, g]) => {
            const compare: Partial<Record<ComparisonKind, CompareCell>> = {};
            for (const { plan, result } of compared) {
              const other = result.groups.get(key);
              compare[plan.kind] = makeCompareCell(
                g.value,
                other ? other.value : result.absentFor(key),
                def.unit,
                plan.label,
              );
            }
            return { id: g.id, label: labelOf(g.id), value: g.value, coverage, compare };
          });
          groups.sort(compareGroups);
          if (q.topN !== null && groups.length > q.topN) {
            const kept = groups.slice(0, q.topN);
            groups = isAdditiveKind(def.kind)
              ? [...kept, othersGroup(kept, total, def.unit)]
              : kept;
          }
        }

        return {
          ...base,
          status: coverage.withData === 0 ? "no_data" : "ok",
          notApplicable: [],
          total,
          groups,
          series:
            seriesMonths === null || seriesMap === null
              ? null
              : seriesMonths.map((month) => ({ month, value: seriesMap.get(month) ?? null })),
          lastUpdatedAt: null,
        };
      }),
    ),
  ]);

  return {
    query: q,
    results: results.map((r) =>
      r.status === "not_applicable"
        ? r
        : {
            ...r,
            lastUpdatedAt: newest((lineage.get(r.metricKey) ?? []).map((k) => lastUpdated[k])),
          },
    ),
  };
}
