// Settings writes the other adapters do not cover: metric edits and new formula metrics,
// account groups and their ranges, the companies' fiscal year, bulk dictionary edits
// ("Fyll från Excel") and the months that hold current data.
import {
  CompanyCodeSchema,
  MetricKeySchema,
  ScenarioSchema,
  UnitSchema,
  type CompanyCode,
  type Scenario,
  type Unit,
} from "@/lib/contracts/domain";
import { dateToMonth } from "@/lib/core/month";
import type { TablesUpdate } from "../types";
import { listDimensions } from "./catalog";
import {
  check,
  chunk,
  cleanLabel,
  fetchAll,
  normKey,
  unwrap,
  unwrapMaybe,
  type DbClient,
} from "./shared";

/** Rows per bulk insert/upsert request for dictionary edits. */
const BULK_CHUNK = 500;
/** Concurrent single-row updates when relabelling values. */
const UPDATE_CONCURRENCY = 8;

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  return v === "" ? null : v;
}

function checkDecimals(decimals: number | null): void {
  if (decimals !== null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)) {
    throw new Error("Antalet decimaler måste vara 0–6.");
  }
}

// ---- Metrics -----------------------------------------------------------------

export interface MetricPatch {
  name?: string;
  description?: string | null;
  higherIsBetter?: boolean | null;
  decimals?: number | null;
  /** Stored uppercase ("FAKTORN"); blank clears it. */
  headlineSubject?: string | null;
  /** Formula metrics only. */
  formula?: string;
}

export function toMetricUpdate(patch: MetricPatch): TablesUpdate<"metrics"> {
  const update: TablesUpdate<"metrics"> = {};
  if (patch.name !== undefined) {
    const name = cleanLabel(patch.name);
    if (name === "") throw new Error("Måttet måste ha ett namn.");
    update.name = name;
  }
  if (patch.description !== undefined) update.description = blankToNull(patch.description);
  if (patch.higherIsBetter !== undefined) update.higher_is_better = patch.higherIsBetter;
  if (patch.decimals !== undefined) {
    checkDecimals(patch.decimals);
    update.decimals = patch.decimals;
  }
  if (patch.headlineSubject !== undefined) {
    update.headline_subject = blankToNull(patch.headlineSubject)?.toLocaleUpperCase("sv") ?? null;
  }
  if (patch.formula !== undefined) {
    const formula = patch.formula.trim();
    if (formula === "") throw new Error("Formeln är tom.");
    update.formula = formula;
  }
  return update;
}

/** Edit a metric's presentation (and formula, for formula metrics). The key never changes. */
export async function updateMetric(db: DbClient, key: string, patch: MetricPatch): Promise<void> {
  const update = toMetricUpdate(patch);
  if (Object.keys(update).length === 0) return;
  const current = unwrapMaybe(
    "metrics",
    await db.from("metrics").select("id, kind").eq("key", key).maybeSingle(),
  );
  if (!current) throw new Error(`Måttet finns inte: ${key}`);
  if (update.formula !== undefined && current.kind !== "formula") {
    throw new Error("Bara formelmått har en formel.");
  }
  check("metrics.update", await db.from("metrics").update(update).eq("id", current.id));
}

export interface NewFormulaMetric {
  key: string;
  name: string;
  unit: Unit;
  formula: string;
  higherIsBetter: boolean | null;
  decimals: number | null;
  description?: string | null;
  headlineSubject?: string | null;
}

/** Create a formula metric (kvot av summor), e.g. "Intäkt per konsult". Returns its id. */
export async function createFormulaMetric(db: DbClient, input: NewFormulaMetric): Promise<number> {
  const key = MetricKeySchema.parse(input.key);
  const unit = UnitSchema.parse(input.unit);
  const fields = toMetricUpdate({
    name: input.name,
    description: input.description ?? null,
    higherIsBetter: input.higherIsBetter,
    decimals: input.decimals,
    headlineSubject: input.headlineSubject ?? null,
    formula: input.formula,
  });
  const row = unwrap(
    "metrics.insert",
    await db
      .from("metrics")
      .insert({
        key,
        name: fields.name as string,
        unit,
        kind: "formula",
        dataset_id: null,
        formula: fields.formula as string,
        higher_is_better: fields.higher_is_better ?? null,
        decimals: fields.decimals ?? null,
        description: fields.description ?? null,
        headline_subject: fields.headline_subject ?? null,
        is_system: false,
      })
      .select("id")
      .single(),
  );
  return row.id;
}

