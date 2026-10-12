// Catalog reads (companies, datasets, dimensions, metrics, account groups) and
// dimension value management (resolve, alias, rename, merge).
import {
  CompanyCodeSchema,
  DatasetKindSchema,
  MetricKindSchema,
  SnapshotRollupSchema,
  UnitSchema,
  type CompanyCode,
  type DatasetKind,
} from "@/lib/contracts/domain";
import type { AccountGroup, MetricDefinition } from "@/lib/contracts/metric-query";
import type { Tables } from "../types";
import { check, chunk, fetchAll, normKey, unwrap, type DbClient } from "./shared";

export type UnknownPolicy = "ask" | "auto_create";

export interface CompanyInfo {
  id: number;
  code: CompanyCode;
  legalName: string;
  shortName: string;
  orgNr: string;
  fiscalStartMonth: number;
}

export interface DatasetInfo {
  id: number;
  key: string;
  name: string;
  kind: DatasetKind;
  /** Dimension keys, in dimension id order. */
  dimensions: string[];
}

export interface DimensionInfo {
  id: number;
  key: string;
  label: string;
  personal: boolean;
  unknownPolicy: UnknownPolicy;
}

export interface DimensionValue {
  id: number;
  dimensionKey: string;
  code: string;
  label: string;
  sort: number;
  active: boolean;
}

export interface DimensionAlias {
  dimensionKey: string;
  aliasNorm: string;
  valueId: number;
}

/**
 * Lookup table for resolveDims (src/lib/ingest/resolve.ts): normalized label, code or
 * alias -> dimension_values.id, plus the dimension's policy. Same precedence as
 * ensure_dimension_values: alias, then code, then label (active values only).
 */
export interface DimensionDictionaryEntry {
  byNorm: Record<string, number>;
  policy: UnknownPolicy;
  personal: boolean;
  /** dimension_values.id -> label, for every value incl. inactive ones. */
  labels: Record<number, string>;
}

const UNKNOWN_POLICIES: readonly string[] = ["ask", "auto_create"];

function toPolicy(value: string): UnknownPolicy {
  if (!UNKNOWN_POLICIES.includes(value)) throw new Error(`Unknown policy: ${value}`);
  return value as UnknownPolicy;
}

// ---- Pure mapping ----------------------------------------------------------

export function toCompany(row: Tables<"companies">): CompanyInfo {
  return {
    id: row.id,
    code: CompanyCodeSchema.parse(row.code),
    legalName: row.legal_name,
    shortName: row.short_name,
    orgNr: row.org_nr,
    fiscalStartMonth: row.fiscal_start_month,
  };
}

export function toDimension(row: Tables<"dimensions">): DimensionInfo {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    personal: row.is_personal,
    unknownPolicy: toPolicy(row.unknown_policy),
  };
}

export function toDatasets(
  datasets: Tables<"datasets">[],
  dimensions: Pick<Tables<"dimensions">, "id" | "key">[],
  links: Tables<"dataset_dimensions">[],
): DatasetInfo[] {
  const dimById = new Map(dimensions.map((d) => [d.id, d]));
  return datasets.map((ds) => ({
    id: ds.id,
    key: ds.key,
    name: ds.name,
    kind: DatasetKindSchema.parse(ds.kind),
    dimensions: links
      .filter((l) => l.dataset_id === ds.id)
      .map((l) => dimById.get(l.dimension_id))
      .filter((d): d is Pick<Tables<"dimensions">, "id" | "key"> => d !== undefined)
      .sort((a, b) => a.id - b.id)
      .map((d) => d.key),
  }));
}

const IDENTIFIER = /[a-z][a-z0-9_]*/g;

