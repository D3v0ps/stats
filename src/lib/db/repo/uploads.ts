// Upload lifecycle: create a staged upload, stage facts/ledger rows in chunks, review,
// publish, retract, discard and list history. Only aggregated facts are sent.
import { dateToMonth, monthToDate } from "@/lib/core/month";
import {
  CompanyCodeSchema,
  ScenarioSchema,
  type CompanyCode,
  type Scenario,
} from "@/lib/contracts/domain";
import {
  UploadCreateSchema,
  type FactRow,
  type LedgerAccount,
  type LedgerObject,
  type LedgerRow,
  type UploadCreate,
} from "@/lib/contracts/import-payload";
import type { Json, TablesInsert } from "../types";
import { ensureDimensionValues } from "./catalog";
import {
  STAGE_CHUNK_SIZE,
  check,
  chunk,
  cleanLabel,
  fetchAll,
  isJsonObject,
  toNumber,
  unwrap,
  type DbClient,
} from "./shared";

export type UploadStatus = "staged" | "published" | "retracted" | "discarded";

/** SIE dimension number of kostnadsställe objects; the only object dimension stored. */
export const KOSTNADSSTALLE_DIM_NO = 1;

interface Lookups {
  datasetId: (key: string) => number;
  companyId: (code: CompanyCode) => number;
  metricId: (key: string) => number;
}

async function loadLookups(db: DbClient): Promise<Lookups> {
  const [datasets, companies, metrics] = await Promise.all([
    db.from("datasets").select("id, key"),
    db.from("companies").select("id, code"),
    db.from("metrics").select("id, key"),
  ]);
  const ds = new Map(unwrap("datasets", datasets).map((r) => [r.key, r.id]));
  const co = new Map(unwrap("companies", companies).map((r) => [r.code, r.id]));
  const me = new Map(unwrap("metrics", metrics).map((r) => [r.key, r.id]));
  const get = <K>(map: Map<K, number>, key: K, unknown: string) => {
    const id = map.get(key);
    if (id === undefined) throw new Error(`${unknown}: ${String(key)}`);
    return id;
  };
  return {
    datasetId: (key) => get(ds, key, "Okänd datakälla"),
    companyId: (code) => get(co, code, "Okänt bolag"),
    metricId: (key) => get(me, key, "Okänt mått"),
  };
}

/**
 * Scoped label of a kostnadsställe object, e.g. "MBAB:100", sent to
 * ensure_dimension_values (which derives dimension_values.code from it). Whitespace is
 * cleaned like private.clean_label, so it equals the label a new value is created with.
 */
export function kostnadsstalleCode(company: CompanyCode, objectCode: string): string {
  return `${company}:${cleanLabel(objectCode)}`;
}

// ---- Pure mapping ----------------------------------------------------------

export function toFactInserts(
  uploadId: string,
  facts: FactRow[],
  lookups: Pick<Lookups, "metricId" | "companyId">,
): TablesInsert<"metric_values">[] {
  return facts.map((f) => {
    if (!Number.isFinite(f.value)) throw new Error(`Ogiltigt värde för ${f.metricKey} ${f.month}`);
    return {
      upload_id: uploadId,
      metric_id: lookups.metricId(f.metricKey),
      company_id: lookups.companyId(f.company),
      month: monthToDate(f.month),
      dims: f.dims,
      value: f.value,
      source_rows: f.sourceRows.length > 0 ? f.sourceRows : null,
    };
  });
}

export function toLedgerInserts(
  uploadId: string,
  rows: LedgerRow[],
  companyId: (code: CompanyCode) => number,
  objectId: (company: CompanyCode, code: string) => number,
): { inserts: TablesInsert<"ledger_balances">[]; skippedObjectRows: number } {
  const inserts: TablesInsert<"ledger_balances">[] = [];
  let skippedObjectRows = 0;
  for (const r of rows) {
    if (r.dimNo !== null && r.dimNo !== KOSTNADSSTALLE_DIM_NO) {
      skippedObjectRows++;
      continue;
    }
    if (r.dimNo !== null && (r.objectCode === null || r.objectCode.trim() === "")) {
      throw new Error(`Objektrad utan objektkod (konto ${r.account}, ${r.month})`);
    }
    inserts.push({
      upload_id: uploadId,
      company_id: companyId(r.company),
      month: monthToDate(r.month),
      account: r.account,
      dim_no: r.dimNo,
      object_value_id: r.dimNo === null ? null : objectId(r.company, r.objectCode!),
      amount: r.amount,
      year_offset: r.yearOffset,
      source: r.source,
    });
  }
  return { inserts, skippedObjectRows };
}

