// In-memory MetricDataSource: the TypeScript reference implementation of the SQL
// RPC semantics (metric_monthly, metric_distinct, ledger_monthly, metric_coverage,
// metric_sources) plus the ledger-budget mapping done by the Supabase adapter.
// Tests use it directly; the database module cross-checks its RPCs against it.
//
// "Current" mirrors upload_slices: every (upload, dataset, company, scenario, month)
// that has rows (or is listed in `slices`) is a slice candidate. Among the current
// uploads covering the same dataset/company/scenario/month the slice with the highest
// priority wins (ledger rows with yearOffset < 0 have priority -1), then the latest
// upload time, then the upload listed last in `current`.
import type { CompanyCode, Scenario } from "@/lib/contracts/domain";
import type { FactRow } from "@/lib/contracts/import-payload";
import {
  COMPANY_GROUP,
  type AccountGroup,
  type DimFilter,
  type DistinctRow,
  type LedgerMonthlyRow,
  type MetricDataSource,
  type MetricDefinition,
  type MonthlyRow,
  type SourceScope,
} from "@/lib/contracts/metric-query";
import { compareMonths } from "@/lib/core/month";
import { parseFormula, referencedKeys } from "./formula";

/** The budget dataset's metric that serves as budget for every ledger metric. */
export const BUDGET_METRIC_KEY = "budget_belopp";
const KONTOGRUPP = "kontogrupp";
const KOSTNADSSTALLE = "kostnadsstalle";

/** A fact as stored in metric_values (dims hold dimension_values ids). */
export type MemoryFact = Omit<FactRow, "sourceRows"> & {
  uploadId: string;
  sourceRows?: number[];
};

/** A row of ledger_balances: totals have dimNo null, object rows carry the value id. */
export interface MemoryLedgerRow {
  uploadId: string;
  company: CompanyCode;
  month: string;
  account: number;
  dimNo: number | null;
  objectValueId: number | null;
  /** Signed as in SIE: revenue negative, costs positive. */
  amount: number;
  /** -1 = previous-year rows inside the file (slice priority -1). Default 0. */
  yearOffset?: number;
}

/** A covered slice without rows (a month whose real value is 0), or a priority override. */
export interface MemorySlice {
  uploadId: string;
  datasetKey: string;
  company: CompanyCode;
  month: string;
  priority?: number;
}

export interface MemorySourceInput {
  definitions: MetricDefinition[];
  accountGroups?: AccountGroup[];
  facts?: MemoryFact[];
  ledger?: MemoryLedgerRow[];
  /** Published (non-retracted) upload ids; later entries count as published later. */
  current: Iterable<string>;
  /** Upload scenario; uploads not listed are "utfall". */
  scenarios?: Record<string, Scenario>;
  slices?: MemorySlice[];
  /** dimension key -> value id -> label. */
  labels?: Record<string, Record<number, string>>;
  /** dimension key -> value id -> code. kontogrupp codes are account group keys; defaults to labels. */
  codes?: Record<string, Record<number, string>>;
  fiscalStartMonth?: number;
  /** Upload id -> published_at (ISO). */
  uploadTimes?: Record<string, string>;
  /** Dataset of ledger rows. Defaults to the dataset of the first ledger metric. */
  ledgerDatasetKey?: string;
}

type Group = Record<string, number | string | null>;

interface Candidate {
  uploadId: string;
  priority: number;
  order: number;
  time: number;
}

export class MemoryMetricDataSource implements MetricDataSource {
  private readonly defs: Map<string, MetricDefinition>;
  private readonly facts: MemoryFact[];
  private readonly ledgerRows: MemoryLedgerRow[];
  private readonly winners = new Map<string, Candidate>();
  private readonly ledgerDatasetKey: string;
  private readonly currentOrder: Map<string, number>;

  constructor(private readonly input: MemorySourceInput) {
    this.defs = new Map(input.definitions.map((d) => [d.key, d]));
    this.facts = input.facts ?? [];
    this.ledgerRows = input.ledger ?? [];
    this.ledgerDatasetKey =
      input.ledgerDatasetKey ??
      input.definitions.find((d) => d.kind === "ledger" && d.datasetKey)?.datasetKey ??
      "fx_bokforing";
    this.currentOrder = new Map([...input.current].map((id, i) => [id, i]));
    this.resolveCurrentSlices();
  }

  // ---- MetricDataSource ----------------------------------------------------

  async definitions(): Promise<MetricDefinition[]> {
    return this.input.definitions;
  }

  async accountGroups(): Promise<AccountGroup[]> {
    return this.input.accountGroups ?? [];
  }