// ---- Account groups --------------------------------------------------------------

export interface AccountGroupPatch {
  name?: string;
  sign?: 1 | -1;
}

/** Rename a group or flip its sign. Applies to all history (ledger sums are computed live). */
export async function updateAccountGroup(
  db: DbClient,
  key: string,
  patch: AccountGroupPatch,
): Promise<void> {
  const update: TablesUpdate<"account_groups"> = {};
  if (patch.name !== undefined) {
    const name = cleanLabel(patch.name);
    if (name === "") throw new Error("Kontogruppen måste ha ett namn.");
    update.name = name;
  }
  if (patch.sign !== undefined) {
    if (patch.sign !== 1 && patch.sign !== -1) throw new Error("Tecknet måste vara + eller −.");
    update.sign = patch.sign;
  }
  if (Object.keys(update).length === 0) return;
  const rows = unwrap(
    "account_groups.update",
    await db.from("account_groups").update(update).eq("key", key).select("key"),
  );
  if (rows.length === 0) throw new Error(`Kontogruppen finns inte: ${key}`);
}

export function validateAccountRanges(ranges: readonly { from: number; to: number }[]): void {
  if (ranges.length === 0) throw new Error("Kontogruppen måste ha minst ett kontointervall.");
  for (const r of ranges) {
    const valid = (n: number) => Number.isInteger(n) && n >= 1000 && n <= 9999;
    if (!valid(r.from) || !valid(r.to)) {
      throw new Error("Konton skrivs med fyra siffror (1000–9999).");
    }
    if (r.from > r.to) {
      throw new Error("Från-kontot måste vara lägre än eller lika med till-kontot.");
    }
  }
}

/**
 * Replace a group's account ranges. The new ranges are inserted before the old ones are
 * deleted, so a failure never leaves the group without ranges.
 */
export async function replaceAccountGroupRanges(
  db: DbClient,
  key: string,
  ranges: readonly { from: number; to: number }[],
): Promise<void> {
  validateAccountRanges(ranges);
  const group = unwrapMaybe(
    "account_groups",
    await db.from("account_groups").select("key").eq("key", key).maybeSingle(),
  );
  if (!group) throw new Error(`Kontogruppen finns inte: ${key}`);
  const old = unwrap(
    "account_group_ranges",
    await db.from("account_group_ranges").select("id").eq("group_key", key).order("id"),
  );
  check(
    "account_group_ranges.insert",
    await db
      .from("account_group_ranges")
      .insert(ranges.map((r) => ({ group_key: key, from_account: r.from, to_account: r.to }))),
  );
  if (old.length > 0) {
    check(
      "account_group_ranges.delete",
      await db
        .from("account_group_ranges")
        .delete()
        .in(
          "id",
          old.map((r) => r.id),
        ),
    );
  }
}

// ---- Companies --------------------------------------------------------------------

/** Set the first month of a company's fiscal year (1 = januari). */
export async function setCompanyFiscalStart(
  db: DbClient,
  company: CompanyCode,
  month: number,
): Promise<void> {
  const code = CompanyCodeSchema.parse(company);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Räkenskapsåret måste börja i en månad 1–12.");
  }
  const rows = unwrap(
    "companies.update",
    await db.from("companies").update({ fiscal_start_month: month }).eq("code", code).select("id"),
  );
  if (rows.length === 0) throw new Error(`Okänt bolag: ${code}`);
}

// ---- Periods ----------------------------------------------------------------------

export interface MonthWithData {
  company: CompanyCode;
  month: string;
  /** Dataset keys with current (published) data for the month, in dataset id order. */
  datasets: string[];
}