/** Metric keys referenced by a formula, in order of first appearance. */
export function formulaOperands(formula: string, metricKeys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of formula.matchAll(IDENTIFIER)) {
    if (metricKeys.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/**
 * MetricDefinition[] from catalog rows. Dimensions come from the metric's dataset;
 * a formula metric gets the intersection of its operands' dimensions (recursively;
 * a reference cycle yields no dimensions).
 */
export function toMetricDefinitions(
  metrics: Tables<"metrics">[],
  datasets: DatasetInfo[],
  dimensions: Pick<Tables<"dimensions">, "id" | "key">[],
): MetricDefinition[] {
  const datasetById = new Map(datasets.map((d) => [d.id, d]));
  const dimensionById = new Map(dimensions.map((d) => [d.id, d.key]));
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const keys = new Set(byKey.keys());
  const memo = new Map<string, string[]>();

  const dimsOf = (key: string, visiting: Set<string>): string[] => {
    const cached = memo.get(key);
    if (cached) return cached;
    const metric = byKey.get(key);
    if (!metric) return [];
    let dims: string[];
    if (metric.kind === "formula") {
      if (visiting.has(key)) return [];
      visiting.add(key);
      const operands = formulaOperands(metric.formula ?? "", keys).map((k) => dimsOf(k, visiting));
      visiting.delete(key);
      dims =
        operands.length === 0 ? [] : operands.reduce((acc, d) => acc.filter((k) => d.includes(k)));
    } else {
      dims = (metric.dataset_id !== null && datasetById.get(metric.dataset_id)?.dimensions) || [];
    }
    memo.set(key, dims);
    return dims;
  };

  return metrics.map((m) => ({
    key: m.key,
    name: m.name,
    unit: UnitSchema.parse(m.unit),
    kind: MetricKindSchema.parse(m.kind),
    datasetKey: m.dataset_id === null ? null : (datasetById.get(m.dataset_id)?.key ?? null),
    higherIsBetter: m.higher_is_better,
    decimals: m.decimals,
    description: m.description,
    snapshotRollup:
      m.snapshot_rollup === null ? null : SnapshotRollupSchema.parse(m.snapshot_rollup),
    baseMetricKey:
      m.base_metric_id === null ? null : (metricById.get(m.base_metric_id)?.key ?? null),
    distinctDimension:
      m.distinct_dimension_id === null
        ? null
        : (dimensionById.get(m.distinct_dimension_id) ?? null),
    accountGroupKey: m.account_group_key,
    formula: m.formula,
    headlineSubject: m.headline_subject,
    dimensions: [...dimsOf(m.key, new Set())],
  }));
}

export function toAccountGroups(
  groups: Tables<"account_groups">[],
  ranges: Tables<"account_group_ranges">[],
): AccountGroup[] {
  return [...groups]
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    .map((g) => {
      if (g.sign !== 1 && g.sign !== -1) throw new Error(`Invalid sign for ${g.key}`);
      return {
        key: g.key,
        name: g.name,
        sign: g.sign,
        ranges: ranges
          .filter((r) => r.group_key === g.key)
          .sort((a, b) => a.id - b.id)
          .map((r) => ({ from: r.from_account, to: r.to_account })),
      };
    });
}

export function buildDimensionDictionary(
  dimensions: DimensionInfo[],
  values: DimensionValue[],
  aliases: DimensionAlias[],
): Record<string, DimensionDictionaryEntry> {
  const out: Record<string, DimensionDictionaryEntry> = {};
  for (const d of dimensions) {
    out[d.key] = { byNorm: {}, policy: d.unknownPolicy, personal: d.personal, labels: {} };
  }
  // Lowest precedence first: labels, then codes, then aliases overwrite.
  for (const v of values) {
    const entry = out[v.dimensionKey];
    if (!entry) continue;
    entry.labels[v.id] = v.label;
    if (v.active) entry.byNorm[normKey(v.label)] ??= v.id;
  }
  for (const v of values) {
    const entry = out[v.dimensionKey];
    if (entry && v.active) entry.byNorm[normKey(v.code)] = v.id;
  }
  for (const a of aliases) {
    const entry = out[a.dimensionKey];
    if (entry) entry.byNorm[normKey(a.aliasNorm)] = a.valueId;
  }
  return out;
}

// ---- Reads -----------------------------------------------------------------

export async function listCompanies(db: DbClient): Promise<CompanyInfo[]> {
  const rows = unwrap("companies", await db.from("companies").select("*").order("id"));
  return rows.map(toCompany);
}

export async function listDimensions(db: DbClient): Promise<DimensionInfo[]> {
  const rows = unwrap("dimensions", await db.from("dimensions").select("*").order("id"));
  return rows.map(toDimension);
}

export async function listDatasets(db: DbClient): Promise<DatasetInfo[]> {
  const [datasets, dimensions, links] = await Promise.all([
    db.from("datasets").select("*").order("id"),
    db.from("dimensions").select("id, key").order("id"),
    db.from("dataset_dimensions").select("*").order("dataset_id").order("dimension_id"),
  ]);
  return toDatasets(
    unwrap("datasets", datasets),
    unwrap("dimensions", dimensions),
    unwrap("dataset_dimensions", links),
  );
}

export async function listMetricDefinitions(db: DbClient): Promise<MetricDefinition[]> {
  const [metrics, datasets, dimensions] = await Promise.all([
    db.from("metrics").select("*").order("id"),
    listDatasets(db),
    db.from("dimensions").select("id, key").order("id"),
  ]);
  return toMetricDefinitions(
    unwrap("metrics", metrics),
    datasets,
    unwrap("dimensions", dimensions),
  );
}

export async function listAccountGroups(db: DbClient): Promise<AccountGroup[]> {
  const [groups, ranges] = await Promise.all([
    db.from("account_groups").select("*").order("sort"),
    db.from("account_group_ranges").select("*").order("id"),
  ]);
  return toAccountGroups(unwrap("account_groups", groups), unwrap("account_group_ranges", ranges));
}

/** Dimension values (all of them, paged), optionally for one dimension. */
export async function listDimensionValues(
  db: DbClient,
  opts: { dimensionKey?: string; includeInactive?: boolean } = {},
): Promise<DimensionValue[]> {
  const dimensions = await listDimensions(db);
  const keyById = new Map(dimensions.map((d) => [d.id, d.key]));
  const dimension = opts.dimensionKey ? dimensions.find((d) => d.key === opts.dimensionKey) : null;
  if (opts.dimensionKey && !dimension) return [];
  const rows = await fetchAll("dimension_values", (from, to) => {
    let q = db.from("dimension_values").select("*");
    if (dimension) q = q.eq("dimension_id", dimension.id);
    if (!opts.includeInactive) q = q.eq("active", true);
    return q.order("id").range(from, to);
  });
  return rows.map((r) => ({
    id: r.id,
    dimensionKey: keyById.get(r.dimension_id) ?? String(r.dimension_id),
    code: r.code,
    label: r.label,
    sort: r.sort,
    active: r.active,
  }));
}

export async function listAliases(db: DbClient, dimensionKey?: string): Promise<DimensionAlias[]> {
  const dimensions = await listDimensions(db);
  const keyById = new Map(dimensions.map((d) => [d.id, d.key]));
  const dimension = dimensionKey ? dimensions.find((d) => d.key === dimensionKey) : null;
  if (dimensionKey && !dimension) return [];
  const rows = await fetchAll("dimension_aliases", (from, to) => {
    let q = db.from("dimension_aliases").select("*");
    if (dimension) q = q.eq("dimension_id", dimension.id);
    return q.order("dimension_id").order("alias_norm").range(from, to);
  });
  return rows.map((r) => ({
    dimensionKey: keyById.get(r.dimension_id) ?? String(r.dimension_id),
    aliasNorm: r.alias_norm,
    valueId: r.value_id,
  }));
}

/** Dictionary for resolveDims, for all dimensions or the given ones. */
export async function loadDimensionDictionary(
  db: DbClient,
  dimensionKeys?: string[],
): Promise<Record<string, DimensionDictionaryEntry>> {
  const [dimensions, values, aliases] = await Promise.all([
    listDimensions(db),
    listDimensionValues(db, { includeInactive: true }),
    listAliases(db),
  ]);
  const wanted = dimensionKeys ? new Set(dimensionKeys) : null;
  return buildDimensionDictionary(
    wanted ? dimensions.filter((d) => wanted.has(d.key)) : dimensions,
    values,
    aliases,
  );
}

// ---- Dimension value management --------------------------------------------

/** Labels per request to ensure_dimension_values (keeps the result under max_rows). */
const ENSURE_CHUNK = 500;

/**
 * Resolve labels to dimension value ids via ensure_dimension_values. New values are
 * created for auto_create dimensions (or with force); unknown values of "ask"
 * dimensions map to null.
 */
export async function ensureDimensionValues(
  db: DbClient,
  dimensionKey: string,
  labels: string[],
  opts: { force?: boolean } = {},
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const part of chunk([...new Set(labels)], ENSURE_CHUNK)) {
    const rows = unwrap(
      "ensure_dimension_values",
      await db.rpc("ensure_dimension_values", {
        p_dimension: dimensionKey,
        p_labels: part,
        p_force: opts.force ?? false,
      }),
    );
    for (const r of rows) out[r.label] = r.id;
  }
  return out;
}

export async function addAlias(
  db: DbClient,
  dimensionKey: string,
  alias: string,
  valueId: number,
): Promise<void> {
  const dimension = (await listDimensions(db)).find((d) => d.key === dimensionKey);
  if (!dimension) throw new Error(`Unknown dimension: ${dimensionKey}`);
  check(
    "dimension_aliases.upsert",
    await db
      .from("dimension_aliases")
      .upsert(
        { dimension_id: dimension.id, alias_norm: normKey(alias), value_id: valueId },
        { onConflict: "dimension_id,alias_norm" },
      ),
  );
}

export async function deleteAlias(
  db: DbClient,
  dimensionKey: string,
  alias: string,
): Promise<void> {
  const dimension = (await listDimensions(db)).find((d) => d.key === dimensionKey);
  if (!dimension) throw new Error(`Unknown dimension: ${dimensionKey}`);
  check(
    "dimension_aliases.delete",
    await db
      .from("dimension_aliases")
      .delete()
      .eq("dimension_id", dimension.id)
      .eq("alias_norm", normKey(alias)),
  );
}

export async function updateDimensionValue(
  db: DbClient,
  id: number,
  patch: { label?: string; sort?: number; active?: boolean },
): Promise<void> {
  const update: { label?: string; sort?: number; active?: boolean } = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.sort !== undefined) update.sort = patch.sort;
  if (patch.active !== undefined) update.active = patch.active;
  check("dimension_values.update", await db.from("dimension_values").update(update).eq("id", id));
}

export interface MergeResult {
  from: number;
  into: number;
  facts: number;
  ledgerRows: number;
}

/** Merge one value into another (facts, ledger objects, aliases and saved filters move). */
export async function mergeDimensionValues(
  db: DbClient,
  fromId: number,
  intoId: number,
): Promise<MergeResult> {
  const r = unwrap(
    "merge_dimension_values",
    await db.rpc("merge_dimension_values", { p_from: fromId, p_into: intoId }),
  ) as { from: number; into: number; facts: number; ledger_rows: number };
  return { from: r.from, into: r.into, facts: r.facts, ledgerRows: r.ledger_rows };
}