  async monthly(metricKeys: string[], scope: SourceScope): Promise<MonthlyRow[]> {
    const keys = new Set(metricKeys);
    const sums = new Map<string, MonthlyRow>();
    for (const f of this.facts) {
      if (!keys.has(f.metricKey) || !this.factInScope(f, scope)) continue;
      const group = this.factGroup(f, scope.groupBy);
      const id = `${f.metricKey}|${f.month}|${JSON.stringify(group)}`;
      const row = sums.get(id);
      if (row) row.value += f.value;
      else sums.set(id, { metricKey: f.metricKey, month: f.month, group, value: f.value });
    }
    return [...sums.values()].sort(
      (a, b) =>
        a.metricKey.localeCompare(b.metricKey) ||
        compareMonths(a.month, b.month) ||
        JSON.stringify(a.group).localeCompare(JSON.stringify(b.group)),
    );
  }

  async distinct(
    baseMetricKey: string,
    distinctDimension: string,
    scope: SourceScope,
    perMonth: boolean,
  ): Promise<(DistinctRow & { month: string | null })[]> {
    const sets = new Map<string, { month: string | null; group: Group; values: Set<number> }>();
    for (const f of this.facts) {
      if (f.metricKey !== baseMetricKey || !(f.value > 0)) continue;
      const value = f.dims[distinctDimension];
      if (value === undefined || !this.factInScope(f, scope)) continue;
      const month = perMonth ? f.month : null;
      const group = this.factGroup(f, scope.groupBy);
      const id = `${month}|${JSON.stringify(group)}`;
      let entry = sets.get(id);
      if (!entry) {
        entry = { month, group, values: new Set() };
        sets.set(id, entry);
      }
      entry.values.add(value);
    }
    return [...sets.values()]
      .map((e) => ({ month: e.month, group: e.group, count: e.values.size }))
      .sort(
        (a, b) =>
          (a.month ?? "").localeCompare(b.month ?? "") ||
          JSON.stringify(a.group).localeCompare(JSON.stringify(b.group)),
      );
  }

  async ledger(accountGroupKeys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    if (accountGroupKeys.length === 0 || scope.companies.length === 0) return [];
    return scope.scenario === "budget"
      ? this.budgetLedger(accountGroupKeys, scope)
      : this.actualLedger(accountGroupKeys, scope);
  }

