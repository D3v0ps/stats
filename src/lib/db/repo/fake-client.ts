// In-memory stand-in for the slice of SupabaseClient the repo adapters use. Test-only:
// it evaluates eq/neq/in/is filters, order, range/limit and single() over plain rows
// and records every call, so adapters can be tested without a database.
import type { DbClient } from "./shared";

export type Row = Record<string, unknown>;

export interface Filter {
  op: "eq" | "neq" | "in" | "is";
  column: string;
  value: unknown;
}

export interface FakeCall {
  kind: "select" | "insert" | "upsert" | "update" | "delete" | "rpc";
  target: string;
  payload?: unknown;
  filters: Filter[];
  range?: [number, number];
  options?: unknown;
}

export interface FakeError {
  message: string;
  code?: string;
}

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** RPC handlers; array results are sliced by .range() like PostgREST does. */
  rpc?: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Make matching calls fail. */
  fail?: (call: FakeCall) => FakeError | null;
}

export interface FakeClient {
  client: DbClient;
  calls: FakeCall[];
  tables: Record<string, Row[]>;
}

interface Result {
  data: unknown;
  error: FakeError | null;
  count?: number | null;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.column];
    switch (f.op) {
      case "eq":
        return v === f.value;
      case "neq":
        return v !== f.value;
      case "in":
        return (f.value as unknown[]).includes(v);
      case "is":
        return v === f.value;
    }
  });
}

class FakeQuery implements PromiseLike<Result> {
  private kind: FakeCall["kind"] = "select";
  private payload: unknown;
  private options: unknown;
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private rangeValue: [number, number] | undefined;
  private limitValue: number | undefined;
  private singleMode: "single" | "maybe" | null = null;
  private returning = false;

  constructor(
    private readonly ctx: Context,
    private readonly target: string,
    rpcArgs?: Record<string, unknown>,
  ) {
    if (rpcArgs !== undefined) {
      this.kind = "rpc";
      this.payload = rpcArgs;
    }
  }

  select(): this {
    if (this.kind !== "select") this.returning = true;
    return this;
  }
  insert(rows: unknown, options?: unknown): this {
    this.kind = "insert";
    this.payload = rows;
    this.options = options;
    return this;
  }
  upsert(rows: unknown, options?: unknown): this {
    this.kind = "upsert";
    this.payload = rows;
    this.options = options;
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
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  in(column: string, value: unknown[]): this {
    this.filters.push({ op: "in", column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: opts?.ascending ?? true });
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
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private execute(): Result {
    const call: FakeCall = {
      kind: this.kind,
      target: this.target,
      payload: this.payload,
      filters: this.filters,
      range: this.rangeValue,
      options: this.options,
    };
    this.ctx.calls.push(call);
    const failure = this.ctx.fail?.(call);
    if (failure) return { data: null, error: failure };

    if (this.kind === "rpc") {
      const handler = this.ctx.rpc[this.target];
      if (!handler) return { data: null, error: { message: `no rpc handler for ${this.target}` } };
      let data = handler((this.payload ?? {}) as Record<string, unknown>);
      if (Array.isArray(data) && this.rangeValue) {
        data = data.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      }
      return this.shape(data);
    }

    const table = (this.ctx.tables[this.target] ??= []);
    switch (this.kind) {
      case "select": {
        let rows = table.filter((r) => matches(r, this.filters));
        for (const o of [...this.orders].reverse()) {
          rows = [...rows].sort(
            (a, b) => compare(a[o.column], b[o.column]) * (o.ascending ? 1 : -1),
          );
        }
        if (this.rangeValue) rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
        if (this.limitValue !== undefined) rows = rows.slice(0, this.limitValue);
        return this.shape(rows.map((r) => ({ ...r })));
      }
      case "insert": {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const inserted = rows.map((r) => ({
          id: r.id ?? `${this.target}-${++this.ctx.seq}`,
          ...r,
        }));
        table.push(...inserted);
        return this.shape(this.returning ? inserted : null);
      }
      case "upsert": {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const keys = String(
          (this.options as { onConflict?: string } | undefined)?.onConflict ?? "id",
        ).split(",");
        for (const r of rows) {
          const i = table.findIndex((t) => keys.every((k) => t[k] === r[k]));
          if (i >= 0) table[i] = { ...table[i], ...r };
          else table.push({ ...r });
        }
        return this.shape(this.returning ? rows : null);
      }
      case "update": {
        const updated: Row[] = [];
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i]!, this.filters)) {
            table[i] = { ...table[i], ...(this.payload as Row) };
            updated.push(table[i]!);
          }
        }
        return this.shape(this.returning ? updated : null);
      }
      case "delete": {
        this.ctx.tables[this.target] = table.filter((r) => !matches(r, this.filters));
        return this.shape(null);
      }
    }
  }

  private shape(data: unknown): Result {
    if (!this.singleMode) return { data, error: null };
    const rows = Array.isArray(data) ? data : data === null ? [] : [data];
    if (rows.length === 1) return { data: rows[0], error: null };
    if (rows.length === 0 && this.singleMode === "maybe") return { data: null, error: null };
    return {
      data: null,
      error: { message: `expected one row, got ${rows.length}`, code: "PGRST116" },
    };
  }
}

interface Context {
  tables: Record<string, Row[]>;
  rpc: Record<string, (args: Record<string, unknown>) => unknown>;
  fail?: (call: FakeCall) => FakeError | null;
  calls: FakeCall[];
  seq: number;
}

export function createFakeClient(options: FakeOptions = {}): FakeClient {
  const ctx: Context = {
    tables: Object.fromEntries(
      Object.entries(options.tables ?? {}).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
    ),
    rpc: options.rpc ?? {},
    fail: options.fail,
    calls: [],
    seq: 0,
  };
  const client = {
    from: (table: string) => new FakeQuery(ctx, table),
    rpc: (fn: string, args?: Record<string, unknown>) => new FakeQuery(ctx, fn, args ?? {}),
  };
  return { client: client as unknown as DbClient, calls: ctx.calls, tables: ctx.tables };
}