/** Months with current published data per company (utfall by default), newest first. */
export async function listMonthsWithData(
  db: DbClient,
  opts: { scenario?: Scenario } = {},
): Promise<MonthWithData[]> {
  const scenario = ScenarioSchema.parse(opts.scenario ?? "utfall");
  const [companies, datasets, slices] = await Promise.all([
    db.from("companies").select("id, code"),
    db.from("datasets").select("id, key"),
    // One current slice per dataset x company x scenario x month: a total order for paging.
    fetchAll("upload_slices", (from, to) =>
      db
        .from("upload_slices")
        .select("company_id, dataset_id, month")
        .eq("is_current", true)
        .eq("scenario", scenario)
        .order("month", { ascending: false })
        .order("company_id")
        .order("dataset_id")
        .range(from, to),
    ),
  ]);
  const codeById = new Map(unwrap("companies", companies).map((c) => [c.id, c.code]));
  const keyById = new Map(unwrap("datasets", datasets).map((d) => [d.id, d.key]));
  const out = new Map<string, MonthWithData>();
  for (const s of slices) {
    const company = CompanyCodeSchema.parse(codeById.get(s.company_id));
    const month = dateToMonth(s.month);
    const id = `${month}|${company}`;
    let entry = out.get(id);
    if (!entry) {
      entry = { company, month, datasets: [] };
      out.set(id, entry);
    }
    entry.datasets.push(keyById.get(s.dataset_id) ?? String(s.dataset_id));
  }
  return [...out.values()];
}

// ---- Import templates -------------------------------------------------------------

/** Number of uploads (any status) per template id; such templates cannot be deleted. */
export async function templateUploadCounts(db: DbClient): Promise<Record<string, number>> {
  const rows = await fetchAll("uploads", (from, to) =>
    db.from("uploads").select("id, template_id").order("id").range(from, to),
  );
  const out: Record<string, number> = {};
  for (const r of rows) if (r.template_id) out[r.template_id] = (out[r.template_id] ?? 0) + 1;
  return out;
}

// ---- Dictionary bulk edits -----------------------------------------------------------

async function dimensionId(db: DbClient, dimensionKey: string): Promise<number> {
  const dimension = (await listDimensions(db)).find((d) => d.key === dimensionKey);
  if (!dimension) throw new Error(`Okänd dimension: ${dimensionKey}`);
  return dimension.id;
}

/** Add (or repoint) many aliases at once. Later entries win for the same alias. */
export async function addAliases(
  db: DbClient,
  dimensionKey: string,
  entries: readonly { alias: string; valueId: number }[],
): Promise<number> {
  const dimId = await dimensionId(db, dimensionKey);
  const byAlias = new Map<string, number>();
  for (const e of entries) {
    const alias = normKey(e.alias);
    if (alias !== "") byAlias.set(alias, e.valueId);
  }
  const rows = [...byAlias].map(([alias, valueId]) => ({
    dimension_id: dimId,
    alias_norm: alias,
    value_id: valueId,
  }));
  for (const part of chunk(rows, BULK_CHUNK)) {
    check(
      "dimension_aliases.upsert",
      await db.from("dimension_aliases").upsert(part, { onConflict: "dimension_id,alias_norm" }),
    );
  }
  return rows.length;
}

/**
 * Create values with an explicit code (e.g. anställnings-id) and display name, so imports that
 * resolve the code find them. Not for kostnadsställe, whose codes are company-scoped.
 * Returns code -> id.
 */
export async function createDimensionValues(
  db: DbClient,
  dimensionKey: string,
  values: readonly { code: string; label: string }[],
): Promise<Record<string, number>> {
  if (dimensionKey === "kostnadsstalle") {
    throw new Error("Kostnadsställen skapas bara från bokföringen.");
  }
  const dimId = await dimensionId(db, dimensionKey);
  const byCode = new Map<string, string>();
  for (const v of values) {
    const code = normKey(v.code);
    const label = cleanLabel(v.label);
    if (code !== "" && label !== "") byCode.set(code, label);
  }
  const out: Record<string, number> = {};
  for (const part of chunk([...byCode], BULK_CHUNK)) {
    const rows = unwrap(
      "dimension_values.insert",
      await db
        .from("dimension_values")
        .insert(part.map(([code, label]) => ({ dimension_id: dimId, code, label })))
        .select("id, code"),
    );
    for (const r of rows) out[r.code] = r.id;
  }
  return out;
}

/** Give many values a new display name (codes and aliases stay, so imports still match). */
export async function relabelDimensionValues(
  db: DbClient,
  updates: readonly { id: number; label: string }[],
): Promise<number> {
  const clean = updates
    .map((u) => ({ id: u.id, label: cleanLabel(u.label) }))
    .filter((u) => u.label !== "");
  for (const part of chunk(clean, UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      part.map((u) => db.from("dimension_values").update({ label: u.label }).eq("id", u.id)),
    );
    for (const r of results) check("dimension_values.update", r);
  }
  return clean.length;
}