export interface PublishSummary {
  uploadId: string;
  dataset: string;
  slices: number;
  /** Slices that became current. */
  current: number;
  /** Slices that stayed with a higher-priority upload. */
  kept: number;
  superseded: string[];
  facts: number;
  ledgerRows: number;
}

export function toPublishSummary(json: Json): PublishSummary {
  if (!isJsonObject(json)) throw new Error("Oväntat svar från publish_upload");
  return {
    uploadId: String(json.upload_id),
    dataset: String(json.dataset),
    slices: toNumber(json.slices),
    current: toNumber(json.current),
    kept: toNumber(json.kept),
    superseded: Array.isArray(json.superseded) ? json.superseded.map(String) : [],
    facts: toNumber(json.facts),
    ledgerRows: toNumber(json.ledger_rows),
  };
}

export interface ReviewRow {
  metricKey: string;
  company: CompanyCode;
  month: string;
  staged: number;
  /** Current published total for the same slice; null = no current data. */
  current: number | null;
  /** Previous month (inside this upload when covered, else current data). */
  previous: number | null;
  changePct: number | null;
  deviationPct: number | null;
  /** |deviationPct| >= the deviation threshold setting. */
  flagged: boolean;
  /** False for low-priority slices (previous-year SIE rows) that will not replace current data. */
  replacesCurrent: boolean;
}

export interface ReviewComparison {
  uploadId: string;
  dataset: string;
  scenario: Scenario;
  thresholdPct: number;
  rows: ReviewRow[];
}

const numOrNull = (v: Json | undefined) => (v === null || v === undefined ? null : toNumber(v));

export function toReviewComparison(json: Json): ReviewComparison {
  if (!isJsonObject(json) || !Array.isArray(json.rows)) {
    throw new Error("Oväntat svar från review_compare");
  }
  return {
    uploadId: String(json.upload_id),
    dataset: String(json.dataset),
    scenario: ScenarioSchema.parse(json.scenario),
    thresholdPct: toNumber(json.threshold_pct),
    rows: json.rows.filter(isJsonObject).map((r) => ({
      metricKey: String(r.metric_key),
      company: CompanyCodeSchema.parse(r.company),
      month: String(r.month),
      staged: toNumber(r.staged),
      current: numOrNull(r.current),
      previous: numOrNull(r.previous),
      changePct: numOrNull(r.change_pct),
      deviationPct: numOrNull(r.deviation_pct),
      flagged: r.flagged === true,
      replacesCurrent: r.replaces_current !== false,
    })),
  };
}

// ---- Staging ---------------------------------------------------------------

/** Copies of the entries of an array field without the given keys. */
function withoutKey(list: Json | undefined, key: string): Json | undefined {
  if (!Array.isArray(list)) return list;
  return list.map((entry) => {
    if (!isJsonObject(entry)) return entry;
    const rest = { ...entry };
    delete rest[key];
    return rest;
  });
}

/**
 * The parse report as stored server-side. Raw cell text can be personal data (a sum row
 * "Summa Anna Andersson", a filtered value), so issue values and skipped-row details
 * are dropped; row numbers, columns, reasons and messages are kept.
 */
export function sanitizeParseReport(report: unknown): Json {
  if (typeof report !== "object" || report === null || Array.isArray(report)) return {};
  const copy = JSON.parse(JSON.stringify(report)) as { [key: string]: Json | undefined };
  if (Array.isArray(copy.issues)) copy.issues = withoutKey(copy.issues, "value");
  if (Array.isArray(copy.skipped)) copy.skipped = withoutKey(copy.skipped, "detail");
  return copy;
}

/** One slice per company and month; a duplicate keeps the highest priority. */
export function uniqueSlices<T extends { company: CompanyCode; month: string; priority: number }>(
  slices: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const s of slices) {
    const key = `${s.company}|${s.month}`;
    const prev = byKey.get(key);
    if (!prev || s.priority > prev.priority) byKey.set(key, s);
  }
  return [...byKey.values()];
}