  async coverage(metricKeys: string[], scope: SourceScope): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const key of metricKeys) {
      const def = this.defs.get(key);
      if (!def || def.kind === "formula") {
        out[key] = [];
        continue;
      }
      if (def.kind === "ledger" && scope.scenario === "budget") {
        const budgetDataset = this.defs.get(BUDGET_METRIC_KEY)?.datasetKey;
        out[key] = budgetDataset ? this.coveredMonths(budgetDataset, scope, "budget") : [];
        continue;
      }
      out[key] = def.datasetKey ? this.coveredMonths(def.datasetKey, scope, scope.scenario) : [];
    }
    return out;
  }

  async labels(dimension: string, ids: number[]): Promise<Record<number, string>> {
    const out: Record<number, string> = {};
    if (dimension === COMPANY_GROUP) return out;
    const known = this.input.labels?.[dimension] ?? {};
    for (const id of ids) {
      const label = known[id];
      if (label !== undefined) out[id] = label;
    }
    return out;
  }

  async lastUpdated(
    metricKeys: string[],
    scope: SourceScope,
  ): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const key of metricKeys) {
      let newest: string | null = null;
      for (const datasetKey of this.leafDatasets(key, scope.scenario, new Set())) {
        for (const [sliceKey, winner] of this.winners) {
          const [dataset, company, , month] = sliceKey.split("|") as [
            string,
            string,
            string,
            string,
          ];
          if (dataset !== datasetKey) continue;
          if (!scope.companies.includes(company as CompanyCode)) continue;
          if (!inRange(month, scope)) continue;
          const at = this.input.uploadTimes?.[winner.uploadId];
          if (at && (newest === null || Date.parse(at) > Date.parse(newest))) newest = at;
        }
      }
      out[key] = newest;
    }
    return out;
  }

  async fiscalStartMonth(): Promise<number> {
    return this.input.fiscalStartMonth ?? 1;
  }

  // ---- slices --------------------------------------------------------------

  private scenarioOf(uploadId: string): Scenario {
    return this.input.scenarios?.[uploadId] ?? "utfall";
  }

  private resolveCurrentSlices(): void {
    const consider = (
      uploadId: string,
      datasetKey: string,
      company: string,
      month: string,
      priority: number,
    ): void => {
      const order = this.currentOrder.get(uploadId);
      if (order === undefined) return;
      const key = sliceKey(datasetKey, company, this.scenarioOf(uploadId), month);
      const time = Date.parse(this.input.uploadTimes?.[uploadId] ?? "");
      const candidate: Candidate = {
        uploadId,
        priority,
        order,
        time: Number.isNaN(time) ? -Infinity : time,
      };
      const best = this.winners.get(key);
      if (!best) {
        this.winners.set(key, candidate);
      } else if (best.uploadId === uploadId) {
        best.priority = Math.max(best.priority, priority);
      } else if (beats(candidate, best)) {
        this.winners.set(key, candidate);
      }
    };

    for (const f of this.facts) {
      const datasetKey = this.defs.get(f.metricKey)?.datasetKey;
      if (!datasetKey) {
        throw new Error(`MemoryMetricDataSource: fakta för okänt mått ${f.metricKey}.`);
      }
      consider(f.uploadId, datasetKey, f.company, f.month, 0);
    }
    for (const r of this.ledgerRows) {
      consider(
        r.uploadId,
        this.ledgerDatasetKey,
        r.company,
        r.month,
        (r.yearOffset ?? 0) < 0 ? -1 : 0,
      );
    }
    for (const s of this.input.slices ?? []) {
      consider(s.uploadId, s.datasetKey, s.company, s.month, s.priority ?? 0);
    }
  }

  private isCurrent(uploadId: string, datasetKey: string, company: string, month: string) {
    const key = sliceKey(datasetKey, company, this.scenarioOf(uploadId), month);
    return this.winners.get(key)?.uploadId === uploadId;
  }

  private coveredMonths(datasetKey: string, scope: SourceScope, scenario: Scenario): string[] {
    const months = new Set<string>();
    for (const key of this.winners.keys()) {
      const [dataset, company, sc, month] = key.split("|") as [string, string, string, string];
      if (dataset !== datasetKey || sc !== scenario) continue;
      if (!scope.companies.includes(company as CompanyCode) || !inRange(month, scope)) continue;
      months.add(month);
    }
    return [...months].sort(compareMonths);
  }

  // ---- facts ---------------------------------------------------------------

  private factInScope(f: MemoryFact, scope: SourceScope): boolean {
    const datasetKey = this.defs.get(f.metricKey)?.datasetKey;
    return (
      datasetKey !== null &&
      datasetKey !== undefined &&
      this.scenarioOf(f.uploadId) === scope.scenario &&
      scope.companies.includes(f.company) &&
      inRange(f.month, scope) &&
      passesFilters(f.dims, scope.filters) &&
      this.isCurrent(f.uploadId, datasetKey, f.company, f.month)
    );
  }

  private factGroup(f: MemoryFact, groupBy: string[]): Group {
    const group: Group = {};
    for (const k of groupBy) group[k] = k === COMPANY_GROUP ? f.company : (f.dims[k] ?? null);
    return group;
  }

  // ---- ledger --------------------------------------------------------------

  /**
   * Like ledger_monthly: account totals (dimNo null) unless grouping by kostnadsställe,
   * then dimension-1 object rows plus an "ofördelat" remainder (total − Σ objects,
   * group value null) so a month's rows still add up to the total. Only a
   * kostnadsställe filter can be honoured (as the adapter does); any other filter
   * yields no rows rather than an unfiltered total.
   */
  private actualLedger(keys: string[], scope: SourceScope): LedgerMonthlyRow[] {
    if (scope.filters.some((f) => f.dimension !== KOSTNADSSTALLE)) return [];
    const byObject = scope.groupBy.includes(KOSTNADSSTALLE) || scope.filters.length > 0;
    const groups = new Map((this.input.accountGroups ?? []).map((g) => [g.key, g]));

    interface Part {
      key: string;
      company: CompanyCode;
      month: string;
      objectValueId: number | null;
      amount: number;
    }
    const totals = new Map<string, Part>();
    const objects = new Map<string, Part>();

    for (const r of this.ledgerRows) {
      if (!scope.companies.includes(r.company) || !inRange(r.month, scope)) continue;
      if (r.dimNo !== null && !(byObject && r.dimNo === 1)) continue;
      if (this.scenarioOf(r.uploadId) !== "utfall") continue;
      if (!this.isCurrent(r.uploadId, this.ledgerDatasetKey, r.company, r.month)) continue;
      for (const key of keys) {
        const group = groups.get(key);
        if (!group || !group.ranges.some((rg) => r.account >= rg.from && r.account <= rg.to)) {
          continue;
        }
        const amount = r.amount * group.sign;
        const isTotal = r.dimNo === null;
        const objectValueId = isTotal ? null : r.objectValueId;
        const id = `${key}|${r.company}|${r.month}|${isTotal ? "T" : objectValueId}`;
        const target = isTotal ? totals : objects;
        const part = target.get(id);
        if (part) part.amount += amount;
        else target.set(id, { key, company: r.company, month: r.month, objectValueId, amount });
      }
    }

    let parts: Part[];
    if (!byObject) {
      parts = [...totals.values()];
    } else {
      parts = [...objects.values()];
      const objectSums = new Map<string, number>();
      for (const p of objects.values()) {
        const id = `${p.key}|${p.company}|${p.month}`;
        objectSums.set(id, (objectSums.get(id) ?? 0) + p.amount);
      }
      const remainders = new Map<string, Part>();
      for (const t of totals.values()) {
        remainders.set(`${t.key}|${t.company}|${t.month}`, { ...t, objectValueId: null });
      }
      for (const [id, sum] of objectSums) {
        const r = remainders.get(id);
        if (r) r.amount -= sum;
        else {
          const [key, company, month] = id.split("|") as [string, CompanyCode, string];
          remainders.set(id, { key, company, month, objectValueId: null, amount: -sum });
        }
      }
      // Numeric in Postgres is exact; ignore float noise so no phantom "ofördelat" row appears.
      for (const r of remainders.values()) if (Math.abs(r.amount) > 1e-9) parts.push(r);
    }

    if (scope.filters.length > 0) {
      parts = parts.filter((p) =>
        passesFilters(
          p.objectValueId === null ? {} : { [KOSTNADSSTALLE]: p.objectValueId },
          scope.filters,
        ),
      );
    }

    const sums = new Map<string, LedgerMonthlyRow>();
    for (const p of parts) {
      const group: Group = {};
      for (const k of scope.groupBy) {
        group[k] = k === COMPANY_GROUP ? p.company : k === KOSTNADSSTALLE ? p.objectValueId : null;
      }
      const id = `${p.key}|${p.month}|${JSON.stringify(group)}`;
      const row = sums.get(id);
      if (row) row.value += p.amount;
      else sums.set(id, { accountGroupKey: p.key, month: p.month, group, value: p.amount });
    }
    return [...sums.values()].sort(
      (a, b) =>
        a.accountGroupKey.localeCompare(b.accountGroupKey) ||
        compareMonths(a.month, b.month) ||
        JSON.stringify(a.group).localeCompare(JSON.stringify(b.group)),
    );
  }

  /**
   * Ledger budget: budget_belopp facts (scenario budget) grouped by kontogrupp, whose
   * value codes are account group keys. Budget amounts are already in presentation
   * sign, so no account-group sign is applied.
   */
  private async budgetLedger(keys: string[], scope: SourceScope): Promise<LedgerMonthlyRow[]> {
    const codes = this.input.codes?.[KONTOGRUPP] ?? this.input.labels?.[KONTOGRUPP] ?? {};
    const ids = Object.entries(codes)
      .filter(([, code]) => keys.includes(code))
      .map(([id]) => Number(id));
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
    const sums = new Map<string, LedgerMonthlyRow>();
    for (const r of rows) {
      const id = r.group[KONTOGRUPP];
      const code = typeof id === "number" ? codes[id] : undefined;
      if (code === undefined || !keys.includes(code)) continue;
      const group: Group = {};
      for (const k of scope.groupBy) group[k] = r.group[k] ?? null;
      const sumId = `${code}|${r.month}|${JSON.stringify(group)}`;
      const row = sums.get(sumId);
      if (row) row.value += r.value;
      else sums.set(sumId, { accountGroupKey: code, month: r.month, group, value: r.value });
    }
    return [...sums.values()];
  }

  // ---- lineage -------------------------------------------------------------

  /** Datasets whose uploads stand behind a metric (formula operands recursively). */
  private leafDatasets(key: string, scenario: Scenario, seen: Set<string>): string[] {
    const def = this.defs.get(key);
    if (!def || seen.has(key)) return [];
    seen.add(key);
    if (def.kind === "formula") {
      let operands: string[];
      try {
        operands = referencedKeys(parseFormula(def.formula ?? ""));
      } catch {
        return [];
      }
      return operands.flatMap((k) => this.leafDatasets(k, scenario, seen));
    }
    if (def.kind === "ledger" && scenario === "budget") {
      const budgetDataset = this.defs.get(BUDGET_METRIC_KEY)?.datasetKey;
      return budgetDataset ? [budgetDataset] : [];
    }
    return def.datasetKey ? [def.datasetKey] : [];
  }
}

function sliceKey(datasetKey: string, company: string, scenario: Scenario, month: string) {
  return `${datasetKey}|${company}|${scenario}|${month}`;
}

function beats(a: Candidate, b: Candidate): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (a.time !== b.time) return a.time > b.time;
  return a.order > b.order;
}

function inRange(month: string, scope: SourceScope): boolean {
  return compareMonths(month, scope.from) >= 0 && compareMonths(month, scope.to) <= 0;
}

function passesFilters(dims: Record<string, number>, filters: DimFilter[]): boolean {
  return filters.every((f) => {
    const v = dims[f.dimension];
    return v !== undefined && f.valueIds.includes(v);
  });
}
