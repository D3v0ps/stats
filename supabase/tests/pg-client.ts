// A PostgREST-like client over PGlite, covering the subset of the supabase-js query
// builder the repo adapters use. Every call runs as one transaction under the given
// user's role and JWT (like a PostgREST request), and results are JSON-serialized by
// Postgres, so dates, numerics and jsonb arrive exactly as PostgREST sends them.
import type { DbClient } from "@/lib/db/repo/shared";
import { asUser, type Db, type Tx } from "./harness";

interface Filter {
  sql: string;
  value?: unknown;
}

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`unsupported identifier: ${name}`);
  return name;
}

function columnsOf(select: string | undefined): string {
  if (!select || select.trim() === "*") return "*";
  return select
    .split(",")
    .map((c) => ident(c.trim()))
    .join(", ");
}

let procCache: Promise<Map<string, { retset: boolean; args: Map<string, string> }>> | null = null;

async function procs(db: Db) {
  procCache ??= db
    .query<{ name: string; retset: boolean; names: string[] | null; types: string[] | null }>(
      `select p.proname as name, p.proretset as retset, p.proargnames as names,
         (select array_agg(t.typname order by i) from generate_series(0, p.pronargs - 1) i
            join pg_type t on t.oid = p.proargtypes[i]) as types
       from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    )
    .then(
      (res) =>
        new Map(
          res.rows.map((r) => [
            r.name,
            {
              retset: r.retset,
              args: new Map((r.names ?? []).map((n, i) => [n, r.types?.[i] ?? "text"])),
            },
          ]),
        ),
    );
  return procCache;
}

class PgQuery implements PromiseLike<Result> {
  private kind: "select" | "insert" | "upsert" | "update" | "delete" | "rpc" = "select";
  private columns = "*";
  private payload: unknown;
  private onConflict: string | undefined;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private rangeValue: [number, number] | undefined;
  private limitValue: number | undefined;
  private singleMode: "single" | "maybe" | null = null;
  private returning = false;

  constructor(
    private readonly db: Db,
    private readonly userId: string,
    private readonly target: string,
    rpcArgs?: Record<string, unknown>,
  ) {
    if (rpcArgs) {
      this.kind = "rpc";
      this.payload = rpcArgs;
    }
  }

  select(columns?: string): this {
    if (this.kind === "select") this.columns = columnsOf(columns);
    else this.returning = true;
    return this;
  }
  insert(rows: unknown): this {
    this.kind = "insert";
    this.payload = rows;
    return this;
  }
  upsert(rows: unknown, options?: { onConflict?: string }): this {
    this.kind = "upsert";
    this.payload = rows;
    this.onConflict = options?.onConflict;
    return this;
  }
  update(patch: unknown): this {
    this.kind = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.kind = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ sql: `${ident(column)} = $?`, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ sql: `${ident(column)} <> $?`, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({
      sql: `${ident(column)}::text = any($?::text[])`,
      value: values.map(String),
    });
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.filters.push({
      sql: `${ident(column)} is ${value === null ? "null" : value ? "true" : "false"}`,
    });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orders.push(`${ident(column)} ${opts?.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  range(from: number, to: number): this {
    this.rangeValue = [from, to];
    return this;
  }
  limit(n: number): this {
    this.limitValue = n;
    return this;
  }
  single(): this {
    this.singleMode = "single";
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result> {
    try {
      // Signatures are read before the transaction: PGlite has a single connection.
      const signatures = this.kind === "rpc" ? await procs(this.db) : null;
      const data = await asUser(this.db, this.userId, (tx) => this.run(tx, signatures));
      return this.shape(data);
    } catch (error) {
      const e = error as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }

  private where(params: unknown[]): string {
    if (this.filters.length === 0) return "";
    return (
      " where " +
      this.filters
        .map((f) => {
          if (!f.sql.includes("$?")) return f.sql;
          params.push(f.value);
          return f.sql.replace("$?", `$${params.length}`);
        })
        .join(" and ")
    );
  }

  private page(): string {
    let sql = this.orders.length ? ` order by ${this.orders.join(", ")}` : "";
    if (this.rangeValue)
      sql += ` limit ${this.rangeValue[1] - this.rangeValue[0] + 1} offset ${this.rangeValue[0]}`;
    else if (this.limitValue !== undefined) sql += ` limit ${this.limitValue}`;
    return sql;
  }

  private async json(tx: Tx, sql: string, params: unknown[]): Promise<unknown> {
    const res = await tx.query<{ j: unknown }>(sql, params);
    return res.rows[0]?.j ?? null;
  }

  private async run(
    tx: Tx,
    signatures: Awaited<ReturnType<typeof procs>> | null,
  ): Promise<unknown> {
    const table = `public.${ident(this.target)}`;
    const params: unknown[] = [];
    switch (this.kind) {
      case "select": {
        const where = this.where(params);
        return this.json(
          tx,
          `select coalesce(json_agg(t), '[]') as j from (select ${this.columns} from ${table}${where}${this.page()}) t`,
          params,
        );
      }
      case "insert":
      case "upsert": {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<
          string,
          unknown
        >[];
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident);
        params.push(JSON.stringify(rows));
        let sql = `insert into ${table} (${keys.join(", ")}) select ${keys.join(", ")} from json_populate_recordset(null::${table}, $1::json)`;
        if (this.kind === "upsert") {
          const conflict = (this.onConflict ?? "id").split(",").map((c) => ident(c.trim()));
          const updates = keys.filter((k) => !conflict.includes(k));
          sql += ` on conflict (${conflict.join(", ")}) do ${
            updates.length
              ? `update set ${updates.map((k) => `${k} = excluded.${k}`).join(", ")}`
              : "nothing"
          }`;
        }
        return this.json(
          tx,
          `with w as (${sql} returning *) select coalesce(json_agg(w), '[]') as j from w`,
          params,
        );
      }
      case "update": {
        const keys = Object.keys(this.payload as Record<string, unknown>).map(ident);
        params.push(JSON.stringify(this.payload));
        const where = this.where(params);
        const sql = `update ${table} set (${keys.join(", ")}) = (select ${keys.join(", ")} from json_populate_record(null::${table}, $1::json))${where}`;
        return this.json(
          tx,
          `with w as (${sql} returning *) select coalesce(json_agg(w), '[]') as j from w`,
          params,
        );
      }
      case "delete": {
        const where = this.where(params);
        await tx.query(`delete from ${table}${where}`, params);
        return null;
      }
      case "rpc": {
        const proc = signatures?.get(this.target);
        if (!proc) throw new Error(`unknown function ${this.target}`);
        const args = Object.entries(this.payload as Record<string, unknown>).map(
          ([name, value]) => {
            const type = proc.args.get(name);
            if (!type) throw new Error(`unknown argument ${name}`);
            params.push(type === "jsonb" && value !== null ? JSON.stringify(value) : value);
            return `${ident(name)} => $${params.length}::${type === "_text" ? "text[]" : type}`;
          },
        );
        const call = `public.${ident(this.target)}(${args.join(", ")})`;
        if (proc.retset) {
          return this.json(
            tx,
            `select coalesce(json_agg(r), '[]') as j from (select * from ${call}${this.page()}) r`,
            params,
          );
        }
        return this.json(tx, `select to_json(${call}) as j`, params);
      }
    }
  }

  private shape(data: unknown): Result {
    const rows = this.kind === "select" || this.returning || this.kind === "rpc" ? data : null;
    if (!this.singleMode) return { data: rows, error: null };
    const list = Array.isArray(rows) ? rows : rows === null ? [] : [rows];
    if (list.length === 1) return { data: list[0], error: null };
    if (list.length === 0 && this.singleMode === "maybe") return { data: null, error: null };
    return {
      data: null,
      error: { message: `JSON object requested, ${list.length} rows returned`, code: "PGRST116" },
    };
  }
}

/** A DbClient that talks to the PGlite test database as the given user. */
export function pgClient(db: Db, userId: string): DbClient {
  const client = {
    from: (table: string) => new PgQuery(db, userId, table),
    rpc: (fn: string, args?: Record<string, unknown>) => new PgQuery(db, userId, fn, args ?? {}),
  };
  return client as unknown as DbClient;
}