/** Insert a staged upload with its month slices. Returns the upload id. */
export async function createUpload(db: DbClient, input: UploadCreate): Promise<string> {
  const upload = UploadCreateSchema.parse(input);
  const lookups = await loadLookups(db);
  const datasetId = lookups.datasetId(upload.datasetKey);
  const created = unwrap(
    "uploads.insert",
    await db
      .from("uploads")
      .insert({
        dataset_id: datasetId,
        template_id: upload.templateId,
        template_version: upload.templateVersion,
        scenario: upload.scenario,
        file_name: upload.fileName,
        file_sha256: upload.fileSha256,
        file_size: upload.fileSize,
        content_hash: upload.contentHash,
        engine_version: upload.engineVersion,
        as_of_date: upload.asOfDate,
        parse_report: sanitizeParseReport(upload.parseReport),
        totals: (upload.totals ?? []) as Json,
      })
      .select("id")
      .single(),
  );
  const slices: TablesInsert<"upload_slices">[] = uniqueSlices(upload.slices).map((s) => ({
    upload_id: created.id,
    dataset_id: datasetId,
    company_id: lookups.companyId(s.company),
    scenario: upload.scenario,
    month: monthToDate(s.month),
    priority: s.priority,
  }));
  const res = await db.from("upload_slices").insert(slices);
  if (res.error) {
    await discardUpload(db, created.id).catch(() => undefined);
    check("upload_slices.insert", res);
  }
  return created.id;
}

export interface StageProgress {
  done: number;
  total: number;
}

/** Insert facts (dims already resolved to ids) in chunks. Returns the number staged. */
export async function stageFacts(
  db: DbClient,
  uploadId: string,
  facts: FactRow[],
  opts: { chunkSize?: number; onProgress?: (p: StageProgress) => void } = {},
): Promise<number> {
  if (facts.length === 0) return 0;
  const lookups = await loadLookups(db);
  const rows = toFactInserts(uploadId, facts, lookups);
  let done = 0;
  for (const part of chunk(rows, opts.chunkSize ?? STAGE_CHUNK_SIZE)) {
    check("metric_values.insert", await db.from("metric_values").insert(part));
    done += part.length;
    opts.onProgress?.({ done, total: rows.length });
  }
  return done;
}

export interface LedgerStageInput {
  rows: LedgerRow[];
  accounts: LedgerAccount[];
  objects: LedgerObject[];
}

export interface LedgerStageResult {
  rows: number;
  /** Object rows of other SIE dimensions than kostnadsställe (not stored). */
  skippedObjectRows: number;
  accounts: number;
  objects: number;
}

/**
 * Stage SIE ledger rows: kostnadsställe objects become dimension values with scoped
 * codes ("MBAB:100") via ensure_dimension_values, account names are upserted and the
 * balances inserted in chunks.
 */
export async function stageLedger(
  db: DbClient,
  uploadId: string,
  ledger: LedgerStageInput,
  opts: { chunkSize?: number; onProgress?: (p: StageProgress) => void } = {},
): Promise<LedgerStageResult> {
  const lookups = await loadLookups(db);

  const names = new Map<string, string>();
  for (const o of ledger.objects) {
    if (o.dimNo === KOSTNADSSTALLE_DIM_NO)
      names.set(kostnadsstalleCode(o.company, o.code), cleanLabel(o.name));
  }
  const codes = new Set(names.keys());
  for (const r of ledger.rows) {
    if (r.dimNo === KOSTNADSSTALLE_DIM_NO && r.objectCode)
      codes.add(kostnadsstalleCode(r.company, r.objectCode));
  }

  const ids = codes.size > 0 ? await ensureDimensionValues(db, "kostnadsstalle", [...codes]) : {};
  await nameNewObjects(db, ids, names);

  // One row per account: a repeated account in one upsert statement is an error.
  const byAccount = new Map<string, TablesInsert<"ledger_accounts">>();
  for (const a of ledger.accounts) {
    const companyId = lookups.companyId(a.company);
    byAccount.set(`${companyId}:${a.account}`, {
      company_id: companyId,
      account: a.account,
      name: a.name.trim(),
    });
  }
  const accounts = [...byAccount.values()];
  for (const part of chunk(accounts, STAGE_CHUNK_SIZE)) {
    check(
      "ledger_accounts.upsert",
      await db.from("ledger_accounts").upsert(part, { onConflict: "company_id,account" }),
    );
  }

  const { inserts, skippedObjectRows } = toLedgerInserts(
    uploadId,
    ledger.rows,
    lookups.companyId,
    (company, code) => {
      const id = ids[kostnadsstalleCode(company, code)];
      if (id === undefined || id === null)
        throw new Error(`Kostnadsställe saknas: ${company}:${code}`);
      return id;
    },
  );
  let done = 0;
  for (const part of chunk(inserts, opts.chunkSize ?? STAGE_CHUNK_SIZE)) {
    check("ledger_balances.insert", await db.from("ledger_balances").insert(part));
    done += part.length;
    opts.onProgress?.({ done, total: inserts.length });
  }
  return { rows: done, skippedObjectRows, accounts: accounts.length, objects: codes.size };
}

