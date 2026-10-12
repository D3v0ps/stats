// Helpers that stage and publish uploads the way the app does: as an allowlisted user,
// through the table policies and RPCs.
import { createHash } from "node:crypto";
import { asUser, type Db, type Tx } from "./harness";

export type Company = "MBAB" | "MBR";

export interface SliceInput {
  company: Company;
  month: string;
  priority?: number;
}

export interface FactInput {
  metric: string;
  company: Company;
  month: string;
  dims?: Record<string, number>;
  value: number;
}

export interface LedgerInput {
  company: Company;
  month: string;
  account: number;
  dimNo?: number | null;
  objectValueId?: number | null;
  amount: number;
  yearOffset?: number;
}

export interface StageInput {
  dataset: string;
  scenario?: "utfall" | "budget";
  /** Any string; hashed into a valid file_sha256. */
  file?: string;
  templateId?: string | null;
  templateVersion?: number | null;
  engineVersion?: number;
  slices: SliceInput[];
  facts?: FactInput[];
  ledger?: LedgerInput[];
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

let fileCounter = 0;

/** Insert an upload with its slices, facts and ledger rows inside an open transaction. */
export async function stageInTx(tx: Tx, input: StageInput): Promise<string> {
  const file = input.file ?? `file-${++fileCounter}-${Math.random()}`;
  const scenario = input.scenario ?? "utfall";
  const res = await tx.query<{ id: string }>(
    `insert into public.uploads (dataset_id, template_id, template_version, scenario, file_name,
       file_sha256, file_size, content_hash, engine_version)
     select d.id, $2, $3, $4, $5, $6, 100, $7, $8 from public.datasets d where d.key = $1
     returning id`,
    [
      input.dataset,
      input.templateId ?? null,
      input.templateVersion ?? null,
      scenario,
      `${file}.xlsx`,
      sha256(file),
      sha256(`content:${file}`),
      input.engineVersion ?? 1,
    ],
  );
  const uploadId = res.rows[0]?.id;
  if (!uploadId) throw new Error(`unknown dataset ${input.dataset}`);

  await tx.query(
    `insert into public.upload_slices (upload_id, dataset_id, company_id, scenario, month, priority)
     select u.id, u.dataset_id, c.id, u.scenario, (r.month || '-01')::date, coalesce(r.priority, 0)
     from jsonb_to_recordset($2::jsonb) as r(company text, month text, priority int)
     join public.companies c on c.code = r.company
     join public.uploads u on u.id = $1`,
    [uploadId, JSON.stringify(input.slices)],
  );

  if (input.facts?.length) {
    await tx.query(
      `insert into public.metric_values (upload_id, metric_id, company_id, month, dims, value)
       select $1, m.id, c.id, (r.month || '-01')::date, coalesce(r.dims, '{}'), r.value
       from jsonb_to_recordset($2::jsonb) as r(metric text, company text, month text, dims jsonb, value numeric)
       join public.metrics m on m.key = r.metric
       join public.companies c on c.code = r.company`,
      [uploadId, JSON.stringify(input.facts)],
    );
  }

  if (input.ledger?.length) {
    await tx.query(
      `insert into public.ledger_balances (upload_id, company_id, month, account, dim_no,
         object_value_id, amount, year_offset, source)
       select $1, c.id, (r.month || '-01')::date, r.account, r."dimNo", r."objectValueId",
         r.amount, coalesce(r."yearOffset", 0), 'psaldo'
       from jsonb_to_recordset($2::jsonb) as r(company text, month text, account int,
         "dimNo" smallint, "objectValueId" bigint, amount numeric, "yearOffset" smallint)
       join public.companies c on c.code = r.company`,
      [uploadId, JSON.stringify(input.ledger)],
    );
  }
  return uploadId;
}

export function stage(db: Db, userId: string, input: StageInput): Promise<string> {
  return asUser(db, userId, (tx) => stageInTx(tx, input));
}

export async function rpc<T = unknown>(
  db: Db,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asUser(db, userId, async (tx) => (await tx.query<T>(sql, params)).rows);
}

export async function publish(db: Db, userId: string, uploadId: string): Promise<PublishSummary> {
  const rows = await rpc<{ r: PublishSummary }>(db, userId, "select public.publish_upload($1) r", [
    uploadId,
  ]);
  return rows[0]!.r;
}

export async function stageAndPublish(db: Db, userId: string, input: StageInput) {
  const id = await stage(db, userId, input);
  const summary = await publish(db, userId, id);
  return { id, summary };
}

export interface PublishSummary {
  upload_id: string;
  dataset: string;
  slices: number;
  current: number;
  kept: number;
  superseded: string[];
  facts: number;
  ledger_rows: number;
}

/** dimension_values.id for a code (as the table owner). */
export async function valueId(db: Db, dimension: string, code: string): Promise<number> {
  const res = await db.query<{ id: number }>(
    `select dv.id::int as id from public.dimension_values dv
     join public.dimensions d on d.id = dv.dimension_id
     where d.key = $1 and dv.code = $2`,
    [dimension, code],
  );
  if (!res.rows[0]) throw new Error(`no value ${dimension}/${code}`);
  return res.rows[0].id;
}

/** Create (or find) a dimension value as the table owner. */
export async function ensureValue(
  db: Db,
  dimension: string,
  code: string,
  label = code,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `insert into public.dimension_values (dimension_id, code, label)
     select d.id, $2, $3 from public.dimensions d where d.key = $1
     on conflict (dimension_id, code) do update set label = excluded.label
     returning id::int as id`,
    [dimension, code, label],
  );
  return res.rows[0]!.id;
}

/** Current upload per (dataset, company, scenario, month) as "COMPANY:YYYY-MM" -> upload id. */
export async function currentSlices(db: Db, dataset: string): Promise<Record<string, string>> {
  const res = await db.query<{ k: string; upload_id: string }>(
    `select c.code || ':' || s.scenario || ':' || to_char(s.month, 'YYYY-MM') as k, s.upload_id
     from public.upload_slices s
     join public.datasets d on d.id = s.dataset_id
     join public.companies c on c.id = s.company_id
     where d.key = $1 and s.is_current
     order by 1`,
    [dataset],
  );
  return Object.fromEntries(res.rows.map((r) => [r.k, r.upload_id]));
}