/**
 * New kostnadsställe values are created with their scoped label ("MBAB:100") as label;
 * give them the SIE object name ("100 Stockholm"). Values whose label is anything else
 * (renamed by the user, or matched through an alias) are left alone. Matching is by
 * label, not code: the code is normalized (lowercased), the label keeps the SIE case.
 */
async function nameNewObjects(
  db: DbClient,
  ids: Record<string, number | null>,
  names: Map<string, string>,
): Promise<void> {
  const wanted = new Map<number, { scoped: string; name: string }>();
  for (const [scoped, name] of names) {
    const id = ids[scoped];
    if (id !== undefined && id !== null && name !== "") wanted.set(id, { scoped, name });
  }
  if (wanted.size === 0) return;
  const current = await fetchAll("dimension_values", (from, to) =>
    db
      .from("dimension_values")
      .select("id, label")
      .in("id", [...wanted.keys()])
      .order("id")
      .range(from, to),
  );
  for (const v of current) {
    const w = wanted.get(v.id);
    if (!w || v.label !== w.scoped) continue;
    const objectCode = w.scoped.slice(w.scoped.indexOf(":") + 1);
    check(
      "dimension_values.update",
      await db
        .from("dimension_values")
        .update({ label: `${objectCode} ${w.name}` })
        .eq("id", v.id)
        .eq("label", v.label),
    );
  }
}

/**
 * Create the upload and stage everything; on failure the staged upload is discarded
 * so no half-staged upload is left behind.
 */
export async function stageUpload(
  db: DbClient,
  input: { upload: UploadCreate; facts?: FactRow[]; ledger?: LedgerStageInput },
  opts: { onProgress?: (p: StageProgress) => void } = {},
): Promise<string> {
  const uploadId = await createUpload(db, input.upload);
  try {
    if (input.facts?.length) await stageFacts(db, uploadId, input.facts, opts);
    if (input.ledger) await stageLedger(db, uploadId, input.ledger, opts);
  } catch (error) {
    await discardUpload(db, uploadId).catch(() => undefined);
    throw error;
  }
  return uploadId;
}

// ---- Lifecycle RPCs ---------------------------------------------------------

export async function reviewCompare(db: DbClient, uploadId: string): Promise<ReviewComparison> {
  return toReviewComparison(
    unwrap("review_compare", await db.rpc("review_compare", { p_upload_id: uploadId })),
  );
}

export async function publishUpload(db: DbClient, uploadId: string): Promise<PublishSummary> {
  return toPublishSummary(
    unwrap("publish_upload", await db.rpc("publish_upload", { p_upload_id: uploadId })),
  );
}

export interface RetractResult {
  released: number;
  restored: number;
  restoredFrom: string[];
}

export async function retractUpload(
  db: DbClient,
  uploadId: string,
  reason: string,
): Promise<RetractResult> {
  const r = unwrap(
    "retract_upload",
    await db.rpc("retract_upload", { p_upload_id: uploadId, p_reason: reason }),
  );
  if (!isJsonObject(r)) throw new Error("Oväntat svar från retract_upload");
  return {
    released: toNumber(r.released),
    restored: toNumber(r.restored),
    restoredFrom: Array.isArray(r.restored_from) ? r.restored_from.map(String) : [],
  };
}

export async function discardUpload(
  db: DbClient,
  uploadId: string,
): Promise<{ facts: number; ledgerRows: number }> {
  const r = unwrap("discard_upload", await db.rpc("discard_upload", { p_upload_id: uploadId }));
  if (!isJsonObject(r)) throw new Error("Oväntat svar från discard_upload");
  return { facts: toNumber(r.facts), ledgerRows: toNumber(r.ledger_rows) };
}

/**
 * Discard every staged upload older than the threshold (default 24 h, at least 1 h) that
 * was never published or discarded, the same way discardUpload does. Returns how many.
 */
export async function discardStaleUploads(db: DbClient, olderThanHours = 24): Promise<number> {
  if (!Number.isInteger(olderThanHours) || olderThanHours < 1) {
    throw new Error("Gränsen måste vara ett helt antal timmar, minst en.");
  }
  const r = unwrap(
    "discard_stale_uploads",
    await db.rpc("discard_stale_uploads", { p_older_than_hours: olderThanHours }),
  );
  return toNumber(r);
}

// ---- History ---------------------------------------------------------------

export interface UploadHistoryItem {
  id: string;
  datasetKey: string;
  fileName: string;
  scenario: Scenario;
  status: UploadStatus;
  templateId: string | null;
  templateVersion: number | null;
  createdAt: string;
  publishedAt: string | null;
  retractedAt: string | null;
  retractReason: string | null;
  companies: CompanyCode[];
  months: string[];
  /** Months this upload currently supplies. */
  currentMonths: string[];
}

const STATUSES: readonly string[] = ["staged", "published", "retracted", "discarded"];

export async function listUploads(
  db: DbClient,
  opts: { datasetKey?: string; status?: UploadStatus[]; ids?: string[]; limit?: number } = {},
): Promise<UploadHistoryItem[]> {
  const [datasetsRes, companiesRes] = await Promise.all([
    db.from("datasets").select("id, key"),
    db.from("companies").select("id, code"),
  ]);
  const datasets = unwrap("datasets", datasetsRes);
  const companyCode = new Map(unwrap("companies", companiesRes).map((c) => [c.id, c.code]));
  const datasetKey = new Map(datasets.map((d) => [d.id, d.key]));

  let q = db.from("uploads").select("*");
  if (opts.datasetKey) {
    const ds = datasets.find((d) => d.key === opts.datasetKey);
    if (!ds) return [];
    q = q.eq("dataset_id", ds.id);
  }
  if (opts.status?.length) q = q.in("status", opts.status);
  if (opts.ids) q = q.in("id", opts.ids);
  const uploads = unwrap(
    "uploads",
    await q
      .order("created_at", { ascending: false })
      .order("id")
      .limit(opts.limit ?? 100),
  );
  if (uploads.length === 0) return [];

  const slices = await fetchAll("upload_slices", (from, to) =>
    db
      .from("upload_slices")
      .select("upload_id, company_id, month, is_current")
      .in(
        "upload_id",
        uploads.map((u) => u.id),
      )
      .order("upload_id")
      .order("company_id")
      .order("month")
      .range(from, to),
  );

  return uploads.map((u) => {
    const own = slices.filter((s) => s.upload_id === u.id);
    const uniq = <T>(xs: T[]) => [...new Set(xs)];
    if (!STATUSES.includes(u.status)) throw new Error(`Okänd status: ${u.status}`);
    return {
      id: u.id,
      datasetKey: datasetKey.get(u.dataset_id) ?? String(u.dataset_id),
      fileName: u.file_name,
      scenario: ScenarioSchema.parse(u.scenario),
      status: u.status as UploadStatus,
      templateId: u.template_id,
      templateVersion: u.template_version,
      createdAt: u.created_at,
      publishedAt: u.published_at,
      retractedAt: u.retracted_at,
      retractReason: u.retract_reason,
      companies: uniq(own.map((s) => CompanyCodeSchema.parse(companyCode.get(s.company_id)))),
      months: uniq(own.map((s) => dateToMonth(s.month))).sort(),
      currentMonths: uniq(own.filter((s) => s.is_current).map((s) => dateToMonth(s.month))).sort(),
    };
  });
}

/** One upload's header, or null. */
export async function getUpload(db: DbClient, uploadId: string): Promise<UploadHistoryItem | null> {
  const [item] = await listUploads(db, { ids: [uploadId], limit: 1 });
  return item ?? null;
}
